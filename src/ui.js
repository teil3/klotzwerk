/*
 * Verdrahtung des 3D-Konstruktors. Haelt den Zustand (Dokument, Historie,
 * Auswahl), redet mit dem CSG-Worker und stoesst Viewport-Updates an.
 */
(function () {
  'use strict';

  // Basis-Pfad aus dem eigenen Script-Tag ableiten (document.currentScript ist
  // beim klassischen Laden gesetzt) -- macht die App aus jedem Basis-Pfad
  // lauffaehig (Demo-Root, teil3-Einbettung, fremde Websites).
  var SCRIPT_BASIS = new URL('.', document.currentScript.src); // .../src/

  var D = window.KlotzwerkDokument, H = window.KlotzwerkHistorie, IO = window.KlotzwerkIO,
      Mess = window.KlotzwerkMessen;

  var KANAL_DURCHMESSER = 3;   // Standard-Lochdurchmesser des Entleerungskanals in mm

  // Muss zur KERN_VERSION in esm/csg-worker.js passen. Antwortet ein
  // Worker mit aelterer (oder ohne) Version, kommt er aus dem Browser-Cache
  // und rechnet mit altem Code -- dann laut warnen statt still falsch rechnen.
  var KERN_VERSION = 2;

  var zustand = {
    dok: null,
    historie: null,
    auswahl: [],
    engineBereit: false,
    worker: null,
    anfragen: {},          // anfrageId -> {resolve, reject}
    naechsteAnfrage: 1,
    meshCache: {},         // geoSchluessel -> {vertProperties, triVerts}|null
    viewport: null,
    schnitt: null,
    letzteSchnittPose: null,   // {position, rotation} der Ebene des letzten Schnitts
    letzterSchnittRaster: null,   // Raster-Konfig des letzten Schnitts (wie letzteSchnittPose)
    offset: null,              // {richtung, zielId, wandstaerke} im Aushoehlen/Aufdicken-Modus
    kanal: null,               // {zielId, wandstaerke, laeuft} in der Entleerungskanal-Phase
    strecken: null,            // {zielId, phase: 1|2, breite, normal, offset, laeuft} im Strecken-Modus
    anlegen: null,
    messen: null,              // {zielId, distanz} im Massstab-Modus; distanz null bis 2 Punkte gesetzt
    boxauswahl: null,          // {verhalten, selektorAktiv} im Auswahl-Modus (Rahmen aufziehen)
    arbeitsflaeche: null,      // normalisierte Gitter-Einstellungen (localStorage, nicht im Dokument)
    listenAnker: null,         // Id des Anker-Eintrags fuer Shift-Bereichsauswahl in der Liste
    liveFelder: null           // Input-Referenzen des offenen Akkordeons fuer den Gizmo-Live-Sync
  };

  function $(id) { return document.getElementById(id); }

  function setStatus(text, istFehler) {
    var el = $('k3d-status');
    el.textContent = text;
    el.className = 'k3d-status' + (istFehler ? ' k3d-fehler' : '');
  }

  // Grammatikalisch korrekte Meldung fuer entfernte Import-Knoten (Singular/Plural)
  function meldungEntfernteImporte(entfernt) {
    return entfernt === 1
      ? 'Ein importiertes Modell war nicht mehr im Browser-Speicher und wurde entfernt.'
      : entfernt + ' importierte Modelle waren nicht mehr im Browser-Speicher und wurden entfernt.';
  }

  // --- Worker-Client -----------------------------------------------------

  function starteWorker() {
    // Worker- und WASM-URL script-relativ bauen: Worker loesen relative URLs
    // gegen ihren eigenen Ort auf (bekannte Falle).
    // ?v=KERN_VERSION: alte Worker-Eintraege im Browser-Cache ueberleben
    // sogar Hard-Reloads -- die Versions-Query erzwingt bei jedem Kern-Bump
    // einen frischen Fetch (gleiche Query auch in den Imports des Workers).
    var workerUrl = new URL('esm/csg-worker.js?v=' + KERN_VERSION, SCRIPT_BASIS);
    var wasmUrl = new URL('../vendor/manifold-3d/manifold.wasm', SCRIPT_BASIS).href;
    var w = new Worker(workerUrl, { type: 'module' });
    zustand.worker = w;
    w.onmessage = function (e) {
      var d = e.data;
      if (d.befehl === 'bereit') {
        if (d.kernVersion !== KERN_VERSION) {
          setStatus('Der Rechenkern im Browser-Cache ist veraltet — lade die Seite einmal mit Ctrl+Shift+R neu, sonst rechnen die Werkzeuge falsch.', true);
          return;   // Engine bewusst NICHT freigeben
        }
        zustand.engineBereit = true;
        (zustand.assetsGeladen || Promise.resolve()).then(function () {
          // Verwaiste Assets (kein Import-Knoten referenziert sie mehr)
          // fliegen vor der Registrierung raus -- sie sammeln sich sonst
          // ueber Reloads unbegrenzt in IndexedDB und Worker-RAM an.
          entferneVerwaisteAssets();
          // Jedes Asset einzeln registrieren: ein defekter Eintrag (kaputte
          // IndexedDB-Daten, sync- oder async-Wurf) darf nicht die ganze
          // Kette (und damit die Palette) lahmlegen -- betroffenes Asset
          // wird stattdessen aus dem Store entfernt und zaehlt als fehlend.
          return Promise.all(window.KlotzwerkAssets.alleIds().map(function (id) {
            var daten = window.KlotzwerkAssets.hole(id);
            var p;
            try { p = frageAsset(id, daten); }
            catch (err) { p = Promise.reject(err); }
            return p.catch(function () {
              window.KlotzwerkAssets.loesche(id);
              window.KlotzwerkAssets.loescheInDb(id).catch(function () { });
            });
          }));
        }).then(function () {
          var entfernt = entferneVerwaisteImporte(zustand.dok.objekte);
          if (entfernt > 0) {
            IO.speichereAutosave(D.serialisiere(zustand.dok));
            setStatus(meldungEntfernteImporte(entfernt), true);
          } else {
            setStatus('Bereit. Wähle links einen Grundkörper.');
          }
        }).catch(function (err) {
          // Sollte hier oben nie ankommen (jedes Asset wird einzeln
          // abgefangen) -- als letzte Sicherung trotzdem Palette
          // freigeben statt den Editor stumm zu blockieren.
          setStatus('Importierte Modelle konnten nicht vollständig geladen werden (' + err.message + ').', true);
        }).then(function () {
          Array.prototype.forEach.call(document.querySelectorAll('#k3d-palette button'), function (b) { b.disabled = false; });
          zeichneAlles();
        });
        return;
      }
      if (d.befehl === 'initFehler') {
        setStatus('Die 3D-Engine konnte nicht geladen werden (' + d.meldung + '). Lade die Seite neu.', true);
        return;
      }
      var a = zustand.anfragen[d.anfrageId];
      if (!a) return;
      delete zustand.anfragen[d.anfrageId];
      aktualisiereBusy();
      if (d.befehl === 'fehler') a.reject(new Error(d.meldung));
      else if (d.befehl === 'assetErgebnis') a.resolve({ wasserdicht: d.wasserdicht, dreiecke: d.dreiecke });
      else if (d.befehl === 'schnittErgebnis') a.resolve(d.teile);
      else if (d.befehl === 'trennErgebnis') a.resolve(d.teile);
      else if (d.befehl === 'offsetErgebnis') a.resolve({ vertProperties: d.vertProperties, triVerts: d.triVerts });
      else if (d.befehl === 'kanalErgebnis') a.resolve({ vertProperties: d.vertProperties, triVerts: d.triVerts });
      else if (d.befehl === 'streckenVorschauErgebnis') a.resolve({ teilA: d.teilA, teilB: d.teilB, mitte: d.mitte });
      else a.resolve(d.leer ? null : { vertProperties: d.vertProperties, triVerts: d.triVerts });
    };
    w.onerror = function () {
      zustand.engineBereit = false;
      // Ausstehende Anfragen (exportiereSTL, zeichne, ...) haengen sonst ewig:
      // alle rejecten, damit die .catch-Pfade der Aufrufer greifen.
      Object.keys(zustand.anfragen).forEach(function (id) {
        zustand.anfragen[id].reject(new Error('Engine abgestürzt'));
      });
      zustand.anfragen = {};
      aktualisiereBusy();
      setStatus('Die 3D-Engine ist abgestürzt. Lade die Seite neu — dein Projekt ist gespeichert.', true);
    };
    w.postMessage({ befehl: 'init', wasmUrl: wasmUrl });
  }

  // Busy-Indicator: sichtbar, solange der Worker an Anfragen rechnet --
  // in der Statuszeile und als Fortschritts-Cursor am Mauszeiger
  function aktualisiereBusy() {
    var busy = Object.keys(zustand.anfragen).length > 0;
    $('k3d-busy').hidden = !busy;
    document.body.style.cursor = busy ? 'progress' : '';
  }

  function frageAsset(assetId, daten) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      var vp = daten.vertProperties.slice(), tv = daten.triVerts.slice();
      zustand.worker.postMessage(
        { befehl: 'asset', anfrageId: id, assetId: assetId, name: daten.name, vertProperties: vp, triVerts: tv },
        [vp.buffer, tv.buffer]
      );
    });
  }

  function frageMesh(knoten) {
    if (knoten.typ === 'import') {
      // Import-Geometrie liegt fertig im Asset-Store; kein Worker-Umweg.
      var asset = window.KlotzwerkAssets.hole(knoten.params.assetId);
      if (!asset) return Promise.resolve(null);
      // Kopien: BufferAttribute uebernimmt die Arrays
      return Promise.resolve({ vertProperties: asset.vertProperties.slice(), triVerts: asset.triVerts.slice() });
    }
    var schluessel = knoten.id + '|' + (knoten.modus || '') + '|' + JSON.stringify(knoten.typ === 'gruppe' ? knoten.kinder : knoten.params);
    if (zustand.meshCache[schluessel]) {
      var c = zustand.meshCache[schluessel];
      // Kopien zurueckgeben: BufferAttribute uebernimmt die Arrays
      return Promise.resolve({ vertProperties: c.vertProperties.slice(), triVerts: c.triVerts.slice() });
    }
    if (!zustand.engineBereit) return Promise.resolve(null);
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({ befehl: 'mesh', anfrageId: id, knoten: JSON.parse(JSON.stringify(knoten)) });
    }).then(function (daten) {
      if (daten && knoten.id !== 'probe') {
        // Alte Cache-Eintraege desselben Objekts verwerfen, sonst waechst der
        // Cache mit jeder Param-Stufe unbegrenzt ueber die Session.
        var praefix = knoten.id + '|';
        Object.keys(zustand.meshCache).forEach(function (k) {
          if (k.indexOf(praefix) === 0 && k !== schluessel) delete zustand.meshCache[k];
        });
        zustand.meshCache[schluessel] = { vertProperties: daten.vertProperties.slice(), triVerts: daten.triVerts.slice() };
      }
      return daten;
    });
  }

  function frageSchnitt(knoten, ebenen) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({
        befehl: 'schneiden', anfrageId: id,
        knoten: JSON.parse(JSON.stringify(knoten)), ebenen: ebenen
      });
    });
  }

  function frageStreckenVorschau(knoten, normal, offset) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({
        befehl: 'streckenVorschau', anfrageId: id,
        knoten: JSON.parse(JSON.stringify(knoten)), normal: normal, offset: offset
      });
    });
  }

  function frageStrecken(knoten, normal, offset, breite) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({
        befehl: 'strecken', anfrageId: id,
        knoten: JSON.parse(JSON.stringify(knoten)), normal: normal, offset: offset, breite: breite
      });
    });
  }

  function frageOffset(knoten, richtung, wandstaerke) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({
        befehl: 'offsetKoerper', anfrageId: id,
        knoten: JSON.parse(JSON.stringify(knoten)),
        richtung: richtung, wandstaerke: wandstaerke
      });
    });
  }

  function frageKanal(knoten, stelle, tiefe, durchmesser) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({
        befehl: 'bohreKanal', anfrageId: id,
        knoten: JSON.parse(JSON.stringify(knoten)),
        punkt: stelle.punkt, normale: stelle.normale,
        tiefe: tiefe, marge: 0.1, durchmesser: durchmesser
      });
    });
  }

  // Ganze Flaeche ausschneiden (Alternative zum runden Loch): schickt die
  // Flaechen-Dreiecke (Weltkoordinaten, aus dem Viewport-Hover) an den
  // CSG-Worker; der antwortet wie bohreKanal mit 'kanalErgebnis'.
  function frageFlaechenOeffnung(knoten, flaeche, tiefe) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({
        befehl: 'oeffneFlaeche', anfrageId: id,
        knoten: JSON.parse(JSON.stringify(knoten)),
        dreiecke: flaeche.dreiecke, normale: flaeche.normale,
        tiefe: tiefe, marge: 0.1
      }, [flaeche.dreiecke.buffer]);
    });
  }

  function frageTrennen(knoten) {
    var id = zustand.naechsteAnfrage++;
    return new Promise(function (resolve, reject) {
      zustand.anfragen[id] = { resolve: resolve, reject: reject };
      aktualisiereBusy();
      zustand.worker.postMessage({
        befehl: 'auftrennen', anfrageId: id,
        knoten: JSON.parse(JSON.stringify(knoten))
      });
    });
  }

  function zeichneAlles() {
    zustand.viewport.zeichne(zustand.dok, frageMesh);
    zustand.viewport.setzeAuswahl(zustand.auswahl);
  }

  // --- Aenderungs-Pipeline: merken + speichern + zeichnen ----------------

  var autosaveTimer = null;
  function nachAenderung() {
    H.merke(zustand.historie, zustand.dok);
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      if (!IO.speichereAutosave(D.serialisiere(zustand.dok))) {
        setStatus('Automatisches Speichern fehlgeschlagen (Speicher voll?). Lade dein Projekt als STL herunter.', true);
      }
    }, 500);
    zeichneAlles();
    aktualisiereWerkzeugleiste();
  }

  // --- Start -------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var gespeichert = IO.ladeAutosave();
    if (gespeichert) {
      try { zustand.dok = D.deserialisiere(gespeichert); }
      catch (e) { zustand.dok = D.neuesDokument(); }
    } else {
      zustand.dok = D.neuesDokument();
    }
    zustand.historie = H.neueHistorie(zustand.dok);

    // Assets aus IndexedDB laden; Import-Knoten ohne Asset (z.B. Speicher
    // geleert) fliegen raus, bevor gezeichnet wird.
    zustand.assetsGeladen = window.KlotzwerkAssets.ladeAlleAusDb()
      .catch(function () { })
      .then(function () {
        var entfernt = entferneVerwaisteImporte(zustand.dok.objekte);
        if (entfernt > 0) {
          IO.speichereAutosave(D.serialisiere(zustand.dok));
          setStatus(meldungEntfernteImporte(entfernt), true);
        }
      });

    zustand.viewport = window.KlotzwerkViewport.initViewport($('k3d-viewport'), {
      beiAuswahl: function (ids) { setzeAuswahl(ids, 'viewport'); },
      beiTransformEnde: function (id, transform) {
        if (id === '__schnittebene') { if (zustand.schnitt || zustand.strecken) zeichnePanel(); return; }
        var k = D.findeKnoten(zustand.dok, id);
        if (!k) return;
        k.transform = transform;
        nachAenderung();
        zeichnePanel();
      },
      // Mehrfachauswahl gemeinsam transformiert: alle Transforms setzen,
      // EIN Undo-Schritt fuer den ganzen Drag
      beiMultiTransformEnde: function (liste) {
        var geaendert = false;
        liste.forEach(function (e) {
          var k = D.findeKnoten(zustand.dok, e.id);
          if (k) { k.transform = e.transform; geaendert = true; }
        });
        if (!geaendert) return;
        nachAenderung();
        zeichnePanel();
      },
      // Waehrend des Gizmo-Drags nur die Anzeige nachfuehren -- Dokument,
      // Undo und Autosave laufen erst ueber beiTransformEnde
      beiTransformLive: function (id, transform) {
        var lf = zustand.liveFelder;
        if (!lf || lf.id !== id) return;
        function setze(input, wert) {
          if (input && input !== document.activeElement) input.value = wert;
        }
        for (var i = 0; i < 3; i++) {
          if (lf.basis && lf.basis[i] > 0) {
            setze(lf.groesse[i], Math.round(lf.basis[i] * transform.skalierung[i] * 10) / 10);
          }
          setze(lf.position[i], transform.position[i]);
          setze(lf.drehung[i], transform.rotation[i]);
        }
      },
      beiMeshFehler: function (meldung) { setStatus(meldung, true); },
      // Panel nachziehen, wenn das Mesh des ausgewaehlten Knotens eintrifft
      // (z.B. Groessenfelder einer frisch erstellten Gruppe)
      beiMeshBereit: function (id) {
        if (zustand.kanal && zustand.kanal.zielId === id) {
          var fehler = zustand.viewport.starteKanalModus(id, zustand.kanal.durchmesser, zustand.kanal.form);
          if (fehler) setStatus(fehler, true);
        }
        if (!zustand.schnitt && zustand.auswahl.length === 1 && zustand.auswahl[0] === id) zeichnePanel();
      },
      beiKanalKlick: function (id, stelle) {
        var kz = zustand.kanal;
        if (!kz || kz.zielId !== id || kz.laeuft) return;
        var knoten = D.findeKnoten(zustand.dok, id);
        if (!knoten) { brichKanalAb(); return; }
        kz.laeuft = true;
        var istFlaeche = !!stelle.flaeche;
        setStatus(istFlaeche ? 'Fläche wird ausgeschnitten …' : 'Kanal wird gebohrt …');
        // Tiefe Wand x 1.5: durchstoesst die Wand (SDF-Streuung) sicher,
        // erreicht die gegenueberliegende Innenwand aber nicht
        var anfrage = istFlaeche
          ? frageFlaechenOeffnung(knoten, stelle.flaeche, kz.wandstaerke * 1.5)
          : frageKanal(knoten, stelle, kz.wandstaerke * 1.5, kz.durchmesser);
        anfrage.then(function (t) {
          if (zustand.kanal !== kz) return;   // Phase inzwischen beendet
          kz.laeuft = false;
          zustand.viewport.beendeKanalModus();   // altes Mesh verschwindet gleich
          var k = ersetzeDurchErgebnis(knoten, t, knoten.name);
          kz.zielId = k.id;
          setzeAuswahl([k.id]);
          nachAenderung();
          setStatus(istFlaeche
            ? 'Fläche ausgeschnitten — weitere Fläche anklicken oder «Fertig».'
            : 'Kanal gebohrt — weitere Stelle anklicken oder «Fertig».');
        }).catch(function (err) {
          if (zustand.kanal !== kz) return;
          kz.laeuft = false;
          setStatus((istFlaeche ? 'Ausschneiden' : 'Kanal') + ' fehlgeschlagen (' + err.message + ') — dein Modell ist unverändert.', true);
        });
      },
      beiKanalMeldung: function (meldung) {
        if (zustand.kanal) setStatus(meldung, true);
      },
      beiStreckBreite: function (breite) { setzeStreckBreite(breite); },
      beiAnlegenPhase: function (phase) {
        if (!zustand.anlegen) return;
        zustand.anlegen.phase = phase;
        zeichnePanel();
        setStatus('Zielfläche eines anderen Objekts oder die Arbeitsfläche anklicken.');
      },
      beiAnlegenEnde: function () {
        beendeAnlegenModus();
        setStatus('Angelegt.');
      },
      beiAnlegenMeldung: function (text) { setStatus(text, true); },
      beiMessung: function (id, distanz) {
        if (!zustand.messen) return;
        zustand.messen.zielId = id;
        zustand.messen.distanz = distanz;
        zeichnePanel();
        setStatus('Neue Länge eingeben — oder zwei neue Punkte anklicken.');
      },
      beiMessenMeldung: function (text) { if (zustand.messen) setStatus(text, true); },
      beiMessenReset: function () {
        if (!zustand.messen) return;
        zustand.messen.zielId = null;
        zustand.messen.distanz = null;
        zeichnePanel();
      },
      beiSelektorPick: function (id) { waehleSelektor(id); },
      beiGitterToggle: function () {
        var e = Object.assign({}, zustand.arbeitsflaeche || ladeArbeitsflaeche());
        e.sichtbar = !e.sichtbar;
        setzeArbeitsflaeche(e);
      }
    });
    initRaster();
    initProjektion();
    initEinstellungen();
    setzeArbeitsflaeche(ladeArbeitsflaeche());

    Array.prototype.forEach.call(document.querySelectorAll('#k3d-palette button[data-typ]'), function (b) {
      b.addEventListener('click', function () {
        var k = D.neuerKoerper(zustand.dok, b.getAttribute('data-typ'));
        // Neue Koerper leicht versetzen, damit sie nicht ineinander stehen
        var n = zustand.dok.objekte.length - 1;
        k.transform.position = [(n % 4) * 30 - 45, (Math.floor(n / 4) % 4) * 30 - 45, 0];
        setzeAuswahl([k.id]);
        nachAenderung();
      });
    });

    starteWorker();
    zeichneAlles();
    zeichnePanel();

    function importiereDateiListe(dateien) {
      if (!dateien.length) return;
      // Beim Drop kommt jede Endung durch (kein accept-Filter wie im Picker)
      var unbekannt = dateien.filter(function (f) { return !/\.(stl|3mf|obj|mtl)$/i.test(f.name); });
      if (unbekannt.length) {
        setStatus('«' + unbekannt[0].name + '» wird nicht unterstützt — STL, 3MF oder OBJ (+MTL) importieren.', true);
      }
      dateien = dateien.filter(function (f) { return /\.(stl|3mf|obj|mtl)$/i.test(f.name); });
      if (!dateien.length) return;
      var mtl = dateien.filter(function (f) { return /\.mtl$/i.test(f.name); });
      var verarbeitet = false;
      dateien.forEach(function (f) {
        if (/\.mtl$/i.test(f.name)) return;   // gehoert zum OBJ
        verarbeitet = true;
        if (/\.3mf$/i.test(f.name)) importiere3MFDatei(f);
        else if (/\.obj$/i.test(f.name)) importiereOBJDatei(f, mtl[0] || null);
        else importiereSTLDatei(f);
      });
      if (!verarbeitet && mtl.length) {
        setStatus('Eine MTL-Datei gehört zu einer OBJ-Datei — wähle beide zusammen aus.', true);
      }
    }

    $('btn-import').addEventListener('click', function () { $('datei-import').click(); });
    $('datei-import').addEventListener('change', function () {
      var dateien = Array.prototype.slice.call(this.files);
      this.value = '';
      importiereDateiListe(dateien);
    });

    // Drag & Drop auf den Import-Knopf. Der window-Handler verhindert, dass
    // ein daneben gelandeter Drop die Seite durch die Datei ersetzt.
    var importKnopf = $('btn-import');
    ['dragenter', 'dragover'].forEach(function (ev) {
      importKnopf.addEventListener(ev, function (e) {
        e.preventDefault();
        importKnopf.classList.add('k3d-drop-ziel');
      });
    });
    importKnopf.addEventListener('dragleave', function () {
      importKnopf.classList.remove('k3d-drop-ziel');
    });
    importKnopf.addEventListener('drop', function (e) {
      e.preventDefault();
      importKnopf.classList.remove('k3d-drop-ziel');
      importiereDateiListe(Array.prototype.slice.call(e.dataTransfer.files));
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    $('btn-projekt-speichern').addEventListener('click', function () {
      if (zustand.dok.objekte.length === 0) { setStatus('Noch nichts zu sichern.', true); return; }
      IO.downloadText(IO.exportiereProjekt(zustand.dok, window.KlotzwerkAssets.hole), 'teil3-projekt.json');
      setStatus('Projekt als Datei gesichert.');
    });

    $('btn-projekt-oeffnen').addEventListener('click', function () { $('datei-projekt').click(); });
    $('datei-projekt').addEventListener('change', function () {
      if (this.files[0]) oeffneProjektDatei(this.files[0]);
      this.value = '';
    });

    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);

    $('btn-loch').addEventListener('click', function () {
      zustand.auswahl.forEach(function (id) {
        var k = D.findeKnoten(zustand.dok, id);
        if (k) D.setzeLoch(zustand.dok, id, !k.istLoch);
      });
      nachAenderung();
      zeichnePanel();
    });

    $('btn-gruppieren').addEventListener('click', function () {
      var ids = zustand.auswahl.slice();
      // Probe: wuerde die Gruppe leer? Dann gar nicht erst gruppieren.
      var probe = {
        id: 'probe', typ: 'gruppe', istLoch: false,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
        kinder: ids.map(function (id) { return D.findeKnoten(zustand.dok, id); })
      };
      frageMesh(probe).then(function (daten) {
        if (!daten) {
          setStatus('Diese Gruppe wäre leer — die Negative entfernen alles. Nicht gruppiert.', true);
          return;
        }
        var gId = D.gruppiere(zustand.dok, ids);
        setzeAuswahl([gId]);
        nachAenderung();
      }).catch(function (err) {
        setStatus('Gruppieren fehlgeschlagen (' + err.message + '). Dein Modell ist unverändert.', true);
      });
    });

    $('btn-ueberschneiden').addEventListener('click', function () {
      var ids = zustand.auswahl.slice();
      // Probe: waere der Schnitt leer? Dann gar nicht erst verrechnen.
      var probe = {
        id: 'probe', typ: 'gruppe', modus: 'ueberschneiden', istLoch: false,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
        kinder: ids.map(function (id) { return D.findeKnoten(zustand.dok, id); })
      };
      frageMesh(probe).then(function (daten) {
        if (!daten) {
          setStatus('Keine Überschneidung — die Objekte berühren sich nicht. Nicht verrechnet.', true);
          return;
        }
        var gId = D.gruppiere(zustand.dok, ids, 'ueberschneiden');
        setzeAuswahl([gId]);
        nachAenderung();
      }).catch(function (err) {
        setStatus('Überschneiden fehlgeschlagen (' + err.message + '). Dein Modell ist unverändert.', true);
      });
    });

    $('btn-aufloesen').addEventListener('click', function () {
      var kindIds = D.loeseAuf(zustand.dok, zustand.auswahl[0]);
      if (kindIds.length) {
        setzeAuswahl(kindIds);
        nachAenderung();
      }
    });

    $('btn-schneiden').addEventListener('click', function () {
      if (zustand.schnitt) {
        brichSchnittAb();
        setStatus('Schneiden abgebrochen.');
      } else {
        starteSchnittModus();
      }
    });

    $('btn-strecken').addEventListener('click', function () {
      if (zustand.strecken) {
        brichStreckenAb();
        setStatus('Strecken abgebrochen.');
      } else {
        starteStreckenModus();
      }
    });

    $('btn-aushoehlen').addEventListener('click', function () {
      if (zustand.kanal) { brichKanalAb(); setStatus('Entleerungskanal beendet.'); return; }
      starteOffsetModus('innen');
    });
    $('btn-aufdicken').addEventListener('click', function () { starteOffsetModus('aussen'); });
    $('btn-abtragen').addEventListener('click', function () { starteOffsetModus('abtragen'); });

    $('btn-anlegen').addEventListener('click', function () {
      if (zustand.anlegen) {
        brichAnlegenAb();
        setStatus('Anlegen abgebrochen.');
      } else {
        starteAnlegenModus();
      }
    });

    $('btn-auswaehlen').addEventListener('click', function () {
      if (zustand.boxauswahl) {
        brichBoxAuswahlAb();
        setStatus('Auswählen beendet.');
      } else {
        starteBoxAuswahlModus();
      }
    });

    $('btn-messen').addEventListener('click', function () {
      if (zustand.messen) {
        brichMessenAb();
        setStatus('Massstab beendet.');
      } else {
        starteMessenModus();
      }
    });

    $('btn-auftrennen').addEventListener('click', function () {
      var knoten = D.findeKnoten(zustand.dok, zustand.auswahl[0]);
      if (!knoten) return;
      setStatus('Wird aufgetrennt …');
      frageTrennen(knoten).then(function (teile) {
        // Stale-Guard: Objekt inzwischen geloescht/ersetzt (Undo, Doppelklick)
        if (D.findeKnoten(zustand.dok, knoten.id) !== knoten) return;
        if (!teile || teile.length < 2) {
          setStatus('Das Objekt besteht aus einem Teil — nichts aufgetrennt.', true);
          return;
        }
        var erg = ersetzeDurchTeile(knoten, teile);
        setzeAuswahl(erg.neueIds);
        nachAenderung();
        if (!erg.quotaGemeldet) setStatus('In ' + teile.length + ' Teile aufgetrennt.');
      }).catch(function (err) {
        setStatus('Auftrennen fehlgeschlagen (' + err.message + ') — dein Modell ist unverändert.', true);
      });
    });

    $('btn-duplizieren').addEventListener('click', function () {
      var neuId = D.dupliziere(zustand.dok, zustand.auswahl[0]);
      if (neuId) { setzeAuswahl([neuId]); nachAenderung(); }
    });

    $('btn-loeschen').addEventListener('click', function () {
      zustand.auswahl.forEach(function (id) { D.entferneKnoten(zustand.dok, id); });
      setzeAuswahl([]);
      nachAenderung();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && einstellungenPanel) {
        schliesseEinstellungen();
        return;
      }
      if (e.key === 'Escape' && zustand.schnitt) {
        brichSchnittAb();
        setStatus('Schneiden abgebrochen.');
        return;
      }
      if (e.key === 'Escape' && zustand.strecken) {
        brichStreckenAb();
        setStatus('Strecken abgebrochen.');
        return;
      }
      if (e.key === 'Escape' && zustand.offset) {
        var offRichtung = zustand.offset.richtung;
        brichOffsetAb();
        setStatus(OFFSET_TEXTE[offRichtung].titel + ' abgebrochen.');
        return;
      }
      if (e.key === 'Escape' && zustand.kanal) {
        brichKanalAb();
        setStatus('Entleerungskanal beendet.');
        return;
      }
      if (e.key === 'Escape' && zustand.anlegen) {
        brichAnlegenAb();
        setStatus('Anlegen abgebrochen.');
        return;
      }
      if (e.key === 'Escape' && zustand.messen) {
        brichMessenAb();
        setStatus('Massstab beendet.');
        return;
      }
      if (e.key === 'Escape' && zustand.boxauswahl) {
        brichBoxAuswahlAb();
        setStatus('Auswählen beendet.');
        return;
      }
      if (e.target.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Delete') { $('btn-loeschen').click(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); if (zustand.auswahl.length === 1) $('btn-duplizieren').click(); }
    });
    aktualisiereWerkzeugleiste();
  });

  // --- Fangraster-Dropdown (unten rechts im Viewport) ----------------------

  // Gemeinsame Leiste unten rechts im Viewport (Raster + Ansicht nebeneinander)
  function leisteUnten() {
    var l = $('k3d-viewport').querySelector('.k3d-leiste-unten');
    if (!l) {
      l = document.createElement('div');
      l.className = 'k3d-leiste-unten';
      $('k3d-viewport').appendChild(l);
    }
    return l;
  }

  var RASTER_KEY = 'k3d-raster';

  function initRaster() {
    var behaelter = document.createElement('div');
    behaelter.className = 'k3d-raster';
    var label = document.createElement('label');
    label.textContent = 'Raster';
    var select = document.createElement('select');
    select.title = 'Fangraster für Verschieben und Skalieren';
    [['frei', 'Frei'], ['0.1', '0.1 mm'], ['1', '1 mm'], ['10', '10 mm']].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      select.appendChild(opt);
    });
    var gemerkt = null;
    try { gemerkt = localStorage.getItem(RASTER_KEY); } catch (e) { }
    select.value = (gemerkt === 'frei' || gemerkt === '0.1' || gemerkt === '10') ? gemerkt : '1';
    function anwenden() {
      zustand.viewport.setzeRaster(select.value === 'frei' ? null : parseFloat(select.value));
      try { localStorage.setItem(RASTER_KEY, select.value); } catch (e) { }
    }
    select.addEventListener('change', anwenden);
    label.appendChild(select);
    behaelter.appendChild(label);
    leisteUnten().appendChild(behaelter);
    anwenden();
  }

  // --- Projektions-Umschalter (unten rechts im Viewport) --------------------
  // Kompakter Toggle-Knopf in Farbkachel-Groesse (22x22) statt Dropdown;
  // das Icon zeigt den AKTUELLEN Modus, der title erklaert den Klick.

  var PROJEKTION_KEY = 'k3d-projektion';
  var PROJEKTION_SVG = {
    // Frustum mit Fluchtlinien: Kanten laufen zusammen
    perspektive: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
      '<path d="M5 4 L11 4 L14 12 L2 12 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '</svg>',
    // Rechteck: Kanten bleiben parallel
    parallel: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
      '<rect x="3.5" y="4" width="9" height="8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '</svg>'
  };

  function initProjektion() {
    var knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'k3d-projektion-knopf';
    var gemerkt = null;
    try { gemerkt = localStorage.getItem(PROJEKTION_KEY); } catch (e) { }
    var modus = gemerkt === 'parallel' ? 'parallel' : 'perspektive';
    function anwenden() {
      knopf.innerHTML = PROJEKTION_SVG[modus];
      knopf.title = modus === 'parallel'
        ? 'Ansicht: Parallel — klicken für Perspektive'
        : 'Ansicht: Perspektive — klicken für Parallelprojektion';
      zustand.viewport.setzeProjektion(modus);
      try { localStorage.setItem(PROJEKTION_KEY, modus); } catch (e) { }
    }
    knopf.addEventListener('click', function () {
      modus = modus === 'parallel' ? 'perspektive' : 'parallel';
      anwenden();
    });
    leisteUnten().appendChild(knopf);
    anwenden();
  }

  // --- Einstellungen (Zahnrad unten rechts, Popover ueber der Leiste) ------
  // Nimmt kuenftig weitere Einstellungen auf; aktuell Abschnitt Arbeitsflaeche.
  // Ansichts-Einstellung wie Raster/Projektion: localStorage, nicht im Dokument.

  var ARBEITSFLAECHE_KEY = 'k3d-arbeitsflaeche';
  var einstellungenPanel = null;

  function ladeArbeitsflaeche() {
    var roh = null;
    try { roh = JSON.parse(localStorage.getItem(ARBEITSFLAECHE_KEY) || 'null'); } catch (e) { }
    return window.KlotzwerkGitter.normalisiere(roh);
  }

  function setzeArbeitsflaeche(e) {
    e = window.KlotzwerkGitter.normalisiere(e);
    zustand.arbeitsflaeche = e;
    try { localStorage.setItem(ARBEITSFLAECHE_KEY, JSON.stringify(e)); } catch (ex) { }
    zustand.viewport.setzeArbeitsflaeche(e);
  }

  function schliesseEinstellungen() {
    if (!einstellungenPanel) return;
    einstellungenPanel.parentNode.removeChild(einstellungenPanel);
    einstellungenPanel = null;
  }

  function oeffneEinstellungen() {
    einstellungenPanel = document.createElement('div');
    einstellungenPanel.className = 'k3d-einstellungen';
    var titel = document.createElement('p');
    titel.textContent = 'Arbeitsfläche';
    einstellungenPanel.appendChild(titel);
    function zahlenFeld(beschriftung, schluessel) {
      var l = document.createElement('label');
      l.textContent = beschriftung;
      var i = document.createElement('input');
      i.type = 'text';             // text statt number: erlaubt Rechenausdruecke
      i.inputMode = 'decimal';
      i.className = 'k3d-zahl';
      i.value = zustand.arbeitsflaeche[schluessel];
      i.addEventListener('change', function () {
        var v = rechne(i.value);
        if (v !== null) {
          var e = Object.assign({}, zustand.arbeitsflaeche);
          e[schluessel] = v;
          setzeArbeitsflaeche(e);
        }
        i.value = zustand.arbeitsflaeche[schluessel];   // normalisierten Wert zeigen
      });
      l.appendChild(i);
      einstellungenPanel.appendChild(l);
    }
    zahlenFeld('Länge (mm)', 'laenge');
    zahlenFeld('Breite (mm)', 'breite');
    zahlenFeld('Rasterabstand (mm)', 'abstand');
    function farbFeld(beschriftung, schluessel) {
      var l = document.createElement('label');
      l.textContent = beschriftung;
      var i = document.createElement('input');
      i.type = 'color';
      i.value = zustand.arbeitsflaeche[schluessel];
      i.addEventListener('input', function () {   // live beim Ziehen im Farbwaehler
        var e = Object.assign({}, zustand.arbeitsflaeche);
        e[schluessel] = i.value;
        setzeArbeitsflaeche(e);
      });
      l.appendChild(i);
      einstellungenPanel.appendChild(l);
    }
    farbFeld('Farbe Linien', 'farbeLinien');
    farbFeld('Farbe Mittellinien', 'farbeMitte');
    var bStd = document.createElement('button');
    bStd.type = 'button';
    bStd.className = 'btn btn-default';
    bStd.textContent = 'Standard';
    bStd.addEventListener('click', function () {
      setzeArbeitsflaeche({ sichtbar: zustand.arbeitsflaeche.sichtbar });
      schliesseEinstellungen();
      oeffneEinstellungen();   // Felder mit den Standard-Werten neu aufbauen
    });
    einstellungenPanel.appendChild(bStd);
    $('k3d-viewport').appendChild(einstellungenPanel);
  }

  function initEinstellungen() {
    var knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'k3d-projektion-knopf k3d-einstellungen-knopf';
    knopf.title = 'Einstellungen';
    knopf.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M8 1.8 V4 M8 12 V14.2 M1.8 8 H4 M12 8 H14.2 M3.6 3.6 L5.2 5.2 M10.8 10.8 L12.4 12.4 M12.4 3.6 L10.8 5.2 M5.2 10.8 L3.6 12.4"' +
      ' fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    knopf.addEventListener('click', function () {
      if (einstellungenPanel) schliesseEinstellungen();
      else oeffneEinstellungen();
    });
    leisteUnten().appendChild(knopf);
    // Klick ausserhalb schliesst das Popover (Klicks im Panel/aufs Zahnrad nicht)
    document.addEventListener('pointerdown', function (e) {
      if (!einstellungenPanel) return;
      if (e.target.closest && (e.target.closest('.k3d-einstellungen') || e.target.closest('.k3d-einstellungen-knopf'))) return;
      schliesseEinstellungen();
    });
  }

  // --- Import --------------------------------------------------------------

  function rund2(x) { return Math.round(x * 100) / 100; }

  // Bounding-Box der Roh-Geometrie: XY mittig auf den Ursprung,
  // Unterseite auf die Arbeitsflaeche (Z=0)
  function platzierungFuer(vertProperties) {
    var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < vertProperties.length; i += 3) {
      if (vertProperties[i] < minX) minX = vertProperties[i];
      if (vertProperties[i] > maxX) maxX = vertProperties[i];
      if (vertProperties[i + 1] < minY) minY = vertProperties[i + 1];
      if (vertProperties[i + 1] > maxY) maxY = vertProperties[i + 1];
      if (vertProperties[i + 2] < minZ) minZ = vertProperties[i + 2];
    }
    return [rund2(-(minX + maxX) / 2), rund2(-(minY + maxY) / 2), rund2(-minZ)];
  }

  function entferneVerwaisteImporte(liste) {
    var entfernt = 0;
    for (var i = liste.length - 1; i >= 0; i--) {
      var k = liste[i];
      if (k.typ === 'import' && !window.KlotzwerkAssets.hole(k.params.assetId)) { liste.splice(i, 1); entfernt++; }
      else if (k.typ === 'gruppe') entfernt += entferneVerwaisteImporte(k.kinder);
    }
    return entfernt;
  }

  // Umgekehrte Richtung zu entferneVerwaisteImporte: Assets im Store, die
  // von keinem Import-Knoten mehr referenziert werden (z.B. nach Loeschen
  // waehrend die Session lief -- Undo/Redo braucht das Asset noch, deshalb
  // wird beim Loeschen selbst nichts freigegeben). Ohne diesen Sweep sammeln
  // sich solche Leichen bei jedem Reload unbegrenzt in IndexedDB an.
  function entferneVerwaisteAssets() {
    var referenziert = {};
    IO.sammleAssetIds(zustand.dok).forEach(function (id) { referenziert[id] = true; });
    window.KlotzwerkAssets.alleIds().forEach(function (id) {
      if (!referenziert[id]) {
        window.KlotzwerkAssets.loesche(id);
        window.KlotzwerkAssets.loescheInDb(id).catch(function () { });
      }
    });
  }

  function importiereSTLDatei(file) {
    if (!zustand.engineBereit) {
      setStatus('Die Engine lädt noch oder ist abgestürzt — lade die Seite neu.', true);
      return;
    }
    setStatus('«' + file.name + '» wird gelesen …');
    var reader = new FileReader();
    reader.onload = function (e) {
      var daten;
      try { daten = IO.parseSTL(e.target.result); }
      catch (err) { setStatus('«' + file.name + '» konnte nicht gelesen werden: ' + err.message, true); return; }
      var assetId = window.KlotzwerkAssets.neueAssetId();
      var eintrag = { name: file.name, vertProperties: daten.vertProperties, triVerts: daten.triVerts, wasserdicht: false };
      frageAsset(assetId, eintrag).then(function (erg) {
        eintrag.wasserdicht = erg.wasserdicht;
        window.KlotzwerkAssets.registriere(assetId, eintrag);
        window.KlotzwerkAssets.speichereInDb(assetId).catch(function () {
          setStatus('Browser-Speicher voll — das Modell ist geladen, überlebt aber kein Neuladen. Sichere dein Projekt als Datei.', true);
        });
        var k = D.neuerImport(zustand.dok, file.name, assetId, erg.dreiecke, erg.wasserdicht);
        k.transform.position = platzierungFuer(daten.vertProperties);
        setzeAuswahl([k.id]);
        nachAenderung();
        if (!erg.wasserdicht) {
          setStatus('«' + file.name + '» ist nicht wasserdicht: platzieren und exportieren geht, als Negativ oder in Gruppen nicht.', true);
        } else if (erg.dreiecke > 1000000) {
          setStatus('«' + file.name + '» geladen. Tipp: sehr grosse Modelle vorher mit dem Polygon-Reduzierer verkleinern.');
        } else {
          setStatus('«' + file.name + '» geladen.');
        }
      }).catch(function (err) {
        setStatus('«' + file.name + '» konnte nicht geprüft werden (' + err.message + ').', true);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  // Gemeinsamer Mehrteile-Import (3MF/OBJ): ein Konstruktor-Objekt PRO Teil,
  // mit Name und Farbe aus der Datei. Die Teile behalten ihre Lage --
  // Baugruppen nicht auseinanderreissen, darum bewusst KEIN platzierungFuer.
  function importiereTeileListe(dateiName, teile, hinweis) {
    var quotaGemeldet = false;
    return Promise.all(teile.map(function (teil, i) {
      var assetId = window.KlotzwerkAssets.neueAssetId();
      var name = teil.name || (dateiName + (teile.length > 1 ? ' (' + (i + 1) + ')' : ''));
      var eintrag = { name: name, vertProperties: teil.vertProperties, triVerts: teil.triVerts, wasserdicht: false };
      return frageAsset(assetId, eintrag).then(function (erg) {
        eintrag.wasserdicht = erg.wasserdicht;
        window.KlotzwerkAssets.registriere(assetId, eintrag);
        window.KlotzwerkAssets.speichereInDb(assetId).catch(function () {
          if (!quotaGemeldet) {
            quotaGemeldet = true;
            setStatus('Browser-Speicher voll — das Modell ist geladen, überlebt aber kein Neuladen. Sichere dein Projekt als Datei.', true);
          }
        });
        return { name: name, farbe: teil.farbe, assetId: assetId, erg: erg };
      });
    })).then(function (fertig) {
      var ids = [], mitFarbe = 0, undicht = 0;
      fertig.forEach(function (f) {
        var k = D.neuerImport(zustand.dok, f.name, f.assetId, f.erg.dreiecke, f.erg.wasserdicht);
        if (f.farbe) { D.setzeFarbe(zustand.dok, k.id, f.farbe); mitFarbe++; }
        if (!f.erg.wasserdicht) undicht++;
        ids.push(k.id);
      });
      setzeAuswahl(ids);
      nachAenderung();
      var meldung = ids.length + (ids.length === 1 ? ' Objekt' : ' Objekte') + ' aus «' + dateiName + '» geladen' +
        (mitFarbe ? ' (' + mitFarbe + ' mit Farbe)' : '') + '.' + (hinweis ? ' ' + hinweis : '');
      if (undicht) {
        setStatus(meldung + ' ' + undicht + ' davon nicht wasserdicht: platzieren und exportieren geht, als Negativ oder in Gruppen nicht.', true);
      } else {
        setStatus(meldung, !!hinweis);
      }
    });
  }

  function importiere3MFDatei(file) {
    if (!zustand.engineBereit) {
      setStatus('Die Engine lädt noch oder ist abgestürzt — lade die Seite neu.', true);
      return;
    }
    setStatus('«' + file.name + '» wird gelesen …');
    var reader = new FileReader();
    reader.onload = function (e) {
      IO.parse3MF(e.target.result).then(function (teile) {
        return importiereTeileListe(file.name, teile, null);
      }).catch(function (err) {
        setStatus('«' + file.name + '» konnte nicht gelesen werden: ' + err.message, true);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  // OBJ (+ optionale MTL-Datei fuer Farben; beide zusammen im Dialog waehlen)
  function importiereOBJDatei(file, mtlFile) {
    if (!zustand.engineBereit) {
      setStatus('Die Engine lädt noch oder ist abgestürzt — lade die Seite neu.', true);
      return;
    }
    setStatus('«' + file.name + '» wird gelesen …');
    function lesen(f) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function (e) { resolve(e.target.result); };
        r.onerror = function () { reject(new Error('Datei nicht lesbar')); };
        r.readAsText(f);
      });
    }
    Promise.all([lesen(file), mtlFile ? lesen(mtlFile) : Promise.resolve(null)]).then(function (texte) {
      var farben = texte[1] ? IO.parseMTL(texte[1]) : {};
      var mitMaterial = false;
      var teile = IO.parseOBJ(texte[0]).map(function (teil) {
        if (teil.material) mitMaterial = true;
        return { name: teil.name, farbe: (teil.material && farben[teil.material]) || null,
                 vertProperties: teil.vertProperties, triVerts: teil.triVerts };
      });
      var hinweis = (mitMaterial && !mtlFile)
        ? 'Tipp: die zugehörige MTL-Datei mit auswählen, dann kommen die Farben mit.' : null;
      return importiereTeileListe(file.name, teile, hinweis);
    }).catch(function (err) {
      setStatus('«' + file.name + '» konnte nicht gelesen werden: ' + err.message, true);
    });
  }

  function oeffneProjektDatei(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var projekt;
      try { projekt = IO.importiereProjekt(e.target.result); }
      catch (err) { setStatus(err.message, true); return; }
      if (!zustand.engineBereit) {
        setStatus('Die Engine lädt noch oder ist abgestürzt — lade die Seite neu.', true);
        return;
      }
      if (zustand.dok.objekte.length > 0 && !window.confirm('Aktuelles Projekt ersetzen?')) return;
      window.KlotzwerkAssets.loescheAlle();
      window.KlotzwerkAssets.loescheDb().catch(function () { });
      zustand.worker.postMessage({ befehl: 'assetsLoeschen' });
      var quotaGemeldet = false;
      Object.keys(projekt.assets).forEach(function (id) {
        window.KlotzwerkAssets.registriere(id, projekt.assets[id]);
        window.KlotzwerkAssets.speichereInDb(id).catch(function () {
          if (!quotaGemeldet) {
            quotaGemeldet = true;
            setStatus('Browser-Speicher voll — das Projekt ist geladen, überlebt aber kein Neuladen.', true);
          }
        });
      });
      zustand.dok = D.deserialisiere(JSON.stringify(projekt.dok));
      zustand.historie = H.neueHistorie(zustand.dok);
      zustand.meshCache = {};
      // Projektdatei kann Import-Knoten enthalten, deren Asset gar nicht
      // mit eingebettet wurde (z.B. Datei von Hand editiert) -- die fliegen
      // hier raus, bevor der Worker sie registriert bekommt.
      var entfernt = entferneVerwaisteImporte(zustand.dok.objekte);
      IO.speichereAutosave(D.serialisiere(zustand.dok));
      setzeAuswahl([]);
      zustand.viewport.versteckeSchnittebene();
      zustand.viewport.leereTransparenz();
      Promise.all(window.KlotzwerkAssets.alleIds().map(function (id) {
        return frageAsset(id, window.KlotzwerkAssets.hole(id));
      })).then(function () {
        zeichneAlles();
        aktualisiereWerkzeugleiste();
        if (entfernt > 0) setStatus(meldungEntfernteImporte(entfernt), true);
        else setStatus('Projekt «' + file.name + '» geöffnet.');
      }).catch(function (err) {
        setStatus('Projekt geladen, aber Modelle fehlen (' + err.message + ').', true);
      });
    };
    reader.readAsText(file);
  }

  // --- Auswahl, Panel, Werkzeugleiste, Undo/Redo --------------------------

  var PARAM_LABELS = {
    breite: 'Breite (mm)', tiefe: 'Tiefe (mm)', hoehe: 'Höhe (mm)',
    durchmesser: 'Ø (mm)', durchmesserUnten: 'Ø unten (mm)', durchmesserOben: 'Ø oben (mm)',
    seite: 'Seitenlänge (mm)', dicke: 'Dicke (mm)', wand: 'Wandstärke (mm)'
  };

  // Inline-SVGs: kein Icon-Font auf der Seite. currentColor folgt dem Button.
  var SVG_AUGE_AUF = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7z" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
  var SVG_AUGE_ZU = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7z" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" stroke-width="2"/></svg>';
  var SVG_PAPIERKORB = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M4 7h16M10 4h4M7 7l1 13h8l1-13M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var SVG_ROENTGEN_AUS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>';
  var SVG_ROENTGEN_AN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-dasharray="3 2"/></svg>';

  // Ersetzt einen Dokument-Knoten durch importierte Teile (Weltkoordinaten).
  // Jedes Teil {vertProperties, triVerts, wasserdicht?} wird als zentriertes
  // Asset registriert (Store + Worker + IndexedDB), der Welt-Offset wandert
  // in transform.position. Schnitt-Teile tragen kein Flag -> wasserdicht.
  // Aufrufer setzt danach Auswahl/Status und ruft nachAenderung().
  function ersetzeDurchTeile(knoten, teile) {
    var quotaGemeldet = false;
    var neueIds = [];
    teile.forEach(function (t, i) {
      var mitte = IO.bboxMitte(t.vertProperties);
      var zentriert = IO.transformiereVertices(t.vertProperties, D.matAusTransform({
        position: [-mitte[0], -mitte[1], -mitte[2]], rotation: [0, 0, 0], skalierung: [1, 1, 1]
      }));
      var assetId = window.KlotzwerkAssets.neueAssetId();
      var name = knoten.name + ' (Teil ' + (i + 1) + ')';
      var wasserdicht = t.wasserdicht !== false;
      var eintrag = { name: name, vertProperties: zentriert, triVerts: t.triVerts, wasserdicht: wasserdicht };
      window.KlotzwerkAssets.registriere(assetId, eintrag);
      // Auch im Worker registrieren, sonst kennt die dortige Asset-Registry
      // das Teil nicht und Gruppieren/Export werfen "Importiertes Modell
      // nicht gefunden" (frageAsset kopiert die Arrays selbst per slice;
      // Worker-Messages sind FIFO, spaetere Anfragen sehen die Registrierung
      // also garantiert).
      frageAsset(assetId, eintrag).catch(function () {
        setStatus('Teil konnte nicht für die Verrechnung registriert werden.', true);
      });
      window.KlotzwerkAssets.speichereInDb(assetId).catch(function () {
        if (!quotaGemeldet) {
          quotaGemeldet = true;
          setStatus('Browser-Speicher voll — die Teile sind da, überleben aber kein Neuladen. Sichere dein Projekt als Datei.', true);
        }
      });
      var k = D.neuerImport(zustand.dok, name, assetId, t.triVerts.length / 3, wasserdicht);
      k.transform.position = [rund2(mitte[0]), rund2(mitte[1]), rund2(mitte[2])];
      D.setzeFarbe(zustand.dok, k.id, knoten.farbe);
      neueIds.push(k.id);
    });
    D.entferneKnoten(zustand.dok, knoten.id);
    return { neueIds: neueIds, quotaGemeldet: quotaGemeldet };
  }

  // --- Schnitt-Modus (Cut-Tool) -------------------------------------------

  // Default-Raster = heutiges Verhalten: genau die Anker-Ebene, keine Quer-Ebenen
  var RASTER_DEFAULT = { nZ: 1, dZ: 20, nX: 0, dX: 20, nY: 0, dY: 20 };

  function kopiereRaster(r) {
    return { nZ: r.nZ, dZ: r.dZ, nX: r.nX, dX: r.dX, nY: r.nY, dY: r.dY };
  }

  function starteSchnittModus() {
    var zielId = zustand.auswahl[0];
    if (!zustand.viewport.zeigeSchnittebene(zielId, zustand.letzteSchnittPose)) {
      setStatus('Das Objekt ist noch nicht fertig berechnet — einen Moment.', true);
      return;
    }
    zustand.schnitt = { zielId: zielId, raster: kopiereRaster(zustand.letzterSchnittRaster || RASTER_DEFAULT) };
    zustand.viewport.setzeSchnittRaster(zustand.schnitt.raster);
    $('btn-schneiden').classList.add('k3d-aktiv');
    aktualisiereWerkzeugleiste();
    zeichnePanel();
    setStatus('Ebene positionieren, dann «Schnitt ausführen».');
  }

  // Die Pose wird IMMER gemerkt -- auch bei Abbrechen/Esc startet das
  // naechste Schneiden dort, wo die Ebene zuletzt stand.
  function beendeSchnittModus() {
    if (!zustand.schnitt) return;
    var ebene = zustand.viewport.holeSchnittebene();
    if (ebene) zustand.letzteSchnittPose = { position: ebene.position, rotation: ebene.rotation };
    zustand.letzterSchnittRaster = zustand.schnitt.raster;
    zustand.schnitt = null;
    zustand.viewport.versteckeSchnittebene();
    $('btn-schneiden').classList.remove('k3d-aktiv');
    aktualisiereWerkzeugleiste();
  }

  function brichSchnittAb() {
    if (!zustand.schnitt) return;
    beendeSchnittModus();
    zustand.viewport.setzeAuswahl(zustand.auswahl);   // Gizmo zurueck ans Objekt
    zeichnePanel();
  }

  function fuehreSchnittAus() {
    var s = zustand.schnitt;
    if (!s) return;
    var knoten = D.findeKnoten(zustand.dok, s.zielId);
    var ebene = zustand.viewport.holeSchnittebene();
    if (!knoten || !ebene) { brichSchnittAb(); return; }
    var ebenen = window.KlotzwerkSchnitt.baueSchnittEbenen(
      { position: ebene.position, rotation: ebene.rotation }, s.raster);
    setStatus('Wird geschnitten …');
    frageSchnitt(knoten, ebenen).then(function (teile) {
      if (zustand.schnitt !== s) return;   // Modus inzwischen beendet oder neu gestartet
      if (!teile || teile.length < 2) {
        setStatus(ebenen.length === 1
          ? 'Die Ebene trifft das Objekt nicht — nichts geschnitten.'
          : 'Keine Ebene trifft das Objekt — nichts geschnitten.', true);
        return;
      }
      var erg = ersetzeDurchTeile(knoten, teile);
      beendeSchnittModus();
      setzeAuswahl(erg.neueIds);
      nachAenderung();
      if (!erg.quotaGemeldet) setStatus('In ' + teile.length + ' Teile geschnitten.');
    }).catch(function (err) {
      if (zustand.schnitt !== s) return;   // Modus inzwischen beendet oder neu gestartet
      setStatus('Schneiden fehlgeschlagen (' + err.message + ') — dein Modell ist unverändert.', true);
    });
  }

  // --- Strecken-Modus -------------------------------------------------------
  // Phase 1: Schnittebene positionieren (gleiche Ebenen-UI wie Schneiden).
  // Phase 2: Live-Vorschau — die zwei Haelften wandern symmetrisch von der
  // Ebene weg, die Luecke fuellt die Extrusion des Querschnitts; Scrollrad
  // oder Panel-Feld steuern die Breite, «Fertig» rechnet das finale Teil.

  var STRECKEN_BREITE = 10;   // Startbreite in mm

  function starteStreckenModus() {
    var zielId = zustand.auswahl[0];
    // Bewusst OHNE letzteSchnittPose: die Ebene startet immer zentriert
    // auf dem gewaehlten Objekt (die gemerkte Pose des letzten Schnitts
    // kann bei einem anderen Objekt irgendwo im Leeren liegen).
    if (!zustand.viewport.zeigeSchnittebene(zielId, null)) {
      setStatus('Das Objekt ist noch nicht fertig berechnet — einen Moment.', true);
      return;
    }
    zustand.strecken = { zielId: zielId, phase: 1, breite: STRECKEN_BREITE, laeuft: false };
    $('btn-strecken').classList.add('k3d-aktiv');
    aktualisiereWerkzeugleiste();
    zeichnePanel();
    setStatus('Ebene positionieren, dann «Weiter».');
  }

  function beendeStreckenModus() {
    if (!zustand.strecken) return;
    zustand.strecken = null;
    zustand.viewport.versteckeSchnittebene();
    zustand.viewport.beendeStreckVorschau();
    $('btn-strecken').classList.remove('k3d-aktiv');
    aktualisiereWerkzeugleiste();
  }

  function brichStreckenAb() {
    if (!zustand.strecken) return;
    beendeStreckenModus();
    zustand.viewport.setzeAuswahl(zustand.auswahl);   // Gizmo zurueck ans Objekt
    zeichnePanel();
  }

  function starteStreckenPhase2() {
    var s = zustand.strecken;
    if (!s || s.laeuft) return;
    var knoten = D.findeKnoten(zustand.dok, s.zielId);
    var ebene = zustand.viewport.holeSchnittebene();
    if (!knoten || !ebene) { brichStreckenAb(); return; }
    s.laeuft = true;
    setStatus('Schnitt wird vorbereitet …');
    frageStreckenVorschau(knoten, ebene.normal, ebene.offset).then(function (v) {
      if (zustand.strecken !== s) return;   // Modus inzwischen beendet
      s.laeuft = false;
      s.phase = 2;
      s.normal = ebene.normal;
      s.offset = ebene.offset;
      zustand.viewport.versteckeSchnittebene();
      zustand.viewport.starteStreckVorschau(s.zielId, v, ebene.normal, ebene.offset, s.breite);
      zeichnePanel();
      setStatus('Scrollen im Viewport oder Feld: Breite einstellen — dann «Fertig».');
    }).catch(function (err) {
      if (zustand.strecken !== s) return;
      s.laeuft = false;
      setStatus('Strecken nicht möglich (' + err.message + ') — Ebene anpassen oder abbrechen.', true);
    });
  }

  function fuehreStreckenAus() {
    var s = zustand.strecken;
    if (!s || s.phase !== 2 || s.laeuft) return;
    var knoten = D.findeKnoten(zustand.dok, s.zielId);
    if (!knoten) { brichStreckenAb(); return; }
    s.laeuft = true;
    setStatus('Wird gestreckt …');
    frageStrecken(knoten, s.normal, s.offset, s.breite).then(function (t) {
      if (zustand.strecken !== s) return;
      var breite = s.breite;
      beendeStreckenModus();
      var k = ersetzeDurchErgebnis(knoten, t, knoten.name);
      setzeAuswahl([k.id]);
      nachAenderung();
      setStatus('Gestreckt: +' + breite + ' mm.');
    }).catch(function (err) {
      if (zustand.strecken !== s) return;
      s.laeuft = false;
      setStatus('Strecken fehlgeschlagen (' + err.message + ') — dein Modell ist unverändert.', true);
    });
  }

  // Breite aus dem Viewport (Scrollrad) -- Panel-Feld direkt nachziehen,
  // ohne zeichnePanel (das wuerde dem Feld den Fokus stehlen)
  function setzeStreckBreite(breite) {
    var s = zustand.strecken;
    if (!s || s.phase !== 2) return;
    s.breite = Math.max(0, Math.round(breite * 10) / 10);
    zustand.viewport.setzeStreckBreite(s.breite);
    var feld = $('k3d-streck-breite');
    if (feld) feld.value = s.breite;
  }

  // --- Aushoehlen/Aufdicken (Offset-Modus) --------------------------------

  // Beschriftungen der drei Offset-Richtungen an einem Ort
  var OFFSET_TEXTE = {
    innen: { knopf: 'btn-aushoehlen', titel: 'Aushöhlen', feld: 'Wandstärke (mm)', laeuft: 'Wird ausgehöhlt …', suffix: ' ausgehöhlt' },
    aussen: { knopf: 'btn-aufdicken', titel: 'Aufdicken', feld: 'Wandstärke (mm)', laeuft: 'Wird aufgedickt …', suffix: ' aufgedickt' },
    abtragen: { knopf: 'btn-abtragen', titel: 'Abtragen', feld: 'Abtrag (mm)', laeuft: 'Wird abgetragen …', suffix: ' abgetragen' }
  };

  function starteOffsetModus(richtung) {
    if (zustand.offset) beendeOffsetModus();
    zustand.offset = { richtung: richtung, zielId: zustand.auswahl[0], wandstaerke: 2 };
    $(OFFSET_TEXTE[richtung].knopf).classList.add('k3d-aktiv');
    aktualisiereWerkzeugleiste();
    zeichnePanel();
    setStatus((richtung === 'abtragen' ? 'Abtrag' : 'Wandstärke') + ' wählen, dann «Ausführen».');
  }

  function beendeOffsetModus() {
    if (!zustand.offset) return;
    zustand.offset = null;
    $('btn-aushoehlen').classList.remove('k3d-aktiv');
    $('btn-aufdicken').classList.remove('k3d-aktiv');
    $('btn-abtragen').classList.remove('k3d-aktiv');
    aktualisiereWerkzeugleiste();
  }

  function brichOffsetAb() {
    if (!zustand.offset) return;
    beendeOffsetModus();
    zeichnePanel();
  }

  // Worker-Ergebnis (Weltkoordinaten) als neuen Import-Knoten an der
  // Listenposition des Originals einsetzen; Original entfernen.
  function ersetzeDurchErgebnis(knoten, t, name) {
    var mitte = IO.bboxMitte(t.vertProperties);
    var zentriert = IO.transformiereVertices(t.vertProperties, D.matAusTransform({
      position: [-mitte[0], -mitte[1], -mitte[2]], rotation: [0, 0, 0], skalierung: [1, 1, 1]
    }));
    var assetId = window.KlotzwerkAssets.neueAssetId();
    var eintrag = { name: name, vertProperties: zentriert, triVerts: t.triVerts, wasserdicht: true };
    window.KlotzwerkAssets.registriere(assetId, eintrag);
    // Auch im Worker registrieren, sonst kennt die dortige Asset-Registry
    // das Ergebnis nicht und Gruppieren/Export werfen "Importiertes Modell
    // nicht gefunden" (frageAsset kopiert die Arrays selbst per slice).
    frageAsset(assetId, eintrag).catch(function () {
      setStatus('Ergebnis konnte nicht für die Verrechnung registriert werden.', true);
    });
    window.KlotzwerkAssets.speichereInDb(assetId).catch(function () {
      setStatus('Browser-Speicher voll — das Ergebnis ist da, überlebt aber kein Neuladen. Sichere dein Projekt als Datei.', true);
    });
    var k = D.neuerImport(zustand.dok, name, assetId, t.triVerts.length / 3, true);
    k.transform.position = [rund2(mitte[0]), rund2(mitte[1]), rund2(mitte[2])];
    D.setzeFarbe(zustand.dok, k.id, knoten.farbe);
    D.setzeSichtbar(zustand.dok, k.id, knoten.sichtbar !== false);
    // Roentgen-Zustand ist reiner Viewport-Zustand (nicht im Dokument, siehe
    // setzeTransparenz) und wird sonst NICHT vererbt: neuerImport erzeugt eine
    // neue Id, die alte fliegt unten aus vp.transparente. setzeTransparenz
    // early-returnt zwar mangels Mesh (existiert fuer die neue Id noch nicht),
    // setzt aber vorher die Map -- materialFuer liest sie beim Mesh-Bau.
    if (zustand.viewport.transparente[knoten.id]) zustand.viewport.setzeTransparenz(k.id, true);
    // an der Listenposition des Originals einsetzen statt hinten anhaengen
    var altIdx = zustand.dok.objekte.indexOf(knoten);
    var neuIdx = zustand.dok.objekte.indexOf(k);
    if (altIdx >= 0 && neuIdx >= 0) {
      zustand.dok.objekte.splice(neuIdx, 1);
      zustand.dok.objekte.splice(altIdx, 0, k);
    }
    D.entferneKnoten(zustand.dok, knoten.id);
    return k;
  }

  function fuehreOffsetAus() {
    var o = zustand.offset;
    if (!o) return;
    var knoten = D.findeKnoten(zustand.dok, o.zielId);
    if (!knoten) { brichOffsetAb(); return; }
    var w = o.wandstaerke;
    var texte = OFFSET_TEXTE[o.richtung];
    if (!isFinite(w) || w < 0.2) {
      setStatus((o.richtung === 'abtragen' ? 'Abtrag' : 'Wandstärke') + ' muss mindestens 0.2 mm sein.', true);
      return;
    }
    var innen = o.richtung === 'innen';
    setStatus(texte.laeuft);
    frageOffset(knoten, o.richtung, w).then(function (t) {
      if (zustand.offset !== o) return;   // Modus inzwischen beendet oder neu gestartet
      var k = ersetzeDurchErgebnis(knoten, t, knoten.name + texte.suffix);
      beendeOffsetModus();
      setzeAuswahl([k.id]);
      if (innen) starteKanalPhase(k.id, w);
      nachAenderung();
      setStatus(innen
        ? 'Ausgehöhlt (Wand ' + w + ' mm). Stelle anklicken, um einen Entleerungskanal zu bohren — oder «Fertig».'
        : o.richtung === 'abtragen'
          ? 'Abgetragen (' + w + ' mm allseitig entfernt).'
          : 'Aufgedickt (' + w + ' mm Wand aussen ergänzt).');
    }).catch(function (err) {
      if (zustand.offset !== o) return;   // Modus inzwischen beendet oder neu gestartet
      setStatus(texte.titel + ' fehlgeschlagen (' + err.message + ') — dein Modell ist unverändert.', true);
    });
  }

  // --- Entleerungskanal (Phase nach dem Aushoehlen) ------------------------

  function starteKanalPhase(zielId, wandstaerke) {
    zustand.kanal = { zielId: zielId, wandstaerke: wandstaerke, durchmesser: KANAL_DURCHMESSER,
                      form: 'loch', laeuft: false };
    $('btn-aushoehlen').classList.add('k3d-aktiv');
    aktualisiereWerkzeugleiste();
    zeichnePanel();
    // Der Viewport-Modus startet erst, wenn das Mesh des neuen Knotens
    // bereit ist -- siehe beiMeshBereit.
  }

  function beendeKanalPhase() {
    if (!zustand.kanal) return;
    zustand.kanal = null;
    zustand.viewport.beendeKanalModus();
    $('btn-aushoehlen').classList.remove('k3d-aktiv');
    aktualisiereWerkzeugleiste();
  }

  function brichKanalAb() {
    if (!zustand.kanal) return;
    beendeKanalPhase();
    zustand.viewport.setzeAuswahl(zustand.auswahl);   // Gizmo zurueck ans Objekt
    zeichnePanel();
  }

  // --- Anlegen (Flaeche an Flaeche) ---------------------------------------

  function starteAnlegenModus() {
    var zielId = zustand.auswahl[0];
    var fehler = zustand.viewport.starteAnlegeModus(zielId);
    if (fehler) { setStatus(fehler, true); return; }
    zustand.anlegen = { zielId: zielId, phase: 1 };
    $('btn-anlegen').classList.add('k3d-aktiv');
    aktualisiereWerkzeugleiste();
    zeichnePanel();
    setStatus('Fläche am ausgewählten Objekt anklicken.');
  }

  function beendeAnlegenModus() {
    if (!zustand.anlegen) return;
    zustand.anlegen = null;
    zustand.viewport.beendeAnlegeModus();   // idempotent, auch nach Erfolg ok
    $('btn-anlegen').classList.remove('k3d-aktiv');
    aktualisiereWerkzeugleiste();
  }

  function brichAnlegenAb() {
    if (!zustand.anlegen) return;
    beendeAnlegenModus();
    zustand.viewport.setzeAuswahl(zustand.auswahl);   // Gizmo zurueck ans Objekt
    zeichnePanel();
  }

  // --- Auswahl-Modus (Box-Select) -----------------------------------------
  // Kein modusAktiv im Sinn der Werkzeugleiste: die Aktions-Knoepfe
  // (Gruppieren, Negativ, Loeschen, ...) bleiben benutzbar -- Rahmen
  // aufziehen und direkt gruppieren ist der Zweck des Werkzeugs.

  function starteBoxAuswahlModus() {
    zustand.boxauswahl = { verhalten: 'ersetzen', selektorAktiv: false };
    zustand.viewport.starteBoxModus(zustand.boxauswahl.verhalten);
    $('btn-auswaehlen').classList.add('k3d-aktiv');
    aktualisiereWerkzeugleiste();
    zeichneToolbereich();
    setStatus('Rahmen aufziehen — alles vollständig darin wird ausgewählt. Shift-Ziehen ergänzt einen weiteren Rahmen.');
  }

  function brichBoxAuswahlAb() {
    if (!zustand.boxauswahl) return;
    zustand.boxauswahl = null;
    zustand.viewport.beendeBoxModus();
    $('btn-auswaehlen').classList.remove('k3d-aktiv');
    zustand.viewport.setzeAuswahl(zustand.auswahl);   // Gizmo zurueck ans Objekt
    aktualisiereWerkzeugleiste();
    zeichneToolbereich();
  }

  // Tool-Bereich oberhalb der Objektliste: Einstellungen des aktiven
  // Werkzeugs (aktuell nur Auswaehlen); die Objektliste bleibt sichtbar.
  function zeichneToolbereich() {
    var bereich = $('k3d-toolbereich');
    if (!bereich) return;
    var inhalt = $('k3d-toolbereich-inhalt');
    inhalt.innerHTML = '';
    zeichneToolInhalt(inhalt);
    bereich.hidden = inhalt.children.length === 0;
  }

  // Einstellungen des aktiven Werkzeugs -- ein Branch pro Modus. Die
  // fruehere Variante ersetzte die Objektliste im Panel; jetzt bleibt die
  // Liste sichtbar und die Tools teilen sich den Bereich darueber.
  function zeichneToolInhalt(inhalt) {
    if (zustand.schnitt || (zustand.strecken && zustand.strecken.phase === 1)) {
      var istStrecken1 = !zustand.schnitt;
      var e = zustand.viewport.holeSchnittebene();
      if (!e) return;
      var titelE = document.createElement('p');
      titelE.textContent = istStrecken1 ? 'Strecken — Schnittebene' : 'Schnittebene';
      inhalt.appendChild(titelE);
      function ebenenFeld(beschriftung, wert, beiAenderung) {
        var l = document.createElement('label');
        l.textContent = beschriftung;
        var i = document.createElement('input');
        i.type = 'text';           // text statt number: erlaubt Rechenausdruecke
        i.inputMode = 'decimal';
        i.className = 'k3d-zahl';
        i.value = wert;
        i.addEventListener('change', function () {
          var v = rechne(i.value);
          if (v === null) { i.value = wert; return; }
          beiAenderung(v);
          zeichnePanel();
        });
        l.appendChild(i);
        inhalt.appendChild(l);
      }
      ['X', 'Y', 'Z'].forEach(function (achse, i) {
        ebenenFeld('Position ' + achse + ' (mm)', e.position[i], function (v) {
          var akt = zustand.viewport.holeSchnittebene();
          akt.position[i] = v;
          zustand.viewport.setzeSchnittebeneTransform(akt.position, akt.rotation);
        });
      });
      ['X', 'Y', 'Z'].forEach(function (achse, i) {
        ebenenFeld('Drehung ' + achse + ' (°)', e.rotation[i], function (v) {
          var akt = zustand.viewport.holeSchnittebene();
          akt.rotation[i] = v;
          zustand.viewport.setzeSchnittebeneTransform(akt.position, akt.rotation);
        });
      });
      if (!istStrecken1) {
        var raster = zustand.schnitt.raster;
        var titelR = document.createElement('p');
        titelR.textContent = 'Ebenen pro Achse (Anzahl / Abstand)';
        inhalt.appendChild(titelR);
        // Anzahl: ganzzahlig 0..10, insgesamt mindestens 1 Ebene.
        // Abstand: > 0 mm. Ungueltiges laesst zeichnePanel auf den alten
        // Wert zurueckspringen (beiAenderung wird nicht angewendet).
        function setzeAnzahl(schluessel, v) {
          var n = Math.round(v);
          if (n < 0 || n > 10 || n !== v) return;
          var summe = raster.nZ + raster.nX + raster.nY - raster[schluessel] + n;
          if (summe < 1) return;
          raster[schluessel] = n;
          zustand.viewport.setzeSchnittRaster(raster);
        }
        function setzeAbstand(schluessel, v) {
          if (!(v > 0)) return;
          raster[schluessel] = v;
          zustand.viewport.setzeSchnittRaster(raster);
        }
        [['Z (Normale)', 'nZ', 'dZ'], ['X (quer)', 'nX', 'dX'], ['Y (quer)', 'nY', 'dY']]
          .forEach(function (zeile) {
            ebenenFeld('Anzahl ' + zeile[0], raster[zeile[1]], function (v) { setzeAnzahl(zeile[1], v); });
            ebenenFeld('Abstand ' + zeile[0] + ' (mm)', raster[zeile[2]], function (v) { setzeAbstand(zeile[2], v); });
          });
      }
      var bAus = document.createElement('button');
      bAus.type = 'button';
      bAus.className = 'btn btn-primary';
      bAus.textContent = istStrecken1 ? 'Weiter' : 'Schnitt ausführen';
      bAus.addEventListener('click', istStrecken1 ? starteStreckenPhase2 : fuehreSchnittAus);
      inhalt.appendChild(bAus);
      var bAbbr = document.createElement('button');
      bAbbr.type = 'button';
      bAbbr.className = 'btn btn-default';
      bAbbr.textContent = 'Abbrechen';
      bAbbr.addEventListener('click', function () {
        if (istStrecken1) { brichStreckenAb(); setStatus('Strecken abgebrochen.'); }
        else { brichSchnittAb(); setStatus('Schneiden abgebrochen.'); }
      });
      inhalt.appendChild(bAbbr);
      return;
    }
    if (zustand.strecken && zustand.strecken.phase === 2) {
      var titelSt = document.createElement('p');
      titelSt.textContent = 'Strecken';
      inhalt.appendChild(titelSt);
      var hinweisSt = document.createElement('p');
      hinweisSt.className = 'k3d-panel-leer';
      hinweisSt.textContent = 'Scrollrad im Viewport ändert die Breite (Shift ×10, Ctrl ×0.1) — die Lücke wird mit dem Querschnitt gefüllt.';
      inhalt.appendChild(hinweisSt);
      var lb = document.createElement('label');
      lb.textContent = 'Breite (mm)';
      var ib = document.createElement('input');
      ib.type = 'text';             // text statt number: erlaubt Rechenausdruecke
      ib.inputMode = 'decimal';
      ib.className = 'k3d-zahl';
      ib.id = 'k3d-streck-breite';
      ib.value = zustand.strecken.breite;
      ib.addEventListener('change', function () {
        var v = rechne(ib.value);
        if (v === null || !zustand.strecken) { ib.value = zustand.strecken ? zustand.strecken.breite : ''; return; }
        setzeStreckBreite(v);
        ib.value = zustand.strecken.breite;
      });
      lb.appendChild(ib);
      inhalt.appendChild(lb);
      var bF = document.createElement('button');
      bF.type = 'button';
      bF.className = 'btn btn-primary';
      bF.textContent = 'Fertig';
      bF.addEventListener('click', fuehreStreckenAus);
      inhalt.appendChild(bF);
      var bA2 = document.createElement('button');
      bA2.type = 'button';
      bA2.className = 'btn btn-default';
      bA2.textContent = 'Abbrechen';
      bA2.addEventListener('click', function () {
        brichStreckenAb();
        setStatus('Strecken abgebrochen.');
      });
      inhalt.appendChild(bA2);
      return;
    }
    if (zustand.offset) {
      var o = zustand.offset;
      var titelO = document.createElement('p');
      titelO.textContent = OFFSET_TEXTE[o.richtung].titel;
      inhalt.appendChild(titelO);
      var lw = document.createElement('label');
      lw.textContent = OFFSET_TEXTE[o.richtung].feld;
      var iw = document.createElement('input');
      iw.type = 'text';            // text statt number: erlaubt Rechenausdruecke
      iw.inputMode = 'decimal';
      iw.className = 'k3d-zahl';
      iw.value = o.wandstaerke;
      iw.addEventListener('change', function () {
        var v = rechne(iw.value);
        if (v === null) { iw.value = o.wandstaerke; return; }
        o.wandstaerke = Math.max(0.2, v);
        iw.value = o.wandstaerke;
      });
      lw.appendChild(iw);
      inhalt.appendChild(lw);
      var bO = document.createElement('button');
      bO.type = 'button';
      bO.className = 'btn btn-primary';
      bO.textContent = 'Ausführen';
      bO.addEventListener('click', fuehreOffsetAus);
      inhalt.appendChild(bO);
      var bOA = document.createElement('button');
      bOA.type = 'button';
      bOA.className = 'btn btn-default';
      bOA.textContent = 'Abbrechen';
      bOA.addEventListener('click', function () {
        brichOffsetAb();
        setStatus(OFFSET_TEXTE[o.richtung].titel + ' abgebrochen.');
      });
      inhalt.appendChild(bOA);
      return;
    }
    if (zustand.messen) {
      var titelM = document.createElement('p');
      titelM.textContent = 'Massstab';
      inhalt.appendChild(titelM);
      if (zustand.messen.distanz === null) {
        var hinweisM = document.createElement('p');
        hinweisM.className = 'k3d-panel-leer';
        hinweisM.textContent = 'Zwei Eckpunkte am selben Objekt anklicken. Danach kannst du die gemessene Länge auf ein Wunschmass skalieren.';
        inhalt.appendChild(hinweisM);
      } else {
        var gemessen = document.createElement('p');
        gemessen.textContent = 'Gemessen: ' + (Math.round(zustand.messen.distanz * 100) / 100) + ' mm';
        inhalt.appendChild(gemessen);
        var lm = document.createElement('label');
        lm.textContent = 'Neue Länge (mm)';
        var im = document.createElement('input');
        im.type = 'text';            // text statt number: erlaubt Rechenausdruecke
        im.inputMode = 'decimal';
        im.className = 'k3d-zahl';
        im.id = 'k3d-mess-neu';
        im.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') skaliereAufMass(im.value);
        });
        lm.appendChild(im);
        inhalt.appendChild(lm);
        var bM = document.createElement('button');
        bM.type = 'button';
        bM.className = 'btn btn-primary';
        bM.textContent = 'Skalieren';
        bM.addEventListener('click', function () { skaliereAufMass(im.value); });
        inhalt.appendChild(bM);
      }
      var bMF = document.createElement('button');
      bMF.type = 'button';
      bMF.className = 'btn btn-default';
      bMF.textContent = 'Fertig';
      bMF.addEventListener('click', function () {
        brichMessenAb();
        setStatus('Massstab beendet.');
      });
      inhalt.appendChild(bMF);
      return;
    }
    if (zustand.kanal) {
      var istFlaecheForm = zustand.kanal.form === 'flaeche';
      var titelK = document.createElement('p');
      titelK.textContent = 'Entleerungskanal';
      inhalt.appendChild(titelK);
      var hinweisK = document.createElement('p');
      hinweisK.className = 'k3d-panel-leer';
      hinweisK.textContent = istFlaecheForm
        ? 'Ebene Fläche anklicken — sie wird komplett bis in den Hohlraum ausgeschnitten. Mehrere Öffnungen möglich.'
        : 'Stelle auf der Oberfläche anklicken — dort wird ein rundes Loch bis in den Hohlraum gebohrt. Mehrere Kanäle möglich.';
      inhalt.appendChild(hinweisK);
      var lfk = document.createElement('label');
      lfk.textContent = 'Öffnung';
      var selK = document.createElement('select');
      [['loch', 'Rundes Loch'], ['flaeche', 'Fläche ausschneiden']].forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        selK.appendChild(opt);
      });
      selK.value = zustand.kanal.form;
      selK.addEventListener('change', function () {
        if (!zustand.kanal) return;
        zustand.kanal.form = selK.value;
        zustand.viewport.setzeKanalForm(selK.value);
        zeichnePanel();   // Hinweis + Durchmesser-Feld nachziehen
      });
      lfk.appendChild(selK);
      inhalt.appendChild(lfk);
      if (!istFlaecheForm) {
      var ld = document.createElement('label');
      ld.textContent = 'Lochdurchmesser (mm)';
      var idm = document.createElement('input');
      idm.type = 'text';            // text statt number: erlaubt Rechenausdruecke
      idm.inputMode = 'decimal';
      idm.className = 'k3d-zahl';
      idm.value = zustand.kanal.durchmesser;
      idm.addEventListener('change', function () {
        var v = rechne(idm.value);
        if (v === null || !zustand.kanal) { idm.value = zustand.kanal ? zustand.kanal.durchmesser : ''; return; }
        zustand.kanal.durchmesser = Math.max(0.2, v);
        idm.value = zustand.kanal.durchmesser;
        zustand.viewport.setzeKanalDurchmesser(zustand.kanal.durchmesser);
      });
      ld.appendChild(idm);
      inhalt.appendChild(ld);
      }
      var bK = document.createElement('button');
      bK.type = 'button';
      bK.className = 'btn btn-primary';
      bK.textContent = 'Fertig';
      bK.addEventListener('click', function () {
        brichKanalAb();
        setStatus('Entleerungskanal beendet.');
      });
      inhalt.appendChild(bK);
      return;
    }
    if (zustand.anlegen) {
      var titelAn = document.createElement('p');
      titelAn.textContent = 'Anlegen';
      inhalt.appendChild(titelAn);
      var schritt = document.createElement('p');
      schritt.className = 'k3d-panel-leer';
      schritt.textContent = zustand.anlegen.phase === 1
        ? 'Schritt 1: Fläche am ausgewählten Objekt anklicken.'
        : 'Schritt 2: Zielfläche eines anderen Objekts oder die Arbeitsfläche anklicken.';
      inhalt.appendChild(schritt);
      var bAnAbbr = document.createElement('button');
      bAnAbbr.type = 'button';
      bAnAbbr.className = 'btn btn-default';
      bAnAbbr.textContent = 'Abbrechen';
      bAnAbbr.addEventListener('click', function () {
        brichAnlegenAb();
        setStatus('Anlegen abgebrochen.');
      });
      inhalt.appendChild(bAnAbbr);
      return;
    }
    if (!zustand.boxauswahl) return;
    var titel = document.createElement('p');
    titel.textContent = 'Auswählen';
    inhalt.appendChild(titel);
    [['ersetzen', 'Ersetzen'], ['hinzufuegen', 'Hinzufügen (wie Shift)'], ['entfernen', 'Entfernen']].forEach(function (o) {
      var label = document.createElement('label');
      label.className = 'k3d-tool-radio';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'k3d-auswahl-verhalten';
      radio.value = o[0];
      radio.checked = zustand.boxauswahl.verhalten === o[0];
      radio.addEventListener('change', function () {
        zustand.boxauswahl.verhalten = o[0];
        zustand.viewport.setzeBoxVerhalten(o[0]);
      });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(o[1]));
      inhalt.appendChild(label);
    });
    var bSel = document.createElement('button');
    bSel.type = 'button';
    bSel.className = 'btn btn-default' + (zustand.boxauswahl.selektorAktiv ? ' k3d-aktiv' : '');
    bSel.textContent = zustand.boxauswahl.selektorAktiv ? 'Selektor anklicken …' : 'Objekt als Selektor wählen';
    bSel.title = 'Der nächste Klick bestimmt das Selektor-Objekt — gewählt wird alles, was sich mit ihm überschneidet (gemäss Verhalten oben)';
    bSel.addEventListener('click', function () {
      if (zustand.boxauswahl.selektorAktiv) {
        zustand.boxauswahl.selektorAktiv = false;
        zustand.viewport.brichSelektorPickAb();
        setStatus('Selektor-Wahl abgebrochen.');
      } else {
        zustand.boxauswahl.selektorAktiv = true;
        zustand.viewport.starteSelektorPick();
        setStatus('Selektor-Objekt im Viewport anklicken — gewählt wird alles, was sich damit überschneidet.');
      }
      zeichneToolbereich();
    });
    inhalt.appendChild(bSel);
  }

  function kopieOhneLoch(k) {
    var kopie = JSON.parse(JSON.stringify(k));
    kopie.istLoch = false;   // der Selektor-Test schneidet, er zieht nicht ab
    return kopie;
  }

  function waehleSelektor(selektorId) {
    var mz = zustand.boxauswahl;
    if (!mz) return;
    mz.selektorAktiv = false;
    zeichneToolbereich();
    var selektor = D.findeKnoten(zustand.dok, selektorId);
    if (!selektor) return;
    var selektorBox = zustand.viewport.holeWeltBBox(selektorId);
    var selektorUndicht = D.enthaeltNichtWasserdicht(selektor);
    setStatus('Überschneidungen mit «' + selektor.name + '» werden geprüft …');
    var anfragen = zustand.dok.objekte
      .filter(function (k) { return k.id !== selektorId; })
      .map(function (k) {
        // BBox-Vorfilter; unsichtbare Objekte (BBox null) fallen raus
        var box = zustand.viewport.holeWeltBBox(k.id);
        if (!window.KlotzwerkAuswahl.bboxUeberlappt(selektorBox, box)) return Promise.resolve(null);
        // Nicht wasserdicht kann nicht durch die CSG: BBox-Ueberlapp als Naeherung
        if (selektorUndicht || D.enthaeltNichtWasserdicht(k)) return Promise.resolve(k.id);
        var probe = {
          id: 'probe', typ: 'gruppe', modus: 'ueberschneiden', istLoch: false,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
          kinder: [kopieOhneLoch(selektor), kopieOhneLoch(k)]
        };
        return frageMesh(probe).then(function (daten) { return daten ? k.id : null; })
          .catch(function () { return null; });
      });
    Promise.all(anfragen).then(function (ids) {
      if (zustand.boxauswahl !== mz) return;   // Modus inzwischen beendet
      var treffer = ids.filter(Boolean);
      setzeAuswahl(window.KlotzwerkAuswahl.wendeVerhaltenAn(zustand.auswahl, treffer, mz.verhalten));
      setStatus(treffer.length === 1
        ? '1 Objekt überschneidet sich mit «' + selektor.name + '».'
        : treffer.length + ' Objekte überschneiden sich mit «' + selektor.name + '».');
    });
  }

  // --- Massstab (zwei Punkte messen, auf Wunschmass skalieren) ------------

  function starteMessenModus() {
    zustand.viewport.starteMessModus();
    zustand.messen = { zielId: null, distanz: null };
    $('btn-messen').classList.add('k3d-aktiv');
    aktualisiereWerkzeugleiste();
    zeichnePanel();
    setStatus('Zwei Eckpunkte am selben Objekt anklicken — der Marker springt auf den nächsten Eckpunkt.');
  }

  function beendeMessenModus() {
    if (!zustand.messen) return;
    zustand.messen = null;
    zustand.viewport.beendeMessModus();
    $('btn-messen').classList.remove('k3d-aktiv');
    aktualisiereWerkzeugleiste();
  }

  function brichMessenAb() {
    if (!zustand.messen) return;
    beendeMessenModus();
    zustand.viewport.setzeAuswahl(zustand.auswahl);   // Gizmo zurueck ans Objekt
    zeichnePanel();
  }

  function skaliereAufMass(eingabe) {
    var mz = zustand.messen;
    if (!mz || mz.distanz === null) return;
    var wert = rechne(eingabe);
    var faktor = wert === null ? null : Mess.skalierFaktor(mz.distanz, wert);
    if (faktor === null) {
      setStatus('Ungültige Länge — eine Zahl grösser 0 eingeben.', true);
      return;
    }
    var k = D.findeKnoten(zustand.dok, mz.zielId);
    if (!k) { brichMessenAb(); return; }
    k.transform = Mess.wendeFaktor(k.transform, faktor);
    nachAenderung();
    // zeichneAlles (in nachAenderung) hat das Mesh schon skaliert -- die
    // Messung zeigt jetzt das Wunschmass, weitermessen bleibt moeglich
    mz.distanz = zustand.viewport.messungDistanz();
    zeichnePanel();
    setStatus('Auf ' + (Math.round(wert * 100) / 100) + ' mm skaliert.');
  }

  function klickAufZeile(id, e) {
    var alle = zustand.dok.objekte.map(function (k) { return k.id; });
    var neu;
    if (e.shiftKey && zustand.listenAnker && alle.indexOf(zustand.listenAnker) >= 0) {
      var a = alle.indexOf(zustand.listenAnker), b = alle.indexOf(id);
      neu = alle.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else if (e.ctrlKey || e.metaKey) {
      neu = zustand.auswahl.indexOf(id) >= 0
        ? zustand.auswahl.filter(function (x) { return x !== id; })
        : zustand.auswahl.concat([id]);
      zustand.listenAnker = id;
    } else {
      // Klick auf die bereits aktive (aufgeklappte) Zeile klappt sie wieder zu
      neu = (zustand.auswahl.length === 1 && zustand.auswahl[0] === id) ? [] : [id];
    }
    setzeAuswahl(neu);
  }

  function setzeAuswahl(ids, quelle) {
    if (zustand.schnitt) brichSchnittAb();
    if (zustand.strecken) brichStreckenAb();
    if (zustand.offset) brichOffsetAb();
    if (zustand.kanal && !(ids.length === 1 && ids[0] === zustand.kanal.zielId)) brichKanalAb();
    if (zustand.anlegen) brichAnlegenAb();
    if (zustand.messen) brichMessenAb();
    zustand.auswahl = ids;
    if (ids.length === 1) zustand.listenAnker = ids[0];
    zustand.viewport.setzeAuswahl(ids);
    zeichnePanel();
    aktualisiereWerkzeugleiste();
    if (quelle === 'viewport' && ids.length === 1) {
      var zeile = document.querySelector('#k3d-panel-inhalt .k3d-zeile[data-id="' + ids[0] + '"]');
      if (zeile) zeile.scrollIntoView({ block: 'nearest' });
    }
  }

  // Wertet einen einfachen Rechenausdruck aus: + - * /, Klammern, Dezimal-
  // punkt oder -komma. Rekursiver Abstieg, KEIN eval. Liefert null bei
  // ungueltiger Eingabe -- der Aufrufer setzt dann den alten Wert zurueck.
  function rechne(text) {
    var s = String(text).replace(/,/g, '.').replace(/\s+/g, '');
    if (!s || /[^0-9.+\-*/()]/.test(s)) return null;
    var pos = 0;
    function ausdruck() {
      var w = term();
      while (w !== null && (s[pos] === '+' || s[pos] === '-')) {
        var op = s[pos++];
        var r = term();
        if (r === null) return null;
        w = op === '+' ? w + r : w - r;
      }
      return w;
    }
    function term() {
      var w = faktor();
      while (w !== null && (s[pos] === '*' || s[pos] === '/')) {
        var op = s[pos++];
        var r = faktor();
        if (r === null) return null;
        w = op === '*' ? w * r : w / r;
      }
      return w;
    }
    function faktor() {
      if (s[pos] === '+') { pos++; return faktor(); }
      if (s[pos] === '-') { pos++; var f = faktor(); return f === null ? null : -f; }
      if (s[pos] === '(') {
        pos++;
        var w = ausdruck();
        if (w === null || s[pos] !== ')') return null;
        pos++;
        return w;
      }
      var m = /^\d*\.?\d+/.exec(s.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      return parseFloat(m[0]);
    }
    var erg = ausdruck();
    if (erg === null || pos !== s.length || !isFinite(erg)) return null;
    return erg;
  }

  // Scrollrad auf Zahlenfeldern: ein Tick = ±1, die Seite scrollt nicht mit.
  // Bewusst EIN Listener auf document statt je Feld: das Panel wird nach jeder
  // Aenderung neu aufgebaut, und Chrome latcht die laufende Scroll-Geste aufs
  // alte, entfernte Input -- weitere Ticks gingen dann an die Seite.
  document.addEventListener('wheel', function (ev) {
    var el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || el.tagName !== 'INPUT' || !el.classList.contains('k3d-zahl')) return;
    if (!el.closest('#k3d-panel-inhalt')) return;
    ev.preventDefault();
    // rechne statt parseFloat: auch ein halb getippter Ausdruck wird
    // aufgeloest statt beim ersten Operator abgeschnitten
    var v = rechne(el.value);
    if (v === null) return;
    // Schrittweite: 1 pro Tick, mit Shift x10, mit Ctrl /10.
    // Bei gedruecktem Shift melden Browser den Tick oft als deltaX.
    var delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    if (delta === 0) return;
    var schritt = ev.shiftKey ? 10 : (ev.ctrlKey || ev.metaKey) ? 0.1 : 1;
    el.value = Math.round((v + (delta < 0 ? schritt : -schritt)) * 10) / 10;
    el.dispatchEvent(new Event('change'));
  }, { passive: false });

  function zeichnePanel() {
    zeichneToolbereich();
    zustand.liveFelder = null;
    var inhalt = $('k3d-panel-inhalt');
    inhalt.innerHTML = '';
    if (zustand.dok.objekte.length === 0) {
      var p = document.createElement('p');
      p.className = 'k3d-panel-leer';
      p.textContent = 'Noch keine Objekte — wähle links einen Grundkörper.';
      inhalt.appendChild(p);
      return;
    }
    // Mehrfachauswahl: gemeinsame Farbwahl ueber der Liste -- ein Klick
    // faerbt alle gewaehlten Objekte (ein Undo-Schritt)
    if (zustand.auswahl.length > 1) {
      var gewaehlte = zustand.auswahl.map(function (id) { return D.findeKnoten(zustand.dok, id); }).filter(Boolean);
      if (gewaehlte.length > 1) {
        var mehrfach = document.createElement('div');
        mehrfach.className = 'k3d-mehrfach';
        var mt = document.createElement('p');
        mt.className = 'k3d-panel-leer';
        mt.textContent = gewaehlte.length + ' Objekte ausgewählt';
        mehrfach.appendChild(mt);
        mehrfach.appendChild(baueFarbwahl(gewaehlte));
        inhalt.appendChild(mehrfach);
      }
    }
    var liste = document.createElement('div');
    liste.className = 'k3d-liste';
    zustand.dok.objekte.forEach(function (k) {
      liste.appendChild(baueZeile(k));
      if (zustand.auswahl.length === 1 && zustand.auswahl[0] === k.id) {
        liste.appendChild(baueDetails(k));
      }
    });
    inhalt.appendChild(liste);
  }

  function baueZeile(k) {
    var zeile = document.createElement('div');
    zeile.className = 'k3d-zeile' + (zustand.auswahl.indexOf(k.id) >= 0 ? ' k3d-zeile-aktiv' : '');
    zeile.setAttribute('data-id', k.id);

    var versteckt = k.sichtbar === false;
    var auge = document.createElement('button');
    auge.type = 'button';
    auge.className = 'k3d-auge';
    auge.title = versteckt ? 'Objekt einblenden' : 'Objekt ausblenden (nur Ansicht — Export bleibt vollständig)';
    auge.innerHTML = versteckt ? SVG_AUGE_ZU : SVG_AUGE_AUF;
    auge.addEventListener('click', function (e) {
      e.stopPropagation();   // Auge-Klick aendert die Auswahl nicht
      D.setzeSichtbar(zustand.dok, k.id, versteckt);
      nachAenderung();
      zeichnePanel();
    });
    zeile.appendChild(auge);
    var istTransparent = !!(zustand.viewport && zustand.viewport.transparente[k.id]);
    var roentgen = document.createElement('button');
    roentgen.type = 'button';
    roentgen.className = 'k3d-roentgen' + (istTransparent ? ' k3d-roentgen-aktiv' : '');
    roentgen.title = istTransparent ? 'Wieder deckend darstellen'
      : 'Transparent darstellen (nur Ansicht — zeigt Hohlräume)';
    roentgen.innerHTML = istTransparent ? SVG_ROENTGEN_AN : SVG_ROENTGEN_AUS;
    roentgen.addEventListener('click', function (e) {
      e.stopPropagation();   // aendert die Auswahl nicht
      zustand.viewport.setzeTransparenz(k.id, !istTransparent);
      zeichnePanel();        // Icon-Zustand der Zeile auffrischen; kein nachAenderung: kein Dokument-Change
    });
    zeile.appendChild(roentgen);
    if (versteckt) zeile.classList.add('k3d-zeile-versteckt');

    var name = document.createElement('span');
    name.className = 'k3d-zeile-name';
    name.textContent = k.name + (k.istLoch ? ' (Negativ)' : '');
    name.title = name.textContent;
    if (D.enthaeltNichtWasserdicht(k)) {
      name.classList.add('k3d-zeile-undicht');
      name.title += ' — nicht wasserdicht: platzieren und exportieren geht, als Negativ oder in Gruppen nicht.';
    }
    zeile.appendChild(name);

    var korb = document.createElement('button');
    korb.type = 'button';
    korb.className = 'k3d-papierkorb';
    korb.title = 'Objekt löschen';
    korb.innerHTML = SVG_PAPIERKORB;
    korb.addEventListener('click', function (e) {
      e.stopPropagation();   // Korb-Klick aendert die Auswahl nicht
      if (!window.confirm('«' + k.name + '» löschen?')) return;
      D.entferneKnoten(zustand.dok, k.id);
      setzeAuswahl(zustand.auswahl.filter(function (x) { return x !== k.id; }));
      nachAenderung();
    });
    zeile.appendChild(korb);

    zeile.addEventListener('click', function (e) { klickAufZeile(k.id, e); });
    return zeile;
  }

  // 16 kuratierte Farben, 8x2 im Akkordeon; Standard-Blau ist enthalten
  var PALETTE = [
    '#f2f2f2', '#b3b3b3', '#4d4d4d', '#1a1a1a',
    '#d64541', '#e87e2d', '#e8c33d', '#4caf50',
    '#1f7a33', '#26a69a', '#64b5f6', '#5a8dc8',
    '#34558b', '#8e6cc0', '#e57fb1', '#8d6e63'
  ];

  // Nimmt einen Knoten oder eine Liste: bei mehreren wird die Farbe auf
  // alle angewendet (EIN Undo-Schritt); die aktive Kachel markiert nur eine
  // Farbe, die wirklich alle gemeinsam haben.
  function baueFarbwahl(ks) {
    var knotenListe = Array.isArray(ks) ? ks : [ks];
    var gemeinsam = knotenListe.every(function (k) { return k.farbe === knotenListe[0].farbe; })
      ? knotenListe[0].farbe : null;
    function setzeAlle(farbe) {
      knotenListe.forEach(function (k) { D.setzeFarbe(zustand.dok, k.id, farbe); });
      nachAenderung();
      zeichnePanel();
    }
    var wrap = document.createElement('div');
    wrap.className = 'k3d-farbwahl';
    var titel = document.createElement('span');
    titel.className = 'k3d-farbwahl-titel';
    titel.textContent = 'Farbe';
    wrap.appendChild(titel);
    var kacheln = document.createElement('div');
    kacheln.className = 'k3d-farben';
    PALETTE.forEach(function (farbe) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'k3d-farbkachel' + (farbe === gemeinsam ? ' aktiv' : '');
      b.style.background = farbe;
      b.title = farbe;
      b.addEventListener('click', function () { setzeAlle(farbe); });
      kacheln.appendChild(b);
    });
    var frei = document.createElement('input');
    frei.type = 'color';
    frei.className = 'k3d-farbe-frei';
    frei.value = /^#[0-9a-f]{6}$/i.test(gemeinsam || '') ? gemeinsam : D.STANDARD_FARBE;
    frei.title = 'Eigene Farbe wählen';
    // 'change' statt 'input': sonst wird jede Mausbewegung im
    // Browser-Farbdialog ein eigener Undo-Schritt
    frei.addEventListener('change', function () { setzeAlle(frei.value); });
    kacheln.appendChild(frei);
    wrap.appendChild(kacheln);
    return wrap;
  }

  function baueDetails(k) {
    var dt = document.createElement('div');
    dt.className = 'k3d-details';

    var nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 60;
    nameInput.value = k.name;
    nameInput.addEventListener('change', function () {
      var v = nameInput.value.trim();
      if (!v) { nameInput.value = k.name; return; }   // leer -> alter Name bleibt
      k.name = v;
      nachAenderung();
      zeichnePanel();
    });
    nameLabel.appendChild(nameInput);
    dt.appendChild(nameLabel);
    dt.appendChild(baueFarbwahl(k));

    function feld(beschriftung, wert, beiAenderung) {
      var l = document.createElement('label');
      l.textContent = beschriftung;
      var i = document.createElement('input');
      i.type = 'text';             // text statt number: erlaubt Rechenausdruecke
      i.inputMode = 'decimal';
      i.className = 'k3d-zahl';
      i.value = wert;
      i.addEventListener('change', function () {
        var v = rechne(i.value);
        if (v === null) { i.value = wert; return; }
        beiAenderung(v);
        nachAenderung();
        zeichnePanel();
      });
      l.appendChild(i);
      dt.appendChild(l);
      return i;
    }

    // Zielmass in mm setzt die Skalierung der Achse (Basis = unskalierte BBox).
    // Import: BBox aus dem Asset; Gruppe: BBox des gemergten Meshes im Viewport.
    var basis = null;
    if (k.typ === 'import') {
      var asset = window.KlotzwerkAssets.hole(k.params.assetId);
      if (asset) basis = IO.bboxGroesse(asset.vertProperties);
    } else if (k.typ === 'gruppe') {
      basis = zustand.viewport.holeBasisGroesse(k.id);
    }
    // Referenzen fuer den Live-Sync waehrend des Gizmo-Drags
    zustand.liveFelder = { id: k.id, basis: basis, groesse: [], position: [], drehung: [] };
    if (basis) {
      ['X', 'Y', 'Z'].forEach(function (achse, i) {
        if (basis[i] <= 0) return;
        zustand.liveFelder.groesse[i] = feld('Grösse ' + achse + ' (mm)', Math.round(basis[i] * k.transform.skalierung[i] * 10) / 10, function (v) {
          k.transform.skalierung[i] = Math.max(v, 0.1) / basis[i];
        });
      });
    }
    if (k.typ === 'import') {
      var info = document.createElement('p');
      info.className = 'k3d-panel-leer';
      info.textContent = k.params.dreiecke + ' Dreiecke · ' +
        (k.params.wasserdicht ? 'wasserdicht' : 'nicht wasserdicht — nur platzieren und exportieren');
      dt.appendChild(info);
    } else if (k.typ !== 'gruppe') {
      Object.keys(k.params).forEach(function (name) {
        feld(PARAM_LABELS[name] || name, k.params[name], function (v) {
          // Masse muessen positiv bleiben (Durchmesser oben 0 = Kegelspitze ist erlaubt)
          k.params[name] = (name === 'durchmesserOben') ? Math.max(v, 0) : Math.max(v, 0.1);
        });
      });
    }
    ['X', 'Y', 'Z'].forEach(function (achse, i) {
      zustand.liveFelder.position[i] = feld('Position ' + achse + ' (mm)', k.transform.position[i], function (v) { k.transform.position[i] = v; });
    });
    ['X', 'Y', 'Z'].forEach(function (achse, i) {
      zustand.liveFelder.drehung[i] = feld('Drehung ' + achse + ' (°)', k.transform.rotation[i], function (v) { k.transform.rotation[i] = v; });
    });
    return dt;
  }

  function aktualisiereWerkzeugleiste() {
    var n = zustand.auswahl.length;
    var einzel = n === 1 ? D.findeKnoten(zustand.dok, zustand.auswahl[0]) : null;
    var nichtWasserdicht = zustand.auswahl.some(function (id) {
      var k = D.findeKnoten(zustand.dok, id);
      return !!(k && D.enthaeltNichtWasserdicht(k));
    });
    var schnittAktiv = !!zustand.schnitt;
    var offsetAktiv = !!zustand.offset;
    var anlegenAktiv = !!zustand.anlegen;
    var kanalAktiv = !!zustand.kanal;
    var streckenAktiv = !!zustand.strecken;
    var messenAktiv = !!zustand.messen;
    var boxAktiv = !!zustand.boxauswahl;
    var einzelVersteckt = !!(einzel && einzel.sichtbar === false);
    // boxAktiv zaehlt bewusst NICHT als modusAktiv: die Aktions-Knoepfe
    // (Gruppieren, Negativ, Loeschen, ...) bleiben im Auswahl-Modus nutzbar.
    var modusAktiv = schnittAktiv || offsetAktiv || anlegenAktiv || kanalAktiv || streckenAktiv || messenAktiv;
    $('btn-schneiden').disabled = !schnittAktiv && (n !== 1 || nichtWasserdicht || !zustand.engineBereit || offsetAktiv || anlegenAktiv || kanalAktiv || streckenAktiv || messenAktiv || boxAktiv);
    $('btn-strecken').disabled = !streckenAktiv && (n !== 1 || nichtWasserdicht || !zustand.engineBereit || schnittAktiv || offsetAktiv || anlegenAktiv || kanalAktiv || messenAktiv || boxAktiv);
    $('btn-aushoehlen').disabled = !offsetAktiv && !kanalAktiv && (n !== 1 || nichtWasserdicht || !zustand.engineBereit || schnittAktiv || anlegenAktiv || streckenAktiv || messenAktiv || boxAktiv);
    $('btn-aufdicken').disabled = !offsetAktiv && (n !== 1 || nichtWasserdicht || !zustand.engineBereit || schnittAktiv || anlegenAktiv || kanalAktiv || streckenAktiv || messenAktiv || boxAktiv);
    $('btn-abtragen').disabled = $('btn-aufdicken').disabled;
    $('btn-anlegen').disabled = !anlegenAktiv && (n !== 1 || einzelVersteckt || schnittAktiv || offsetAktiv || kanalAktiv || streckenAktiv || messenAktiv || boxAktiv);
    // Messen/Auswaehlen brauchen keine Auswahl -- nur ein anderer aktiver Modus sperrt
    $('btn-messen').disabled = !messenAktiv && (schnittAktiv || offsetAktiv || anlegenAktiv || kanalAktiv || streckenAktiv || boxAktiv);
    $('btn-auswaehlen').disabled = !boxAktiv && (schnittAktiv || offsetAktiv || anlegenAktiv || kanalAktiv || streckenAktiv || messenAktiv);
    // Bewusst OHNE pauschale nichtWasserdicht-Sperre: nicht-wasserdichte
    // Importe sind der Haupt-Anwendungsfall (Multi-Shell-STLs). Nur Gruppen,
    // die nicht-wasserdichte Kinder ENTHALTEN, bleiben gesperrt -- die
    // muessten zum Trennen verrechnet werden, was dort nicht geht.
    $('btn-auftrennen').disabled = modusAktiv || n !== 1 || !zustand.engineBereit ||
      (nichtWasserdicht && !(einzel && einzel.typ === 'import'));
    $('btn-loch').disabled = modusAktiv || n === 0 || nichtWasserdicht;
    $('btn-gruppieren').disabled = modusAktiv || n < 2 || nichtWasserdicht;
    $('btn-ueberschneiden').disabled = modusAktiv || n < 2 || nichtWasserdicht;
    $('btn-aufloesen').disabled = modusAktiv || !(einzel && einzel.typ === 'gruppe');
    $('btn-duplizieren').disabled = modusAktiv || n !== 1;
    $('btn-loeschen').disabled = modusAktiv || n === 0;
    $('btn-undo').disabled = modusAktiv || !H.kannRueckgaengig(zustand.historie);
    $('btn-redo').disabled = modusAktiv || !H.kannWiederholen(zustand.historie);
  }

  function undo() {
    var dok = H.rueckgaengig(zustand.historie);
    if (!dok) return;
    zustand.dok = dok;
    setzeAuswahl([]);
    if (!IO.speichereAutosave(D.serialisiere(zustand.dok))) {
      setStatus('Automatisches Speichern fehlgeschlagen (Speicher voll?). Lade dein Projekt als STL herunter.', true);
    }
    zeichneAlles();
    aktualisiereWerkzeugleiste();
  }

  function redo() {
    var dok = H.wiederholen(zustand.historie);
    if (!dok) return;
    zustand.dok = dok;
    setzeAuswahl([]);
    if (!IO.speichereAutosave(D.serialisiere(zustand.dok))) {
      setStatus('Automatisches Speichern fehlgeschlagen (Speicher voll?). Lade dein Projekt als STL herunter.', true);
    }
    zeichneAlles();
    aktualisiereWerkzeugleiste();
  }

  // --- Export, Neues Projekt -----------------------------------------------

  function exportiereVerrechnet(objekte, danach) {
    if (objekte.length === 0) {
      setStatus('Noch nichts zu exportieren — platziere zuerst einen Körper.', true);
      return;
    }
    if (!zustand.engineBereit) {
      setStatus('Die Engine lädt noch — einen Moment.', true);
      return;
    }
    setStatus('Modell wird verrechnet …');
    // Nicht wasserdichte Importe koennen nicht durch die CSG: ihre Dreiecke
    // werden transformiert und roh ans Ergebnis angehaengt (STL erlaubt das).
    var roh = [], verrechenbar = [];
    objekte.forEach(function (k) {
      if (k.typ === 'import' && !k.params.wasserdicht) roh.push(k); else verrechenbar.push(k);
    });
    var fertig = function (csgDaten) {
      var teile = csgDaten ? [csgDaten] : [];
      roh.forEach(function (k) {
        var asset = window.KlotzwerkAssets.hole(k.params.assetId);
        if (!asset) return;
        teile.push({
          vertProperties: IO.transformiereVertices(asset.vertProperties, D.matAusTransform(k.transform)),
          triVerts: asset.triVerts
        });
      });
      if (teile.length === 0) {
        setStatus('Das Ergebnis ist leer — die Negative entfernen alles.', true);
        return;
      }
      var m = IO.verbindeMeshes(teile);
      setStatus('Bereit.');
      danach(IO.baueBinaerSTL(m.vertProperties, m.triVerts));
    };
    if (verrechenbar.length === 0) { fertig(null); return; }
    var wurzel = {
      id: 'probe', typ: 'gruppe', istLoch: false,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
      kinder: verrechenbar
    };
    frageMesh(wurzel).then(fertig).catch(function (err) {
      setStatus('Verrechnen fehlgeschlagen (' + err.message + ').', true);
    });
  }

  function exportiereSTL(danach) {
    exportiereVerrechnet(zustand.dok.objekte, danach);
  }

  // Oeffentliche API fuer Einbettungen (z.B. teil3.ch).
  window.Klotzwerk = { exportiereSTL: exportiereSTL };

  // Farbiger Export (OBJ/3MF): ein Mesh PRO Objekt, damit die Farben
  // erhalten bleiben. Top-Level-Negative im Export-Umfang werden von jedem
  // Solid abgezogen (gleiche Semantik wie der verschmolzene STL-Export);
  // nicht wasserdichte Importe gehen roh mit ihrer Farbe mit.
  function sammleFarbTeile(objekte) {
    var loecher = objekte.filter(function (k) {
      return k.istLoch && !(k.typ === 'import' && !k.params.wasserdicht);
    });
    var anfragen = [];
    objekte.forEach(function (k) {
      if (k.istLoch) return;   // Negative sind keine eigenen Koerper
      if (k.typ === 'import' && !k.params.wasserdicht) {
        var asset = window.KlotzwerkAssets.hole(k.params.assetId);
        if (asset) {
          anfragen.push(Promise.resolve({
            id: k.id, name: k.name, farbe: k.farbe,
            vertProperties: IO.transformiereVertices(asset.vertProperties, D.matAusTransform(k.transform)),
            triVerts: asset.triVerts
          }));
        }
        return;
      }
      var wurzel = {
        id: 'export-' + k.id, typ: 'gruppe', istLoch: false,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
        kinder: [k].concat(loecher)
      };
      anfragen.push(frageMesh(wurzel).then(function (daten) {
        return daten ? { id: k.id, name: k.name, farbe: k.farbe,
                         vertProperties: daten.vertProperties, triVerts: daten.triVerts } : null;
      }));
    });
    return Promise.all(anfragen).then(function (teile) { return teile.filter(Boolean); });
  }

  function fuehreExportAus(umfang, format, einzelteile) {
    var objekte = umfang === 'auswahl'
      ? zustand.dok.objekte.filter(function (k) { return zustand.auswahl.indexOf(k.id) >= 0; })
      : zustand.dok.objekte;
    if (format === 'stl' && einzelteile) {
      // Einzelteile-Export (wie Onshape): eine STL pro eindeutigem Teil,
      // gebuendelt als ZIP. Verrechnung pro Teil wie beim Farb-Export
      // (Negative werden von jedem Solid abgezogen).
      if (objekte.length === 0) {
        setStatus('Noch nichts zu exportieren — platziere zuerst einen Körper.', true);
        return;
      }
      setStatus('Modell wird verrechnet …');
      var gruppiert = IO.gruppiereEindeutigeTeile(objekte);
      var loecher = objekte.filter(function (k) { return k.istLoch; });
      var exportObjekte = gruppiert.teile.map(function (t) { return t.objekt; }).concat(loecher);
      sammleFarbTeile(exportObjekte).then(function (teile) {
        var nachId = {};
        gruppiert.teile.forEach(function (t) { nachId[t.objekt.id] = t; });
        var dateien = [];
        teile.forEach(function (teil) {
          var g = nachId[teil.id];
          if (!g) return;   // z.B. von den Negativen komplett entferntes Teil
          dateien.push({ name: g.dateiname, inhalt: new Uint8Array(IO.baueBinaerSTL(teil.vertProperties, teil.triVerts)) });
        });
        if (dateien.length === 0) {
          setStatus('Das Ergebnis ist leer — die Negative entfernen alles.', true);
          return;
        }
        setStatus('Bereit.');
        IO.downloadDatei(IO.baueZip(dateien), 'teil3-konstruktion-teile.zip', 'application/zip');
      }).catch(function (err) {
        setStatus('Verrechnen fehlgeschlagen (' + err.message + ').', true);
      });
      return;
    }
    if (format === 'stl') {
      exportiereVerrechnet(objekte, function (buf) { IO.downloadDatei(buf, 'teil3-konstruktion.stl'); });
      return;
    }
    if (objekte.length === 0) {
      setStatus('Noch nichts zu exportieren — platziere zuerst einen Körper.', true);
      return;
    }
    setStatus('Modell wird verrechnet …');
    sammleFarbTeile(objekte).then(function (teile) {
      if (teile.length === 0) {
        setStatus('Das Ergebnis ist leer — die Negative entfernen alles.', true);
        return;
      }
      setStatus('Bereit.');
      if (format === 'obj') {
        var erg = IO.baueOBJ(teile, 'teil3-konstruktion.mtl');
        IO.downloadDatei(erg.obj, 'teil3-konstruktion.obj', 'model/obj');
        IO.downloadDatei(erg.mtl, 'teil3-konstruktion.mtl', 'text/plain');
      } else {
        IO.downloadDatei(IO.baue3MF(teile), 'teil3-konstruktion.3mf', 'model/3mf');
      }
    }).catch(function (err) {
      setStatus('Verrechnen fehlgeschlagen (' + err.message + ').', true);
    });
  }

  // Export-Dialog: zuerst Umfang (Szene/Auswahl) und Format waehlen.
  function zeigeExportDialog() {
    if (zustand.dok.objekte.length === 0) {
      setStatus('Noch nichts zu exportieren — platziere zuerst einen Körper.', true);
      return;
    }
    if (!zustand.engineBereit) {
      setStatus('Die Engine lädt noch — einen Moment.', true);
      return;
    }
    var altHinter = document.querySelector('.k3d-dialog-hinter');
    if (altHinter) altHinter.remove();
    var anzahlAuswahl = zustand.dok.objekte.filter(function (k) {
      return zustand.auswahl.indexOf(k.id) >= 0;
    }).length;
    var hinter = document.createElement('div');
    hinter.className = 'k3d-dialog-hinter';
    var dialog = document.createElement('div');
    dialog.className = 'k3d-dialog';
    var titel = document.createElement('p');
    titel.className = 'k3d-dialog-titel';
    titel.textContent = 'Exportieren';
    dialog.appendChild(titel);
    function radioGruppe(legende, name, optionen) {
      var fs = document.createElement('fieldset');
      var lg = document.createElement('legend');
      lg.textContent = legende;
      fs.appendChild(lg);
      optionen.forEach(function (o) {
        var label = document.createElement('label');
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = name;
        radio.value = o[0];
        radio.checked = !!o[2];
        radio.disabled = !!o[3];
        label.appendChild(radio);
        label.appendChild(document.createTextNode(o[1]));
        if (o[3]) label.style.opacity = '0.5';
        fs.appendChild(label);
      });
      dialog.appendChild(fs);
      return fs;
    }
    radioGruppe('Umfang', 'k3d-export-umfang', [
      ['szene', 'Ganze Szene (' + zustand.dok.objekte.length + ' Objekte)', anzahlAuswahl === 0],
      ['auswahl', 'Nur Auswahl (' + anzahlAuswahl + ' Objekte)', anzahlAuswahl > 0, anzahlAuswahl === 0]
    ]);
    radioGruppe('Format', 'k3d-export-format', [
      ['stl', 'STL', true],
      ['obj', 'OBJ mit Farben (+ MTL-Datei)'],
      ['3mf', '3MF mit Farben']
    ]);
    // Einzelteile-Option (nur STL): eine Datei pro eindeutigem Teil, als ZIP
    var einzelLabel = document.createElement('label');
    einzelLabel.className = 'k3d-export-einzel';
    var einzelBox = document.createElement('input');
    einzelBox.type = 'checkbox';
    einzelLabel.appendChild(einzelBox);
    einzelLabel.appendChild(document.createTextNode(
      ' Eindeutige Teile als einzelne STL-Dateien (ZIP) — gleiche Teile nur einmal, Stückzahl im Dateinamen'));
    dialog.appendChild(einzelLabel);
    function passeEinzelAn() {
      var stl = dialog.querySelector('input[name=k3d-export-format]:checked').value === 'stl';
      einzelBox.disabled = !stl;
      einzelLabel.style.opacity = stl ? '' : '0.5';
    }
    Array.prototype.forEach.call(dialog.querySelectorAll('input[name=k3d-export-format]'), function (r) {
      r.addEventListener('change', passeEinzelAn);
    });
    passeEinzelAn();
    var knoepfe = document.createElement('div');
    knoepfe.className = 'k3d-dialog-knoepfe';
    var bAb = document.createElement('button');
    bAb.type = 'button';
    bAb.className = 'btn btn-default';
    bAb.textContent = 'Abbrechen';
    var bOk = document.createElement('button');
    bOk.type = 'button';
    bOk.className = 'btn btn-primary';
    bOk.textContent = 'Exportieren';
    knoepfe.appendChild(bAb);
    knoepfe.appendChild(bOk);
    dialog.appendChild(knoepfe);
    hinter.appendChild(dialog);
    function schliessen() {
      hinter.remove();
      document.removeEventListener('keydown', beiTaste);
    }
    function beiTaste(e) { if (e.key === 'Escape') schliessen(); }
    document.addEventListener('keydown', beiTaste);
    hinter.addEventListener('click', function (e) { if (e.target === hinter) schliessen(); });
    bAb.addEventListener('click', schliessen);
    bOk.addEventListener('click', function () {
      var umfang = dialog.querySelector('input[name=k3d-export-umfang]:checked').value;
      var format = dialog.querySelector('input[name=k3d-export-format]:checked').value;
      var einzel = einzelBox.checked && !einzelBox.disabled;
      schliessen();
      fuehreExportAus(umfang, format, einzel);
    });
    // Im Vollbild werden Elemente ausserhalb des Fullscreen-Containers nicht
    // gerendert -- darum an die Seite haengen, nicht an den Body.
    (document.querySelector('.k3d-seite') || document.body).appendChild(hinter);
  }

  $('btn-download').addEventListener('click', zeigeExportDialog);

  // Zusatz-Aktionen der Einbettung: erscheinen als Buttons neben "Download".
  (window.KLOTZWERK_AKTIONEN || []).forEach(function (aktion) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = aktion.label;
    b.addEventListener('click', function () {
      exportiereSTL(function (buf) {
        b.disabled = true;
        aktion.ausfuehren(buf, function (fehler) {
          b.disabled = false;
          if (fehler) setStatus(fehler, true);
        });
      });
    });
    $('btn-download').parentNode.insertBefore(b, $('btn-download').nextSibling);
  });

  $('btn-neu').addEventListener('click', function () {
    if (zustand.dok.objekte.length > 0 && !window.confirm('Aktuelles Projekt verwerfen und neu beginnen?')) return;
    zustand.dok = D.neuesDokument();
    zustand.historie = H.neueHistorie(zustand.dok);
    zustand.meshCache = {};
    IO.loescheAutosave();
    window.KlotzwerkAssets.loescheAlle();
    window.KlotzwerkAssets.loescheDb().catch(function () { });
    zustand.worker.postMessage({ befehl: 'assetsLoeschen' });
    setzeAuswahl([]);
    zustand.viewport.versteckeSchnittebene();
    zustand.viewport.leereTransparenz();
    zeichneAlles();
    aktualisiereWerkzeugleiste();
    setStatus('Neues Projekt. Wähle links einen Grundkörper.');
  });

  // --- Vollbild-Toggle -----------------------------------------------------

  (function () {
    var btn = $('btn-vollbild');
    var seite = document.querySelector('.k3d-seite');
    if (!btn) return;
    if (!seite || !seite.requestFullscreen) {
      // Alte Browser ohne Fullscreen API: Knopf verstecken
      btn.style.display = 'none';
      return;
    }
    btn.addEventListener('click', function () {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        seite.requestFullscreen().catch(function (err) {
          setStatus('Vollbild nicht möglich (' + err.message + ').', true);
        });
      }
    });
    // Beschriftung folgt dem echten Zustand (auch bei Esc), danach muss der
    // Viewport die neue Groesse nachrechnen -- erst NACH dem Reflow, denn
    // fullscreenchange feuert, solange der Container noch die alte Groesse hat.
    document.addEventListener('fullscreenchange', function () {
      var drin = !!document.fullscreenElement;
      btn.textContent = drin ? 'Vollbild verlassen' : 'Vollbild';
      btn.title = drin ? 'Vollbild verlassen (Esc)' : 'Editor im Vollbild anzeigen';
      window.requestAnimationFrame(function () {
        if (zustand.viewport) zustand.viewport.passeGroesseAn();
      });
    });
  })();
})();

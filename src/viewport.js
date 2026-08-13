/*
 * three.js-Viewport des 3D-Konstruktors. Z ist oben (3D-Druck-Welt):
 * camera.up = (0,0,1), Raster liegt in der XY-Ebene.
 * Liest nur das Dokument; Aenderungen laufen als Callbacks zurueck zur UI.
 */
(function () {
  'use strict';

  var FARBE_LOCH = 0x9a9a9a;
  var EMISSIVE_AUSWAHL = 0x555555;   // Aufhell-Schimmer statt Umfaerbung

  var START_POSITION = [120, -160, 120];
  var START_TARGET = [0, 0, 10];

  // Richtungsvektoren fuer die Standard-Ansichten (Z-oben-Konvention).
  // oben/unten minimal aus der Senkrechten gekippt, damit OrbitControls
  // (up=(0,0,1)) nicht in der exakten Senkrechten degeneriert.
  var ANSICHT_RICHTUNG = {
    vorne:  [0, -1, 0],
    hinten: [0, 1, 0],
    links:  [-1, 0, 0],
    rechts: [1, 0, 0],
    oben:   [0, -0.0001, 1],
    unten:  [0, -0.0001, -1]
  };

  function initViewport(container, callbacks) {
    var szene = new THREE.Scene();
    szene.background = new THREE.Color(0xeef0f2);

    var kameraPersp = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    kameraPersp.up.set(0, 0, 1);
    kameraPersp.position.fromArray(START_POSITION);
    var kameraOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    kameraOrtho.up.set(0, 0, 1);
    // Aktive Kamera: alle internen Nutzer (Raycasts, Renderschleife,
    // Flug-Animation) lesen diese Variable, ein Tausch wirkt dort sofort.
    var kamera = kameraPersp;
    var projektion = 'perspektive';
    var orthoHoehe = 200;   // sichtbare Welt-Hoehe im Parallel-Modus (mm)
    // Fester Kamera-Abstand im Parallel-Modus: gross genug, dass die
    // near-Plane (0.1) nie ins Modell schneidet, klein genug fuer die
    // far-Plane (5000).
    var ORTHO_ABSTAND = 2000;
    var FOV_HALB_TAN = Math.tan(45 * Math.PI / 360);

    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    var orbit = new THREE.OrbitControls(kamera, renderer.domElement);
    orbit.target.fromArray(START_TARGET);

    var licht1 = new THREE.HemisphereLight(0xffffff, 0x666677, 0.9);
    licht1.position.set(0, 0, 1);
    szene.add(licht1);
    var licht2 = new THREE.DirectionalLight(0xffffff, 0.5);
    licht2.position.set(80, -120, 200);
    szene.add(licht2);

    // Arbeitsflaeche: konfigurierbares Liniengitter in der XY-Ebene (Z=0).
    // Geometrie kommt aus gitter.js, Einstellungen verwaltet die UI
    // (localStorage) und reicht sie ueber setzeArbeitsflaeche herein.
    var raster = null;
    var gitterKnopf = null;
    function setzeArbeitsflaeche(e) {
      if (raster) {
        szene.remove(raster);
        raster.children.forEach(function (c) { c.geometry.dispose(); c.material.dispose(); });
      }
      var pos = window.KlotzwerkGitter.linienPositionen(e.laenge, e.breite, e.abstand);
      raster = new THREE.Group();
      [[pos.linien, e.farbeLinien], [pos.mitte, e.farbeMitte]].forEach(function (paar) {
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(paar[0]), 3));
        raster.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(paar[1]) })));
      });
      raster.visible = e.sichtbar;
      szene.add(raster);
      if (gitterKnopf) aktualisiereGitterKnopf(e.sichtbar);
    }
    setzeArbeitsflaeche(window.KlotzwerkGitter.normalisiere(null));

    var GITTER_SVG = {
      an: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
        '<path d="M2 2 H14 V14 H2 Z M2 6 H14 M2 10 H14 M6 2 V14 M10 2 V14"' +
        ' fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
      aus: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
        '<path d="M2 2 H14 V14 H2 Z M2 6 H14 M2 10 H14 M6 2 V14 M10 2 V14"' +
        ' fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" opacity="0.35"/>' +
        '<path d="M2.5 13.5 L13.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    };
    function aktualisiereGitterKnopf(sichtbar) {
      gitterKnopf.innerHTML = sichtbar ? GITTER_SVG.an : GITTER_SVG.aus;
      gitterKnopf.title = sichtbar
        ? 'Arbeitsfläche: sichtbar — klicken zum Ausblenden'
        : 'Arbeitsfläche: ausgeblendet — klicken zum Einblenden';
    }

    // Drei Gizmos gleichzeitig (Tinkercad-Stil): Skalier-Griffe innen (0.75),
    // Ringe in der Mitte (1.0), Verschiebe-Pfeile aussen (1.25). Startet ein
    // Drag, werden die anderen zwei deaktiviert -- sonst greifen bei
    // ueberlappenden Griffen zwei Controls dieselbe Geste ab.
    var gizmos = [];
    var fangraster = 1;   // Fangraster in mm; null = frei (Dropdown unten rechts)
    function neuesGizmo(modus, groesse) {
      var g = new THREE.TransformControls(kamera, renderer.domElement);
      g.setMode(modus);
      g.setSize(groesse);
      g.setTranslationSnap(1);
      g.setRotationSnap(15 * Math.PI / 180);
      g.addEventListener('dragging-changed', function (e) {
        orbit.enabled = !e.value;
        gizmos.forEach(function (andere) { if (andere !== g) andere.enabled = !e.value; });
        if (e.value) {
          if (g.object === pivotProxy && pivotZiel) {
            dragStart = {
              proxyPos: pivotProxy.position.clone(), proxyQuat: pivotProxy.quaternion.clone(),
              meshPos: pivotZiel.position.clone(), meshQuat: pivotZiel.quaternion.clone(),
              meshScale: pivotZiel.scale.clone(),
              // Shift + Zentrum-Griff: nur den Pivot verschieben. Der Modus
              // rastet beim Drag-Start ein, sonst spraenge das Objekt beim
              // Loslassen von Shift um das aufgelaufene Delta.
              pivotNur: g === gizmoVerschieben && shiftGedrueckt && g.axis === 'XYZ'
            };
          }
          return;
        }
        var pivotNur = !!(dragStart && dragStart.pivotNur && g.object === pivotProxy);
        dragStart = null;
        var ziel = g.object === pivotProxy ? pivotZiel : g.object;
        if (g.object === pivotProxy && pivotZiel) {
          if (pivotNur) {
            pivotZiel.updateMatrixWorld();
            pivotLokal(pivotZiel).copy(pivotZiel.worldToLocal(pivotProxy.position.clone()));
          }
          syncPivotProxy();
        }
        if (ziel && !pivotNur) {
          callbacks.beiTransformEnde(ziel.userData.id, {
            position: [rund(ziel.position.x), rund(ziel.position.y), rund(ziel.position.z)],
            rotation: [rund(ziel.rotation.x * 180 / Math.PI), rund(ziel.rotation.y * 180 / Math.PI), rund(ziel.rotation.z * 180 / Math.PI)],
            skalierung: [rundFein(ziel.scale.x), rundFein(ziel.scale.y), rundFein(ziel.scale.z)]
          });
        }
      });
      szene.add(g);
      return g;
    }
    // Reihenfolge = Greif-Prioritaet bei ueberlappenden Pickern (das zuerst
    // registrierte Control gewinnt): Skalieren vor Drehen vor Verschieben,
    // sonst frisst der Verschiebe-Achsen-Picker die innen liegenden
    // Skalier-Griffe. Verschieben bleibt ueber die Pfeilspitzen aussen greifbar.
    var gizmoSkalieren = neuesGizmo('scale', 0.75);
    var gizmoDrehen = neuesGizmo('rotate', 1.0);
    var gizmoVerschieben = neuesGizmo('translate', 1.25);
    gizmos.push(gizmoSkalieren, gizmoDrehen, gizmoVerschieben);

    // Griffe entfernen, deren (unsichtbare) Picker die anderen Gizmos
    // verdecken: der Screen-Ring E des Dreh-Gizmos (Radius 1.25) liegt genau
    // auf den Verschiebe-Pfeilspitzen, die Frei-Dreh-Kugel XYZE und die
    // Uniform-Skalier-Griffe auf Zentrum bzw. Pfeilschaft.
    function entferneGriffe(g, modus, namen) {
      var teil = g.children[0];   // TransformControlsGizmo
      [teil.gizmo[modus], teil.picker[modus], teil.helper[modus]].forEach(function (gruppe) {
        if (!gruppe) return;
        for (var i = gruppe.children.length - 1; i >= 0; i--) {
          if (namen.indexOf(gruppe.children[i].name) >= 0) gruppe.remove(gruppe.children[i]);
        }
      });
    }
    entferneGriffe(gizmoDrehen, 'rotate', ['E', 'XYZE']);
    entferneGriffe(gizmoSkalieren, 'scale', ['XYZX', 'XYZY', 'XYZZ']);

    // Die Standard-Striche sind zu fein: GL-Linien sind immer 1px, darum wird
    // jede Linie (gerader Achsstab UND Kreisring) durch ein Rohr entlang
    // ihres Original-Pfads ersetzt; uebrige Griffe (Pfeilspitzen, Boxen)
    // werden vergroessert. Ringe werden zu kurzen Boegen mit Pfeilspitze an
    // beiden Enden (Tinkercad-Stil); der Picker deckt nur noch den Bogen ab,
    // nicht mehr den ganzen Kreis.
    var BOGEN_ANTEIL = 0.15;   // sichtbarer Ausschnitt des Halbkreis-Pfads

    function punkteAusLinie(kind) {
      var pos = kind.geometry.attributes.position;
      var pts = [];
      for (var j = 0; j < pos.count; j++) pts.push(new THREE.Vector3(pos.getX(j), pos.getY(j), pos.getZ(j)));
      if (pts.length > 2) {
        var behalt = Math.max(3, Math.round(pts.length * BOGEN_ANTEIL));
        pts = pts.slice(Math.floor((pts.length - behalt) / 2), Math.floor((pts.length - behalt) / 2) + behalt);
      }
      return pts;
    }
    function rohrGeometrie(pts, radius) {
      var kurve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts);
      return new THREE.TubeBufferGeometry(kurve, pts.length === 2 ? 1 : 48, radius, 6, false);
    }
    function vereinigeGeos(geos) {
      var gesamt = 0;
      geos.forEach(function (g) { gesamt += g.attributes.position.array.length; });
      var pos = new Float32Array(gesamt);
      var off = 0;
      geos.forEach(function (g) {
        pos.set(g.attributes.position.array, off);
        off += g.attributes.position.array.length;
        g.dispose();
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      return geo;
    }
    // Kegel-Pfeilspitze am Bogen-Ende, tangential ausgerichtet
    function pfeilGeometrie(spitzeVon, spitzeNach) {
      var tangente = spitzeNach.clone().sub(spitzeVon).normalize();
      var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangente);
      var basis = spitzeNach.clone().add(tangente.clone().multiplyScalar(0.06));
      var kegel = new THREE.ConeBufferGeometry(0.05, 0.12, 12).toNonIndexed();
      kegel.applyMatrix4(new THREE.Matrix4().compose(basis, q, new THREE.Vector3(1, 1, 1)));
      return kegel;
    }
    function bogenMitPfeilen(pts, radius) {
      return vereinigeGeos([
        rohrGeometrie(pts, radius).toNonIndexed(),
        pfeilGeometrie(pts[1], pts[0]),
        pfeilGeometrie(pts[pts.length - 2], pts[pts.length - 1])
      ]);
    }
    function verdickeGriffe(g, modus) {
      var teil = g.children[0];   // TransformControlsGizmo
      var gruppe = teil.gizmo[modus];
      for (var i = gruppe.children.length - 1; i >= 0; i--) {
        var kind = gruppe.children[i];
        if (kind.isLine) {
          var pts = punkteAusLinie(kind);
          var istBogen = pts.length > 2;
          var ersatz = new THREE.Mesh(
            istBogen ? bogenMitPfeilen(pts, 0.02) : rohrGeometrie(pts, 0.02),
            new THREE.MeshBasicMaterial({
              color: kind.material.color.getHex(), transparent: true, opacity: kind.material.opacity,
              depthTest: false, depthWrite: false, side: THREE.DoubleSide
            }));
          ersatz.name = kind.name;
          ersatz.position.copy(kind.position);
          ersatz.rotation.copy(kind.rotation);
          ersatz.scale.copy(kind.scale);
          gruppe.add(ersatz);
          gruppe.remove(kind);
          if (istBogen) {
            // Picker des Rings durch den blossen Bogen ersetzen: Drehen soll
            // nur am sichtbaren Handle greifen, nicht auf dem ganzen Kreis.
            // Geometrie-Raum passt, weil setupGizmo alle Setup-Rotationen in
            // die Geometrie einbrennt und die Kamera-Ausrichtung pro Frame
            // fuer alle gleichnamigen Handles identisch gesetzt wird.
            teil.picker[modus].children.forEach(function (p) {
              if (p.name !== kind.name) return;
              p.geometry.dispose();
              p.geometry = rohrGeometrie(pts, 0.12);
              p.position.set(0, 0, 0);
              p.rotation.set(0, 0, 0);
              p.scale.set(1, 1, 1);
            });
          }
        } else if (kind.isMesh) {
          kind.scale.multiplyScalar(1.4);
        }
      }
    }
    verdickeGriffe(gizmoVerschieben, 'translate');
    verdickeGriffe(gizmoDrehen, 'rotate');
    verdickeGriffe(gizmoSkalieren, 'scale');

    // Shift + Skalier-Griff = proportional skalieren: der Faktor der
    // gezogenen Achse wird waehrend des Drags auf alle drei Achsen angewendet.
    // Shift + Dreh-Ring = 90-Grad-Raster, Ctrl+Shift = 45 Grad. Ohne Modifier
    // haengt das Raster vom Mausabstand ab: innerhalb des Rings 15 Grad,
    // ausserhalb 1 Grad (Feinjustierung durch Wegziehen der Maus).
    // Modifier-Zustand aus den Pointer-Events (nicht keydown): funktioniert
    // auch, wenn die Taste erst mitten im Drag gedrueckt oder losgelassen wird.
    var shiftGedrueckt = false;
    function zeigerImDrehring(e) {
      var o = gizmoDrehen.object;
      if (!o) return true;
      // Ring-Radius 1 x Handle-Skalierung (TransformControls haelt die Gizmos
      // in Bildschirmgroesse konstant, der Faktor steckt in der Skalierung)
      var griff = gizmoDrehen.children[0].gizmo.rotate.children[0];
      if (!griff) return true;
      var mitte = o.getWorldPosition(new THREE.Vector3());
      var radius = griff.getWorldScale(new THREE.Vector3()).x;
      var rechts = new THREE.Vector3().setFromMatrixColumn(kamera.matrixWorld, 0);
      var rand = mitte.clone().add(rechts.multiplyScalar(radius));
      var r = renderer.domElement.getBoundingClientRect();
      function px(v) {
        var p = v.clone().project(kamera);
        return [(p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height];
      }
      var m = px(mitte), k = px(rand);
      var radiusPx = Math.hypot(k[0] - m[0], k[1] - m[1]);
      return Math.hypot(e.clientX - r.left - m[0], e.clientY - r.top - m[1]) <= radiusPx;
    }
    function merkeModifier(e) {
      shiftGedrueckt = e.shiftKey;
      var grad;
      if (e.shiftKey) grad = e.ctrlKey ? 45 : 90;
      else grad = zeigerImDrehring(e) ? 15 : 1;
      gizmoDrehen.setRotationSnap(grad * Math.PI / 180);
    }
    renderer.domElement.addEventListener('pointerdown', merkeModifier);
    renderer.domElement.addEventListener('pointermove', merkeModifier);
    var skalStart = null;
    gizmoSkalieren.addEventListener('dragging-changed', function (e) {
      skalStart = (e.value && gizmoSkalieren.object) ? gizmoSkalieren.object.scale.clone() : null;
    });
    gizmoSkalieren.addEventListener('objectChange', function () {
      if (!shiftGedrueckt || !skalStart || !gizmoSkalieren.object) return;
      var achse = { X: 'x', Y: 'y', Z: 'z' }[gizmoSkalieren.axis];
      if (!achse) return;
      var o = gizmoSkalieren.object;
      var faktor = o.scale[achse] / skalStart[achse];
      if (!isFinite(faktor) || faktor <= 0) return;
      o.scale.set(skalStart.x * faktor, skalStart.y * faktor, skalStart.z * faktor);
    });

    // --- Pivot-Proxy: die Gizmos haengen bei Objekten nicht am Mesh selbst,
    // sondern an einem verschiebbaren Drehpunkt. Shift + Zentrum-Griff
    // verschiebt nur den Pivot (in Mesh-Lokalkoordinaten gemerkt, Session-
    // fluechtig) -- damit laesst sich der Ursprung von Drehung und
    // Skalierung frei setzen. Die Schnittebene haengt weiterhin direkt.
    var pivotProxy = new THREE.Object3D();
    pivotProxy.userData.id = '__pivot';
    szene.add(pivotProxy);
    var pivotZiel = null;    // Mesh, das der Proxy steuert
    var dragStart = null;    // Transform-Schnappschuesse beim Drag-Start

    function pivotLokal(mesh) {
      if (!mesh.userData.pivotLokal) mesh.userData.pivotLokal = new THREE.Vector3();
      return mesh.userData.pivotLokal;
    }
    function syncPivotProxy() {
      if (!pivotZiel) return;
      pivotZiel.updateMatrixWorld();
      pivotProxy.position.copy(pivotZiel.localToWorld(pivotLokal(pivotZiel).clone()));
      // Quaternion mitkopieren: das Skalier-Gizmo arbeitet immer im lokalen
      // Raum seines Objekts, die Faktoren muessen den Mesh-Achsen entsprechen
      pivotProxy.quaternion.copy(pivotZiel.quaternion);
      pivotProxy.scale.set(1, 1, 1);
    }
    // Skalier-Faktoren so runden, dass die Masse (unskalierte BBox x Faktor)
    // auf dem Fangraster liegen; Minimum ein Rasterschritt, nie 0.
    // Achsen ohne Ausdehnung (BBox 0) bleiben unangetastet.
    function rasteSkalierung(mesh, fak) {
      if (!fangraster) return fak;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      var b = mesh.geometry.boundingBox;
      var basis = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
      return fak.map(function (f, i) {
        if (basis[i] <= 0) return f;
        var mass = Math.max(fangraster, Math.round(basis[i] * f / fangraster) * fangraster);
        return mass / basis[i];
      });
    }
    // Proxy-Delta seit Drag-Start auf das Mesh anwenden (Rotation und
    // Skalierung um den Pivot-Punkt, nicht um den Mesh-Ursprung)
    function wendePivotDeltaAn(g) {
      if (!dragStart || g.object !== pivotProxy || !pivotZiel) return;
      var m = pivotZiel;
      if (g === gizmoVerschieben) {
        if (dragStart.pivotNur) return;
        m.position.copy(dragStart.meshPos).add(pivotProxy.position).sub(dragStart.proxyPos);
      } else if (g === gizmoDrehen) {
        var q = pivotProxy.quaternion.clone().multiply(dragStart.proxyQuat.clone().invert());
        m.quaternion.copy(q).multiply(dragStart.meshQuat);
        m.position.copy(dragStart.meshPos).sub(dragStart.proxyPos).applyQuaternion(q).add(dragStart.proxyPos);
      } else {
        var s = pivotProxy.scale;
        var fak = rasteSkalierung(m, [
          dragStart.meshScale.x * s.x,
          dragStart.meshScale.y * s.y,
          dragStart.meshScale.z * s.z]);
        m.scale.set(fak[0], fak[1], fak[2]);
        // Versatz zum Pivot in Mesh-Lokalachsen skalieren -- mit den
        // GERASTETEN Faktoren, damit die gezogene Flaeche unterm Cursor bleibt
        var invQ = dragStart.meshQuat.clone().invert();
        var off = dragStart.meshPos.clone().sub(dragStart.proxyPos).applyQuaternion(invQ);
        // Guard: bei gespeicherter Skalierung 0 auf einer Achse (in "Frei"
        // erreichbar oder aus Alt-Dokumenten) wuerde fak[i]/meshScale nach
        // Infinity/NaN divergieren -- Objekt verschwindet, NaN landet im
        // Autosave. Fallback auf den rohen Proxy-Faktor der Achse.
        var qx = dragStart.meshScale.x !== 0 ? fak[0] / dragStart.meshScale.x : s.x;
        var qy = dragStart.meshScale.y !== 0 ? fak[1] / dragStart.meshScale.y : s.y;
        var qz = dragStart.meshScale.z !== 0 ? fak[2] / dragStart.meshScale.z : s.z;
        off.set(off.x * qx, off.y * qy, off.z * qz).applyQuaternion(dragStart.meshQuat);
        m.position.copy(dragStart.proxyPos).add(off);
      }
    }
    // Waehrend des Drags die aktuelle Pose an die UI melden -- nur Anzeige,
    // das Dokument wird erst bei beiTransformEnde aktualisiert. Guards wie
    // in wendePivotDeltaAn; pivotNur (Shift+Zentrum) bewegt das Objekt
    // nicht, die Schnittebene haengt nicht am Pivot-Proxy.
    function meldeTransformLive(g) {
      if (!callbacks.beiTransformLive || !dragStart || g.object !== pivotProxy || !pivotZiel) return;
      if (dragStart.pivotNur) return;
      var z = pivotZiel;
      callbacks.beiTransformLive(z.userData.id, {
        position: [rund(z.position.x), rund(z.position.y), rund(z.position.z)],
        rotation: [rund(z.rotation.x * 180 / Math.PI), rund(z.rotation.y * 180 / Math.PI), rund(z.rotation.z * 180 / Math.PI)],
        skalierung: [rundFein(z.scale.x), rundFein(z.scale.y), rundFein(z.scale.z)]
      });
    }
    gizmos.forEach(function (g) {
      g.addEventListener('objectChange', function () { wendePivotDeltaAn(g); meldeTransformLive(g); });
    });

    // Shift + Doppelklick nahe dem Gizmo-Zentrum: Pivot zurueck in die
    // geometrische Mitte des Objekts (BBox-Zentrum in Mesh-Lokalkoordinaten).
    // Pixel-Abstand statt Griff-Treffer: am Zentrum ueberlappen sich die
    // Picker (Ebenen-Quads, Skalier-Wuerfel), ein exakter XYZ-Hover ist
    // praktisch nicht zu treffen.
    renderer.domElement.addEventListener('dblclick', function (e) {
      if (!e.shiftKey || !pivotZiel) return;
      var r = renderer.domElement.getBoundingClientRect();
      var p = pivotProxy.position.clone().project(kamera);
      var sx = r.left + (p.x + 1) / 2 * r.width;
      var sy = r.top + (1 - p.y) / 2 * r.height;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.sqrt(dx * dx + dy * dy) > 40) return;
      var geo = pivotZiel.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      pivotLokal(pivotZiel).copy(geo.boundingBox.getCenter(new THREE.Vector3()));
      syncPivotProxy();
    });

    // mitSkalieren=false fuer die Schnittebene: eine Ebene skalieren ist sinnlos
    function gizmoAttach(objekt, mitSkalieren) {
      if (objekt.userData.id === '__schnittebene') {
        pivotZiel = null;
        gizmoVerschieben.attach(objekt);
        gizmoDrehen.attach(objekt);
        gizmoSkalieren.detach();
        return;
      }
      pivotZiel = objekt;
      syncPivotProxy();
      gizmoVerschieben.attach(pivotProxy);
      gizmoDrehen.attach(pivotProxy);
      if (mitSkalieren) gizmoSkalieren.attach(pivotProxy); else gizmoSkalieren.detach();
    }
    // objekt optional: ohne Argument alle loesen, sonst nur wenn dort (direkt
    // oder ueber den Pivot-Proxy) angehaengt
    function gizmoDetach(objekt) {
      gizmos.forEach(function (g) {
        if (!objekt || g.object === objekt || (g.object === pivotProxy && pivotZiel === objekt)) g.detach();
      });
      if (!objekt || pivotZiel === objekt) pivotZiel = null;
    }

    // Fangraster umschalten: Verschieben rastet ueber translationSnap,
    // Skalieren ueber rasteSkalierung (mm-Masse, nicht Faktoren)
    function setzeRaster(mm) {
      fangraster = mm;
      gizmos.forEach(function (g) { g.setTranslationSnap(mm); });
    }

    // Navigationswuerfel oben links im Viewport-Container
    var navWuerfel = window.KlotzwerkNavWuerfel && window.KlotzwerkNavWuerfel.initNavWuerfel(container, kamera, {
      beiAnsicht: function (richtung) { flieheZuAnsicht(richtung); },
      beiAnsichtVektor: function (vektor) { flieheZuVektor(vektor); },
      beiDrehen: function (deltaAzimut, deltaPolar) { dreheUmZiel(deltaAzimut, deltaPolar); }
    });

    // Heim-Ansicht: Standard-Blickrichtung, eingezoomt auf die Auswahl
    // (falls vorhanden) bzw. alle sichtbaren Objekte; leere Szene ->
    // Start-Ausschnitt. Formeln numerisch verifiziert in
    // tests/generators/3d-konstruktor.zoom.test.js.
    function heimAnsicht() {
      var ids = (vp.auswahl && vp.auswahl.length) ? vp.auswahl : Object.keys(vp.meshes);
      var box = new THREE.Box3();
      var leer = true;
      ids.forEach(function (id) {
        var m = vp.meshes[id];
        if (!m || !m.visible) return;
        m.updateMatrixWorld(true);
        box.expandByObject(m);
        leer = false;
      });
      var richtung = new THREE.Vector3().fromArray(START_POSITION)
        .sub(new THREE.Vector3().fromArray(START_TARGET)).normalize();
      var zentrum, radius;
      if (leer) {
        zentrum = new THREE.Vector3().fromArray(START_TARGET);
        radius = 80;   // entspricht etwa dem Start-Ausschnitt
      } else {
        zentrum = box.getCenter(new THREE.Vector3());
        radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
      }
      var marge = 1.2;
      var aspect = renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight);
      orbit.target.copy(zentrum);
      if (kamera.isOrthographicCamera) {
        kamera.position.copy(zentrum).addScaledVector(richtung, ORTHO_ABSTAND);
        var zielHoehe = 2 * radius * marge;
        kamera.zoom = Math.min(orthoHoehe / zielHoehe, orthoHoehe * aspect / zielHoehe);
        kamera.updateProjectionMatrix();
      } else {
        var dist = (radius * marge) / Math.min(FOV_HALB_TAN, FOV_HALB_TAN * aspect);
        kamera.position.copy(zentrum).addScaledVector(richtung, Math.max(0.5, Math.min(4000, dist)));
      }
      orbit.update();
    }

    // Heim-Knopf unterhalb des Navwuerfels
    if (navWuerfel) {
      var heimKnopf = document.createElement('button');
      heimKnopf.type = 'button';
      heimKnopf.className = 'k3d-heim-knopf';
      heimKnopf.title = 'Normalansicht — eingezoomt auf alle bzw. die ausgewählten Objekte';
      heimKnopf.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
        '<path d="M2 8 L8 2.5 L14 8 M4 7 L4 13.5 L12 13.5 L12 7"' +
        ' fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>';
      heimKnopf.addEventListener('click', heimAnsicht);
      var navOverlay = container.querySelector('.k3d-navwuerfel');
      if (navOverlay) navOverlay.appendChild(heimKnopf);
      // Gitter-Toggle unterhalb des Heim-Knopfs: blendet die Arbeitsflaeche
      // ein/aus. Zustand verwaltet die UI (localStorage), darum nur Callback.
      if (navOverlay) {
        gitterKnopf = document.createElement('button');
        gitterKnopf.type = 'button';
        gitterKnopf.className = 'k3d-gitter-knopf';
        aktualisiereGitterKnopf(!raster || raster.visible);
        gitterKnopf.addEventListener('click', function () {
          if (callbacks.beiGitterToggle) callbacks.beiGitterToggle();
        });
        navOverlay.appendChild(gitterKnopf);
      }
    }

    // Weiche Kamerafahrt (~300ms, ease-in-out) auf eine Standard-Ansicht.
    // orbit.target bleibt dabei unveraendert, orbit.update() laeuft in der
    // Renderschleife normal weiter -- es wird nur kamera.position gesetzt.
    var flugAnimation = null;
    function starteFlug(zielPosition) {
      var startPosition = kamera.position.clone();
      var startZeit = performance.now();
      var dauer = 300;
      flugAnimation = function (jetzt) {
        var t = Math.min(1, (jetzt - startZeit) / dauer);
        var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
        kamera.position.lerpVectors(startPosition, zielPosition, e);
        if (t >= 1) flugAnimation = null;
      };
    }

    // Drag auf dem Navigationswuerfel dreht die Hauptkamera um orbit.target,
    // analog zu einem Orbit-Drag in der Szene. Kugelkoordinaten bezogen auf
    // Z-oben (theta = Azimut in der XY-Ebene, phi = Polarwinkel ab +Z);
    // phi geklemmt, damit up=(0,0,1) nicht in der Senkrechten degeneriert.
    function dreheUmZiel(deltaAzimut, deltaPolar) {
      flugAnimation = null; // laufende Flug-Animation nicht mit dem Drag ueberlagern
      var offset = kamera.position.clone().sub(orbit.target);
      var radius = offset.length();
      var theta = Math.atan2(offset.y, offset.x);
      var phi = Math.acos(Math.min(1, Math.max(-1, offset.z / radius)));
      theta -= deltaAzimut;
      phi = Math.min(Math.PI - 0.05, Math.max(0.05, phi - deltaPolar));
      offset.x = radius * Math.sin(phi) * Math.cos(theta);
      offset.y = radius * Math.sin(phi) * Math.sin(theta);
      offset.z = radius * Math.cos(phi);
      kamera.position.copy(orbit.target).add(offset);
    }

    function flieheZuVektor(vektor) {
      var abstand = kamera.position.distanceTo(orbit.target);
      var ziel = new THREE.Vector3(vektor[0], vektor[1], vektor[2]).normalize()
        .multiplyScalar(abstand).add(orbit.target);
      starteFlug(ziel);
    }
    function flieheZuAnsicht(richtung) {
      var vektor = ANSICHT_RICHTUNG[richtung];
      if (!vektor) return;
      flieheZuVektor(vektor);
    }

    var vp = {
      szene: szene, kamera: kamera, renderer: renderer, orbit: orbit, gizmos: gizmos,
      meshes: {},          // id -> THREE.Mesh
      anfrageGen: {},      // id -> laufende Nummer der zuletzt gestarteten Anfrage
      auswahl: [],
      transparente: {},    // id -> true: Roentgen-Ansicht (nur Ansicht, nicht im Dokument)
      zeichne: zeichne, setzeAuswahl: setzeAuswahl,
      passeGroesseAn: passeGroesseAn, holeBasisGroesse: holeBasisGroesse,
      zeigeSchnittebene: zeigeSchnittebene, versteckeSchnittebene: versteckeSchnittebene,
      holeSchnittebene: holeSchnittebene, setzeSchnittebeneTransform: setzeSchnittebeneTransform,
      setzeSchnittRaster: setzeSchnittRaster,
      starteStreckVorschau: starteStreckVorschau, setzeStreckBreite: setzeStreckBreite,
      beendeStreckVorschau: beendeStreckVorschau,
      starteAnlegeModus: starteAnlegeModus, beendeAnlegeModus: beendeAnlegeModus,
      starteKanalModus: starteKanalModus, beendeKanalModus: beendeKanalModus,
      starteMessModus: starteMessModus, beendeMessModus: beendeMessModus,
      messungDistanz: messungDistanz,
      starteBoxModus: starteBoxModus, beendeBoxModus: beendeBoxModus,
      setzeBoxVerhalten: setzeBoxVerhalten,
      starteSelektorPick: starteSelektorPick, brichSelektorPickAb: brichSelektorPickAb,
      holeWeltBBox: holeWeltBBox,
      setzeArbeitsflaeche: setzeArbeitsflaeche,
      setzeKanalDurchmesser: setzeKanalDurchmesser, setzeKanalForm: setzeKanalForm,
      setzeRaster: setzeRaster, setzeTransparenz: setzeTransparenz,
      leereTransparenz: leereTransparenz, setzeProjektion: setzeProjektion
    };

    function rund(x) { return Math.round(x * 100) / 100; }
    // Feinere Rundung fuer Skalierungs-Faktoren: bei kleiner Basis-Groesse
    // und aktivem Fangraster verschiebt die grobe 2-Dezimal-Rundung von
    // rund() das gerasterte Mass sichtbar (z.B. Basis 20mm, Faktor 0.365
    // fuer 7.3mm -> rund() meldet 0.37 -> Sprung auf 7.4mm beim Loslassen).
    function rundFein(x) { return Math.round(x * 1e6) / 1e6; }

    // Unskalierte BBox-Abmessungen [dx, dy, dz] des Meshes eines Knotens
    // (Geometrie liegt im lokalen Raum, Transform steckt im Mesh).
    // null, solange das Mesh noch nicht berechnet ist.
    function holeBasisGroesse(id) {
      var mesh = vp.meshes[id];
      if (!mesh) return null;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      var b = mesh.geometry.boundingBox;
      return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    }

    function passeGroesseAn() {
      var w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h);
      var seitenverhaeltnis = h > 0 ? w / h : 1;
      if (kamera.isOrthographicCamera) {
        var halbH = orthoHoehe / 2, halbB = halbH * seitenverhaeltnis;
        kamera.left = -halbB; kamera.right = halbB;
        kamera.top = halbH; kamera.bottom = -halbH;
      } else {
        kamera.aspect = seitenverhaeltnis;
      }
      kamera.updateProjectionMatrix();
    }

    // Projektion umschalten: Pose und sichtbare Groesse werden uebernommen,
    // damit beim Wechsel weder Blickrichtung noch Zoomstufe springen.
    function setzeProjektion(art) {
      if (art !== 'perspektive' && art !== 'parallel') return;
      if (art === projektion) return;
      var alt = kamera;
      var distanz = alt.position.distanceTo(orbit.target);
      if (art === 'parallel') {
        // Sichtbare Hoehe der Perspektivkamera auf dieser Distanz
        orthoHoehe = 2 * distanz * FOV_HALB_TAN;
        kameraOrtho.zoom = 1;
        kamera = kameraOrtho;
        // Fuer den Ausschnitt ist die Distanz in Ortho egal, fuer das Clipping
        // NICHT: near/far messen ab der Kameraposition entlang der Blickachse.
        // Bei kleiner Distanz (nach Nah-Zoom, oder nach Rueckrechnung aus
        // einem starken Ortho-Zoom) wuerde die Modellvorderseite abgeschnitten.
        // Darum immer auf festen, grossen Abstand zuruecksetzen.
        kamera.position.copy(orbit.target)
          .add(alt.position.clone().sub(orbit.target).normalize().multiplyScalar(ORTHO_ABSTAND));
      } else {
        // In Ortho zoomt OrbitControls ueber .zoom statt ueber die Distanz --
        // den gezoomten Ausschnitt in eine Kamera-Distanz zurueckrechnen,
        // sonst stuende die Perspektivkamera beliebig nah oder fern.
        var sichtbar = orthoHoehe / (kameraOrtho.zoom || 1);
        var neueDistanz = sichtbar / (2 * FOV_HALB_TAN);
        var richtung = alt.position.clone().sub(orbit.target).normalize();
        kamera = kameraPersp;
        kamera.position.copy(orbit.target).add(richtung.multiplyScalar(neueDistanz));
      }
      kamera.quaternion.copy(alt.quaternion);
      kamera.up.copy(alt.up);
      projektion = art;
      orbit.object = kamera;
      gizmos.forEach(function (g) { g.camera = kamera; });
      if (navWuerfel && navWuerfel.setzeKamera) navWuerfel.setzeKamera(kamera);
      passeGroesseAn();
      orbit.update();
    }
    window.addEventListener('resize', passeGroesseAn);
    passeGroesseAn();

    // Klick-Auswahl per Raycast; Shift-Klick ergaenzt die Auswahl
    var ray = new THREE.Raycaster();
    var zeigt = new THREE.Vector2();

    // Scrollrad-Zoom zum Mauszeiger (wie Onshape/Tinkercad): der Punkt
    // unter dem Zeiger bleibt beim Zoomen an Ort. Capture-Listener auf dem
    // CONTAINER, damit OrbitControls das Wheel nie sieht (gleiches Element
    // haette keine Vorfahrt) -- dessen eigener Zoom zum Orbit-Zentrum
    // bleibt fuer Touch-Pinch aktiv. Formeln numerisch verifiziert in
    // tests/generators/3d-konstruktor.zoom.test.js.
    var ZOOM_SCHRITT = 0.9;
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (strecken) {
        // Im Strecken-Modus steuert das Rad die Breite statt des Zooms
        // (Schrittweite wie die Panel-Felder: Shift x10, Ctrl x0.1)
        var schrittS = e.shiftKey ? 10 : (e.ctrlKey || e.metaKey) ? 0.1 : 1;
        var neuB = strecken.breite + (e.deltaY < 0 ? schrittS : -schrittS);
        if (callbacks.beiStreckBreite) callbacks.beiStreckBreite(neuB);
        else setzeStreckBreite(neuB);
        return;
      }
      if (!orbit.enabled) return;   // waehrend Gizmo-Drag nicht zoomen
      var r = renderer.domElement.getBoundingClientRect();
      zeigt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      zeigt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(zeigt, kamera);
      // Fixpunkt P: Treffer auf einem sichtbaren Objekt, sonst auf der
      // Arbeitsflaeche (z=0), sonst auf der Ebene durchs Orbit-Zentrum
      // senkrecht zur Blickrichtung (Blick parallel zur Arbeitsflaeche).
      var meshes = Object.keys(vp.meshes).map(function (id) { return vp.meshes[id]; })
        .filter(function (m) { return m.visible; });
      var treffer = ray.intersectObjects(meshes, false);
      var P;
      if (treffer.length) {
        P = treffer[0].point.clone();
      } else {
        var ebene = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        P = ray.ray.intersectPlane(ebene, new THREE.Vector3());
        if (!P) {
          ebene.setFromNormalAndCoplanarPoint(
            kamera.getWorldDirection(new THREE.Vector3()), orbit.target);
          P = ray.ray.intersectPlane(ebene, new THREE.Vector3()) || orbit.target.clone();
        }
      }
      var s = e.deltaY > 0 ? 1 / ZOOM_SCHRITT : ZOOM_SCHRITT;
      if (kamera.isOrthographicCamera) {
        // Zoom-Faktor anpassen, dann Kamera+Ziel seitlich nachziehen,
        // damit P auf demselben Bildschirmpunkt bleibt.
        var zoomNeu = kamera.zoom / s;
        var hoeheNeu = orthoHoehe / zoomNeu;   // sichtbare Welt-Hoehe in mm
        if (hoeheNeu < 0.5 || hoeheNeu > 3000) return;
        kamera.zoom = zoomNeu;
        kamera.updateProjectionMatrix();
        var dir = orbit.target.clone().sub(kamera.position).normalize();
        var seitlich = P.clone().sub(kamera.position);
        seitlich.sub(dir.multiplyScalar(seitlich.dot(dir)));
        var shift = seitlich.multiplyScalar(1 - s);
        kamera.position.add(shift);
        orbit.target.add(shift);
      } else {
        // Kamera UND Orbit-Ziel um P skalieren: Blickrichtung bleibt,
        // P projiziert auf denselben Bildschirmpunkt.
        var distNeu = kamera.position.distanceTo(orbit.target) * s;
        if (distNeu < 0.5 || distNeu > 4000) return;
        kamera.position.sub(P).multiplyScalar(s).add(P);
        orbit.target.sub(P).multiplyScalar(s).add(P);
      }
      orbit.update();
    }, { capture: true, passive: false });

    var startXY = null;
    renderer.domElement.addEventListener('pointerdown', function (e) { startXY = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', function (e) {
      // Orbit-Drag nicht als Klick werten
      if (!startXY || Math.abs(e.clientX - startXY[0]) > 4 || Math.abs(e.clientY - startXY[1]) > 4) return;
      if (gizmos.some(function (g) { return g.dragging; })) return;
      if (kanal) { klickKanal(); return; }
      if (anlegen) { klickAnlegen(); return; }
      if (messen) { klickMessen(); return; }
      var r = renderer.domElement.getBoundingClientRect();
      zeigt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      zeigt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(zeigt, kamera);
      // Klicks auf die Schnittebene schlucken, damit sie waehrend des
      // Positionierens nicht die Auswahl dahinter aendert.
      if (schnittEbene && ray.intersectObject(schnittEbene, true).length) return;
      var liste = Object.keys(vp.meshes).map(function (id) { return vp.meshes[id]; })
        .filter(function (m) { return m.visible; });
      var treffer = ray.intersectObjects(liste, false);
      var neu = treffer.length ? [treffer[0].object.userData.id] : [];
      if (boxauswahl) {
        // Auswahl-Modus: erst die Selektor-Pick-Phase bedienen, sonst das
        // eingestellte Verhalten anwenden (Shift erzwingt Hinzufuegen)
        if (boxauswahl.selektorPick) {
          if (neu.length) {
            boxauswahl.selektorPick = false;
            if (callbacks.beiSelektorPick) callbacks.beiSelektorPick(neu[0]);
          }
          return;
        }
        var verhalten = e.shiftKey ? 'hinzufuegen' : boxauswahl.verhalten;
        callbacks.beiAuswahl(window.KlotzwerkAuswahl.wendeVerhaltenAn(vp.auswahl, neu, verhalten));
        return;
      }
      if (e.shiftKey && neu.length) {
        var idx = vp.auswahl.indexOf(neu[0]);
        neu = idx >= 0 ? vp.auswahl.filter(function (id) { return id !== neu[0]; }) : vp.auswahl.concat(neu);
      }
      callbacks.beiAuswahl(neu);
    });

    // Hover im Anlege-Modus: getroffene Flaeche hervorheben
    renderer.domElement.addEventListener('pointermove', function (e) {
      if (!anlegen) return;
      var r = renderer.domElement.getBoundingClientRect();
      zeigt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      zeigt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(zeigt, kamera);
      var kandidaten = [];
      if (anlegen.phase === 1) {
        kandidaten.push(vp.meshes[anlegen.zielId]);
      } else {
        // Das bewegte Objekt selbst gehoert MIT in den Raycast (statt es
        // auszuschliessen): nur so blockt es die dahinterliegende Platte und
        // andere Objekte, wie es die Spec verlangt ("Klicks aufs eigene
        // Objekt tun nichts"). Sonst ginge der Ray durchs eigene Mesh hindurch.
        Object.keys(vp.meshes).forEach(function (id) {
          if (vp.meshes[id].visible) kandidaten.push(vp.meshes[id]);
        });
        if (anlegen.platte) kandidaten.push(anlegen.platte);
      }
      var treffer = ray.intersectObjects(kandidaten, false);
      var neuId = null, neuFlaeche = null, platteHover = false;
      // Erster (naechster) Treffer entscheidet. Ist es das eigene Objekt,
      // gilt das als "nichts getroffen" -- kein hoverFlaeche, kein
      // platteHover, kein Highlight, auch wenn dahinter noch etwas laege.
      if (treffer.length && !(anlegen.phase === 2 && treffer[0].object.userData.id === anlegen.zielId)) {
        var erstes = treffer[0].object;
        if (anlegen.phase === 2 && erstes === anlegen.platte) {
          platteHover = true;
        } else {
          var mesh = erstes;
          var erg = analysiereFlaechen(mesh.userData.id);
          if (!erg && !anlegen.gemeldet[mesh.userData.id]) {
            anlegen.gemeldet[mesh.userData.id] = true;
            if (callbacks.beiAnlegenMeldung) {
              callbacks.beiAnlegenMeldung('Ein Zielobjekt hat zu viele Dreiecke zum Anlegen.');
            }
          }
          if (erg) {
            var fi = erg.dreieckZuFlaeche[treffer[0].faceIndex];
            if (fi >= 0) { neuId = mesh.userData.id; neuFlaeche = erg.flaechen[fi]; }
          }
        }
      }
      if (neuFlaeche !== anlegen.hoverFlaeche || platteHover !== anlegen.platteHover) {
        entferneOverlay(anlegen.overlayHover);
        anlegen.overlayHover = null;
        anlegen.hoverMeshId = neuId;
        anlegen.hoverFlaeche = neuFlaeche;
        anlegen.platteHover = platteHover;
        if (neuFlaeche) anlegen.overlayHover = flaechenOverlay(neuId, neuFlaeche, FARBE_FLAECHE, 0.5);
        if (anlegen.platte) anlegen.platte.material.opacity = platteHover ? 0.15 : 0;
      }
    });

    // Liefert Eckpunkte (Weltkoordinaten) und Normale eines Mesh-Dreiecks,
    // oder null bei degeneriertem Dreieck. Gemeinsam genutzt von Hover und
    // Klick im Kanal-Modus, damit beide dieselben Treffer akzeptieren/
    // verwerfen (kein Highlight auf einem Dreieck, das man nicht bohren kann).
    function dreieckAusTreffer(mesh, faceIndex) {
      mesh.updateMatrixWorld();
      var pos = mesh.geometry.attributes.position.array, idx = mesh.geometry.index.array;
      var punkte = [];
      for (var e = 0; e < 3; e++) {
        var vi = idx[faceIndex * 3 + e];
        var p = new THREE.Vector3(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).applyMatrix4(mesh.matrixWorld);
        punkte.push(p);
      }
      var n = punkte[1].clone().sub(punkte[0]).cross(punkte[2].clone().sub(punkte[0]));
      if (n.lengthSq() < 1e-12) return null;   // degeneriertes Dreieck: ignorieren
      n.normalize();
      return { punkte: punkte, normale: n };
    }

    // Hover im Kanal-Modus: getroffenes Dreieck des Zielobjekts hervorheben.
    // Rueckseitige Treffer (Normale zeigt zum Betrachter hin statt weg --
    // moeglich im Roentgen-Modus, da materialFuer dort DoubleSide setzt und
    // der Raycaster sonst Innenwaende/Hohlraeume treffen wuerde) werden wie
    // "nichts getroffen" behandelt: kein Highlight, kein Bohren moeglich.
    // Form 'flaeche': statt Kreis-Vorschau wird die ganze ebene Flaeche des
    // getroffenen Dreiecks hervorgehoben (wie im Anlege-Modus).
    renderer.domElement.addEventListener('pointermove', function (e) {
      if (!kanal) return;
      var mesh = vp.meshes[kanal.zielId];
      if (!mesh) return;
      var r = renderer.domElement.getBoundingClientRect();
      zeigt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      zeigt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(zeigt, kamera);
      var treffer = ray.intersectObject(mesh, false);
      var neu = null, neuFlaeche = null;
      kanal.punkt = null;
      if (treffer.length) {
        var dreieck = dreieckAusTreffer(mesh, treffer[0].faceIndex);
        if (dreieck && dreieck.normale.dot(ray.ray.direction) < 0) {
          neu = treffer[0].faceIndex;
          if (kanal.form === 'flaeche') {
            var analyse = analysiereKanalFlaechen();
            if (analyse) {
              var fi = analyse.dreieckZuFlaeche[neu];
              if (fi >= 0) neuFlaeche = analyse.flaechen[fi];
            } else if (!kanal.analyseGemeldet) {
              kanal.analyseGemeldet = true;
              if (callbacks.beiKanalMeldung) {
                callbacks.beiKanalMeldung('Das Objekt hat zu viele Dreiecke für die Flächen-Auswahl — nutze das runde Loch.');
              }
            }
            if (!neuFlaeche) neu = null;
          } else {
            // Der Bohrer sitzt am exakten Trefferpunkt, nicht am Dreieck --
            // Dreiecke sind je nach Triangulierung lange Tortenstuecke.
            kanal.punkt = treffer[0].point.clone();
            kanal.normale = dreieck.normale;
          }
        }
      }
      kanal.hoverIndex = neu;
      if (kanal.form === 'flaeche') {
        // Flaechen-Highlight nur beim Wechsel neu bauen
        if (neuFlaeche !== kanal.hoverFlaeche) {
          entferneOverlay(kanal.overlayHover);
          kanal.hoverFlaeche = neuFlaeche;
          kanal.overlayHover = neuFlaeche
            ? flaechenKonturOverlay(kanal.zielId, neuFlaeche)
            : null;
        }
      } else {
        // Die Vorschau folgt dem Zeiger, nicht dem Dreieck -- darum bei JEDER
        // Bewegung neu setzen, nicht nur beim Wechsel des getroffenen Dreiecks.
        entferneOverlay(kanal.overlayHover);
        kanal.overlayHover = kanal.punkt
          ? kanalOverlay(kanal.punkt, kanal.normale, kanal.durchmesser)
          : null;
      }
    });

    function materialFuer(knoten, ausgewaehlt) {
      // Ungueltige/fehlende Farbwerte (von Hand editierte Projektdatei)
      // fallen auf das Standard-Blau zurueck.
      var farbe = /^#[0-9a-f]{6}$/i.test(knoten.farbe || '') ? knoten.farbe : '#5a8dc8';
      var m = new THREE.MeshPhongMaterial({
        color: knoten.istLoch ? FARBE_LOCH : new THREE.Color(farbe),
        flatShading: true
      });
      if (vp.transparente[knoten.id]) {
        // Roentgen-Ansicht: ohne Depth-Write schimmern alle Flaechen durch,
        // DoubleSide zeigt die Rueckseiten der Hohlraumwaende.
        m.transparent = true; m.opacity = 0.3;
        m.depthWrite = false; m.side = THREE.DoubleSide;
      } else if (knoten.istLoch) { m.transparent = true; m.opacity = 0.45; }
      if (ausgewaehlt) m.emissive.setHex(EMISSIVE_AUSWAHL);
      return m;
    }

    function wendeTransformAn(mesh, t) {
      mesh.position.fromArray(t.position);
      mesh.rotation.set(t.rotation[0] * Math.PI / 180, t.rotation[1] * Math.PI / 180, t.rotation[2] * Math.PI / 180, 'XYZ');
      mesh.scale.fromArray(t.skalierung);
    }

    function zeichne(dok, meshHolen) {
      // Zeiger auf das zuletzt uebergebene Dokument merken: bei Undo/Redo wird
      // zustand.dok komplett ersetzt (nicht nur mutiert) -- Antworten, die noch
      // auf ein aelteres Dokument-Objekt zeigen, sollen sich gegen den
      // AKTUELLEN Stand pruefen, nicht gegen ihr eigenes (evtl. veraltetes) dok.
      vp.aktuellesDok = dok;
      var vorhandene = {};
      dok.objekte.forEach(function (knoten) {
        vorhandene[knoten.id] = true;
        var mesh = vp.meshes[knoten.id];
        var schluessel = knoten.id + '|' + (knoten.modus || '') + '|' + JSON.stringify(knoten.typ === 'gruppe' ? knoten.kinder : knoten.params);
        if (mesh && mesh.userData.geoSchluessel !== schluessel) {
          // Geometrie veraltet (Params geaendert): neu holen
          szene.remove(mesh);
          gizmoDetach(mesh);
          // Kanal-Vorschau zeigt auf die alte Geometrie -- Punkt, Kreis und
          // Flaechen-Analyse sind nach dem Neuaufbau ungueltig, der naechste
          // Hover setzt neu.
          if (kanal && kanal.zielId === knoten.id) {
            entferneOverlay(kanal.overlayHover);
            kanal.overlayHover = null;
            kanal.hoverIndex = null;
            kanal.hoverFlaeche = null;
            kanal.analyse = undefined;
            kanal.punkt = null;
            kanal.normale = null;
          }
          mesh.geometry.dispose();
          mesh.material.dispose();
          delete vp.meshes[knoten.id];
          mesh = null;
        }
        if (!mesh) {
          // Anfrage-Generation je Knoten: veraltete oder fuer inzwischen
          // geloeschte/geaenderte Knoten eintreffende Antworten verwerfen.
          var gen = (vp.anfrageGen[knoten.id] || 0) + 1;
          vp.anfrageGen[knoten.id] = gen;
          meshHolen(knoten).then(function (daten) {
            if (vp.anfrageGen[knoten.id] !== gen) return;   // ueberholt, Antwort verwerfen
            var aktuell = findeTopLevel(vp.aktuellesDok, knoten.id, schluessel);
            if (!aktuell) return;                            // geloescht oder Params inzwischen erneut geaendert
            if (!daten) return;                       // leere Gruppe: nichts zeichnen
            if (vp.meshes[knoten.id]) return;         // Mesh inzwischen anderweitig gesetzt
            var g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(daten.vertProperties, 3));
            g.setIndex(new THREE.BufferAttribute(daten.triVerts, 1));
            g.computeVertexNormals();
            var m = new THREE.Mesh(g, materialFuer(knoten, vp.auswahl.indexOf(knoten.id) >= 0));
            m.userData.id = knoten.id;
            m.userData.geoSchluessel = schluessel;
            wendeTransformAn(m, aktuell.transform);
            m.visible = aktuell.sichtbar !== false;
            vp.meshes[knoten.id] = m;
            szene.add(m);
            if (callbacks.beiMeshBereit) callbacks.beiMeshBereit(knoten.id);
          }).catch(function (err) {
            if (callbacks.beiMeshFehler) {
              callbacks.beiMeshFehler('Objekt konnte nicht berechnet werden (' + err.message + ').');
            }
          });
        } else {
          wendeTransformAn(mesh, knoten.transform);
          mesh.visible = knoten.sichtbar !== false;
          mesh.material.dispose();
          mesh.material = materialFuer(knoten, vp.auswahl.indexOf(knoten.id) >= 0);
        }
      });
      Object.keys(vp.meshes).forEach(function (id) {
        if (!vorhandene[id]) {
          var m = vp.meshes[id];
          gizmoDetach(m);
          szene.remove(m);
          // Objekt ist weg: Kanal-Vorschau samt Trefferpunkt abraeumen,
          // sonst bleibt ein Kreis im Leeren stehen (WebGL-Leak).
          if (kanal && kanal.zielId === id) {
            entferneOverlay(kanal.overlayHover);
            kanal.overlayHover = null;
            kanal.hoverIndex = null;
            kanal.hoverFlaeche = null;
            kanal.analyse = undefined;
            kanal.punkt = null;
            kanal.normale = null;
          }
          m.geometry.dispose();
          m.material.dispose();
          delete vp.meshes[id];
          delete vp.transparente[id];
        }
      });
      // Auch Eintraege fuer Knoten aufraeumen, deren Mesh nie gebaut wurde
      // (z.B. noch ladende Anfrage bei Objekt-Loeschung) -- die Schleife
      // oben sieht nur vp.meshes, nicht das Dokument.
      Object.keys(vp.transparente).forEach(function (id) {
        if (!vorhandene[id]) delete vp.transparente[id];
      });
    }

    // Top-Level-Knoten mit passendem geoSchluessel im aktuellen Dokument
    // suchen -- liefert null, wenn geloescht oder inzwischen erneut geaendert.
    function findeTopLevel(dok, id, schluessel) {
      for (var i = 0; i < dok.objekte.length; i++) {
        var k = dok.objekte[i];
        if (k.id !== id) continue;
        var aktuellerSchluessel = k.id + '|' + (k.modus || '') + '|' + JSON.stringify(k.typ === 'gruppe' ? k.kinder : k.params);
        return aktuellerSchluessel === schluessel ? k : null;
      }
      return null;
    }

    function setzeAuswahl(ids) {
      vp.auswahl = ids.slice();
      Object.keys(vp.meshes).forEach(function (id) {
        var mesh = vp.meshes[id];
        mesh.material.emissive.setHex(ids.indexOf(id) >= 0 ? EMISSIVE_AUSWAHL : 0x000000);
      });
      // Gizmo haengt am zuletzt ausgewaehlten Objekt -- ausser im Massstab-
      // oder Auswahl-Modus: dort wuerde es die Mess- bzw. Rahmen-Gesten
      // abfangen, sobald ein Redraw die Auswahl neu setzt.
      if (!messen && !boxauswahl && ids.length === 1 && vp.meshes[ids[0]] && vp.meshes[ids[0]].visible) gizmoAttach(vp.meshes[ids[0]], true);
      else gizmoDetach();
    }

    // Roentgen-Ansicht pro Objekt ein-/ausschalten. Reiner Ansichts-Zustand:
    // nicht im Dokument, kein Undo -- ueberlebt Redraws, weil materialFuer
    // die Map vp.transparente liest.
    function setzeTransparenz(id, an) {
      if (an) vp.transparente[id] = true;
      else delete vp.transparente[id];
      var mesh = vp.meshes[id];
      if (!mesh || !vp.aktuellesDok) return;
      var knoten = null;
      for (var i = 0; i < vp.aktuellesDok.objekte.length; i++) {
        if (vp.aktuellesDok.objekte[i].id === id) { knoten = vp.aktuellesDok.objekte[i]; break; }
      }
      if (!knoten) return;
      mesh.material.dispose();
      mesh.material = materialFuer(knoten, vp.auswahl.indexOf(id) >= 0);
    }

    // Roentgen-Zustand komplett leeren -- bei Dokumentwechsel (Projekt
    // oeffnen, Neu) noetig: IDs sind pro Dokument fortlaufend vergeben, ein
    // neues Dokument kann dieselbe ID wiederverwenden und wuerde sonst als
    // stale Transparenz-Eintrag ueberleben.
    function leereTransparenz() {
      vp.transparente = {};
    }

    // Schnittebene (Cut-Tool): sichtbare Ebene, am Gizmo positionierbar
    var schnittEbene = null;
    var rasterPlatten = [];   // passive Zusatz-Platten des Raster-Schnitts (Kinder der Anker-Platte)

    // Anlege-Modus: { phase: 1|2, zielId, flaecheA, analysen: {id -> Ergebnis|null},
    //   gemeldet: {id -> true}, hoverMeshId, hoverFlaeche, platteHover,
    //   overlayHover, overlayFest, platte }
    var anlegen = null;
    var FARBE_FLAECHE = 0x2e9e44;        // Hover-Highlight
    var FARBE_FLAECHE_FEST = 0x1f7a33;   // fixierte Flaeche A

    function analysiereFlaechen(id) {
      if (anlegen.analysen[id] !== undefined) return anlegen.analysen[id];
      var mesh = vp.meshes[id];
      var erg = null;
      if (mesh) {
        mesh.updateMatrixWorld();
        erg = window.KlotzwerkFlaechen.findeFlaechen(
          mesh.geometry.attributes.position.array,
          mesh.geometry.index.array,
          mesh.matrixWorld.elements
        );
      }
      anlegen.analysen[id] = erg;   // null = Mesh fehlt oder ueber Dreieckslimit
      return erg;
    }

    // Overlay-Mesh aus den Dreiecken einer Flaeche, als Kind des Objekt-Meshs
    // (Lokalkoordinaten, erbt dessen Transform)
    function flaechenOverlay(meshId, flaeche, farbe, opazitaet) {
      var mesh = vp.meshes[meshId];
      var pos = mesh.geometry.attributes.position.array, idx = mesh.geometry.index.array;
      var arr = new Float32Array(flaeche.dreiecke.length * 9);
      flaeche.dreiecke.forEach(function (t, i) {
        for (var e = 0; e < 3; e++) {
          var vi = idx[t * 3 + e];
          arr[i * 9 + e * 3] = pos[vi * 3];
          arr[i * 9 + e * 3 + 1] = pos[vi * 3 + 1];
          arr[i * 9 + e * 3 + 2] = pos[vi * 3 + 2];
        }
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      var o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: farbe, transparent: true, opacity: opazitaet, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      }));
      mesh.add(o);
      return o;
    }

    function entferneOverlay(o) {
      if (!o) return;
      if (o.parent) o.parent.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }

    function starteAnlegeModus(zielId) {
      beendeAnlegeModus();
      var mesh = vp.meshes[zielId];
      if (!mesh || !mesh.visible) return 'Das Objekt ist noch nicht fertig berechnet — einen Moment.';
      anlegen = { phase: 1, zielId: zielId, flaecheA: null, analysen: {}, gemeldet: {},
                  hoverMeshId: null, hoverFlaeche: null, platteHover: false,
                  overlayHover: null, overlayFest: null, platte: null };
      var erg = analysiereFlaechen(zielId);
      if (!erg) {
        anlegen = null;
        return 'Das Objekt hat zu viele Dreiecke zum Anlegen — verkleinere es zuerst mit dem Polygon-Reduzierer.';
      }
      if (!erg.flaechen.length) {
        anlegen = null;
        return 'Keine ebene Fläche gefunden.';
      }
      // Arbeitsflaeche als Ziel: eine grosse Ebene auf Z=0, unsichtbar bis zum
      // Hover (PlaneGeometry liegt in der XY-Ebene)
      var pg = new THREE.PlaneGeometry(2000, 2000);
      anlegen.platte = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({
        color: FARBE_FLAECHE, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
      }));
      szene.add(anlegen.platte);
      gizmoDetach();
      return null;
    }

    function beendeAnlegeModus() {
      if (!anlegen) return;
      entferneOverlay(anlegen.overlayHover);
      entferneOverlay(anlegen.overlayFest);
      if (anlegen.platte) {
        szene.remove(anlegen.platte);
        anlegen.platte.geometry.dispose();
        anlegen.platte.material.dispose();
      }
      anlegen = null;
    }

    function klickAnlegen() {
      if (anlegen.phase === 1) {
        if (!anlegen.hoverFlaeche) return;
        anlegen.flaecheA = anlegen.hoverFlaeche;
        anlegen.overlayFest = flaechenOverlay(anlegen.zielId, anlegen.flaecheA, FARBE_FLAECHE_FEST, 0.55);
        entferneOverlay(anlegen.overlayHover);
        anlegen.overlayHover = null;
        anlegen.hoverFlaeche = null;
        anlegen.hoverMeshId = null;
        anlegen.phase = 2;
        if (callbacks.beiAnlegenPhase) callbacks.beiAnlegenPhase(2);
        return;
      }
      var mesh = vp.meshes[anlegen.zielId];
      var transformAlt = {
        position: [rund(mesh.position.x), rund(mesh.position.y), rund(mesh.position.z)],
        rotation: [rund(mesh.rotation.x * 180 / Math.PI), rund(mesh.rotation.y * 180 / Math.PI), rund(mesh.rotation.z * 180 / Math.PI)],
        skalierung: [rund(mesh.scale.x), rund(mesh.scale.y), rund(mesh.scale.z)]
      };
      var neu = null;
      if (anlegen.hoverFlaeche) {
        neu = window.KlotzwerkFlaechen.berechneAnlegeTransform(transformAlt, anlegen.flaecheA, anlegen.hoverFlaeche);
      } else if (anlegen.platteHover) {
        neu = window.KlotzwerkFlaechen.berechnePlattenTransform(transformAlt, anlegen.flaecheA,
          mesh.geometry.attributes.position.array);
      }
      if (!neu) return;   // Klick ins Leere: Modus bleibt aktiv
      neu.skalierung = transformAlt.skalierung;
      var id = anlegen.zielId;
      beendeAnlegeModus();
      if (callbacks.beiAnlegenEnde) callbacks.beiAnlegenEnde();
      callbacks.beiTransformEnde(id, neu);
    }

    // --- Massstab-Modus: zwei Vertex-Punkte messen -------------------------
    // Punkte werden in LOKAL-Koordinaten des Meshs gemerkt: nach dem
    // Skalieren wandern Marker, Linie und Distanz automatisch mit, weil die
    // Anzeige jeden Frame aus mesh.matrixWorld neu gerechnet wird.
    var messen = null;   // { punkte: [{id, lokal}], hover, markerHover, marker: [2], linie }
    var FARBE_MESSEN = 0xd9531e;

    function messMarker(farbe) {
      var m = new THREE.Mesh(
        new THREE.SphereBufferGeometry(1, 12, 8),
        new THREE.MeshBasicMaterial({ color: farbe, depthTest: false, transparent: true })
      );
      m.renderOrder = 10;
      m.visible = false;
      szene.add(m);
      return m;
    }

    function starteMessModus() {
      beendeMessModus();
      var lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      var linie = new THREE.Line(lg, new THREE.LineBasicMaterial({
        color: FARBE_MESSEN, depthTest: false, transparent: true
      }));
      linie.renderOrder = 9;
      linie.visible = false;
      szene.add(linie);
      messen = {
        punkte: [], hover: null,
        markerHover: messMarker(FARBE_MESSEN),
        marker: [messMarker(FARBE_MESSEN), messMarker(FARBE_MESSEN)],
        linie: linie
      };
      messen.markerHover.material.opacity = 0.5;
      gizmoDetach();
    }

    function beendeMessModus() {
      if (!messen) return;
      [messen.markerHover, messen.marker[0], messen.marker[1], messen.linie].forEach(function (o) {
        szene.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      });
      messen = null;
    }

    function messWeltPunkt(p) {
      var mesh = vp.meshes[p.id];
      if (!mesh || !mesh.visible) return null;
      mesh.updateMatrixWorld();
      return new THREE.Vector3(p.lokal[0], p.lokal[1], p.lokal[2]).applyMatrix4(mesh.matrixWorld);
    }

    function messungDistanz() {
      if (!messen || messen.punkte.length < 2) return null;
      var a = messWeltPunkt(messen.punkte[0]), b = messWeltPunkt(messen.punkte[1]);
      return (a && b) ? a.distanceTo(b) : null;
    }

    // Marker in konstanter Bildschirmgroesse halten und Welt-Positionen jeden
    // Frame aus den Lokal-Punkten neu ableiten (Objekt kann skaliert werden).
    function aktualisiereMessAnzeige() {
      function setzeMarker(marker, p) {
        var w = p ? messWeltPunkt(p) : null;
        marker.visible = !!w;
        if (!w) return null;
        marker.position.copy(w);
        var sicht = kamera.isOrthographicCamera
          ? orthoHoehe / kamera.zoom
          : w.distanceTo(kamera.position) * 2 * FOV_HALB_TAN;
        marker.scale.setScalar(sicht * 0.008);
        return w;
      }
      // Verschwindet das Mesh eines fixierten Punkts (Undo, Loeschen), faengt
      // die Messung von vorne an statt Marker im Leeren stehen zu lassen.
      if (messen.punkte.some(function (p) { return !messWeltPunkt(p); })) {
        messen.punkte = [];
        if (callbacks.beiMessenReset) callbacks.beiMessenReset();
      }
      var a = setzeMarker(messen.marker[0], messen.punkte[0] || null);
      var b = setzeMarker(messen.marker[1], messen.punkte[1] || null);
      setzeMarker(messen.markerHover, messen.hover);
      messen.linie.visible = !!(a && b);
      if (a && b) {
        var arr = messen.linie.geometry.attributes.position;
        arr.setXYZ(0, a.x, a.y, a.z);
        arr.setXYZ(1, b.x, b.y, b.z);
        arr.needsUpdate = true;
      }
    }

    function klickMessen() {
      if (!messen.hover) return;   // Klick ins Leere: Modus bleibt aktiv
      if (messen.punkte.length === 1 && messen.hover.id !== messen.punkte[0].id) {
        if (callbacks.beiMessenMeldung) {
          callbacks.beiMessenMeldung('Beide Punkte müssen auf demselben Objekt liegen.');
        }
        return;
      }
      if (messen.punkte.length >= 2) {
        // Dritter Klick beginnt eine neue Messung
        messen.punkte = [];
        if (callbacks.beiMessenReset) callbacks.beiMessenReset();
      }
      if (messen.punkte.length === 1 &&
          window.KlotzwerkMessen.distanz(messen.punkte[0].lokal, messen.hover.lokal) < 1e-9) {
        return;   // selber Eckpunkt zweimal: ignorieren
      }
      messen.punkte.push(messen.hover);
      if (messen.punkte.length === 2 && callbacks.beiMessung) {
        callbacks.beiMessung(messen.punkte[0].id, messungDistanz());
      }
    }

    // --- Auswahl-Modus (Box-Select): 2D-Rahmen aufziehen -------------------
    // Alles, dessen saemtliche Vertices in der Bildschirm-Projektion im
    // Rahmen liegen, wird ausgewaehlt; Shift-Ziehen vereinigt mit der
    // bestehenden Auswahl. Einfache Klicks laufen weiter ueber die normale
    // Klick-Auswahl (der Klick-Handler prueft die 4px-Drag-Schwelle selbst).
    var boxauswahl = null;   // { ziehStart, shift, gezogen, div }

    function starteBoxModus(verhalten) {
      beendeBoxModus();
      boxauswahl = { ziehStart: null, shift: false, gezogen: false, div: null,
                     verhalten: verhalten || 'ersetzen', selektorPick: false };
      gizmoDetach();
      orbit.enabled = false;   // Linksdrag gehoert dem Rahmen
    }

    function setzeBoxVerhalten(verhalten) {
      if (boxauswahl) boxauswahl.verhalten = verhalten;
    }

    function starteSelektorPick() {
      if (boxauswahl) boxauswahl.selektorPick = true;
    }

    function brichSelektorPickAb() {
      if (boxauswahl) boxauswahl.selektorPick = false;
    }

    function beendeBoxModus() {
      if (!boxauswahl) return;
      if (boxauswahl.div && boxauswahl.div.parentNode) boxauswahl.div.parentNode.removeChild(boxauswahl.div);
      orbit.enabled = true;
      boxauswahl = null;
    }

    // Welt-Bounding-Box eines Meshs fuer den Selektor-Vorfilter
    function holeWeltBBox(id) {
      var mesh = vp.meshes[id];
      if (!mesh || !mesh.visible) return null;
      mesh.updateMatrixWorld();
      var box = new THREE.Box3().setFromObject(mesh);
      return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
    }

    function meshKomplettImRahmen(mesh, rect) {
      mesh.updateMatrixWorld();
      var pos = mesh.geometry.attributes.position.array;
      if (!pos.length) return false;
      var v = new THREE.Vector3();
      for (var i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(mesh.matrixWorld).project(kamera);
        if (!window.KlotzwerkAuswahl.punktImRechteck(v.x, v.y, v.z, rect)) return false;
      }
      return true;
    }

    function werteBoxAus(von, bis, shift) {
      var r = renderer.domElement.getBoundingClientRect();
      function ndc(cx, cy) {
        return [((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1];
      }
      var a = ndc(von[0], von[1]), b = ndc(bis[0], bis[1]);
      var rect = window.KlotzwerkAuswahl.normalisiereRechteck(a[0], a[1], b[0], b[1]);
      var treffer = [];
      Object.keys(vp.meshes).forEach(function (id) {
        var mesh = vp.meshes[id];
        if (mesh.visible && meshKomplettImRahmen(mesh, rect)) treffer.push(id);
      });
      var verhalten = shift ? 'hinzufuegen' : boxauswahl.verhalten;
      callbacks.beiAuswahl(window.KlotzwerkAuswahl.wendeVerhaltenAn(vp.auswahl, treffer, verhalten));
    }

    renderer.domElement.addEventListener('pointerdown', function (e) {
      if (!boxauswahl || e.button !== 0) return;
      if (boxauswahl.selektorPick) return;   // Pick-Phase: kein Rahmen, nur Klick
      boxauswahl.ziehStart = [e.clientX, e.clientY];
      boxauswahl.shift = e.shiftKey;
      boxauswahl.gezogen = false;
      // Capture: der Rahmen folgt der Maus auch ausserhalb des Canvas
      if (renderer.domElement.setPointerCapture) renderer.domElement.setPointerCapture(e.pointerId);
    });

    renderer.domElement.addEventListener('pointermove', function (e) {
      if (!boxauswahl || !boxauswahl.ziehStart) return;
      if (!boxauswahl.gezogen &&
          Math.abs(e.clientX - boxauswahl.ziehStart[0]) <= 4 &&
          Math.abs(e.clientY - boxauswahl.ziehStart[1]) <= 4) return;
      boxauswahl.gezogen = true;
      if (!boxauswahl.div) {
        boxauswahl.div = document.createElement('div');
        boxauswahl.div.className = 'k3d-box-rahmen';
        container.appendChild(boxauswahl.div);
      }
      var cr = container.getBoundingClientRect();
      var s = boxauswahl.div.style;
      s.left = (Math.min(boxauswahl.ziehStart[0], e.clientX) - cr.left) + 'px';
      s.top = (Math.min(boxauswahl.ziehStart[1], e.clientY) - cr.top) + 'px';
      s.width = Math.abs(e.clientX - boxauswahl.ziehStart[0]) + 'px';
      s.height = Math.abs(e.clientY - boxauswahl.ziehStart[1]) + 'px';
    });

    renderer.domElement.addEventListener('pointerup', function (e) {
      if (!boxauswahl || !boxauswahl.ziehStart) return;
      var von = boxauswahl.ziehStart;
      boxauswahl.ziehStart = null;
      if (boxauswahl.div && boxauswahl.div.parentNode) boxauswahl.div.parentNode.removeChild(boxauswahl.div);
      boxauswahl.div = null;
      if (!boxauswahl.gezogen) return;   // schlichter Klick: normale Klick-Auswahl reagiert
      boxauswahl.gezogen = false;
      werteBoxAus(von, [e.clientX, e.clientY], boxauswahl.shift);
    });

    // Hover im Massstab-Modus: Marker snappt auf den naechsten Eckpunkt des
    // getroffenen Dreiecks.
    renderer.domElement.addEventListener('pointermove', function (e) {
      if (!messen) return;
      var r = renderer.domElement.getBoundingClientRect();
      zeigt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      zeigt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(zeigt, kamera);
      var liste = Object.keys(vp.meshes).map(function (id) { return vp.meshes[id]; })
        .filter(function (m) { return m.visible; });
      var treffer = ray.intersectObjects(liste, false);
      messen.hover = null;
      if (treffer.length) {
        var mesh = treffer[0].object;
        var lokalTreffer = mesh.worldToLocal(treffer[0].point.clone());
        var lokal = window.KlotzwerkMessen.naechsterVertex(
          mesh.geometry.attributes.position.array, mesh.geometry.index.array,
          treffer[0].faceIndex, [lokalTreffer.x, lokalTreffer.y, lokalTreffer.z]);
        messen.hover = { id: mesh.userData.id, lokal: lokal };
      }
    });

    // Strecken-Vorschau: Original versteckt; die zwei Haelften (Welt-
    // Koordinaten) wandern symmetrisch von der Ebene weg, das Mittelstueck
    // (Einheitsbreite in Ebenen-Koordinaten, in einer auf die Normale
    // gedrehten Gruppe) skaliert entlang der Normalen -- kein CSG pro
    // Scroll-Tick, erst «Fertig» rechnet im Worker.
    var strecken = null;   // { zielId, normalV, teilA, teilB, gruppe, mitteMesh, breite, wiederSichtbar }

    function streckMesh(daten, material) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(daten.vertProperties, 3));
      g.setIndex(new THREE.BufferAttribute(daten.triVerts, 1));
      g.computeVertexNormals();
      return new THREE.Mesh(g, material.clone());
    }

    function starteStreckVorschau(zielId, daten, normal, offset, breite) {
      beendeStreckVorschau();
      var mesh = vp.meshes[zielId];
      if (!mesh) return 'Das Objekt ist noch nicht fertig berechnet — einen Moment.';
      var n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
      var teilA = streckMesh(daten.teilA, mesh.material);
      var teilB = streckMesh(daten.teilB, mesh.material);
      var mitteMesh = streckMesh(daten.mitte, mesh.material);
      var gruppe = new THREE.Group();
      gruppe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      gruppe.position.copy(n).multiplyScalar(offset);
      gruppe.add(mitteMesh);
      szene.add(teilA);
      szene.add(teilB);
      szene.add(gruppe);
      var wiederSichtbar = mesh.visible;
      mesh.visible = false;
      strecken = { zielId: zielId, normalV: n, teilA: teilA, teilB: teilB, gruppe: gruppe,
                   mitteMesh: mitteMesh, breite: 0, wiederSichtbar: wiederSichtbar };
      gizmoDetach();
      setzeStreckBreite(breite);
      return null;
    }

    function setzeStreckBreite(breite) {
      if (!strecken) return;
      strecken.breite = Math.max(0, breite);
      var h = strecken.breite / 2;
      strecken.teilA.position.copy(strecken.normalV).multiplyScalar(h);
      strecken.teilB.position.copy(strecken.normalV).multiplyScalar(-h);
      strecken.gruppe.scale.set(1, 1, Math.max(strecken.breite, 1e-4));
      strecken.mitteMesh.visible = strecken.breite > 1e-4;
    }

    function beendeStreckVorschau() {
      if (!strecken) return;
      [strecken.teilA, strecken.teilB].forEach(function (m) {
        szene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      });
      szene.remove(strecken.gruppe);
      strecken.mitteMesh.geometry.dispose();
      strecken.mitteMesh.material.dispose();
      var mesh = vp.meshes[strecken.zielId];
      if (mesh) mesh.visible = strecken.wiederSichtbar;
      strecken = null;
    }

    // Kanal-Modus (Entleerungskanal nach dem Aushoehlen): Hover hebt das
    // getroffene Mesh-Dreieck hervor, Klick meldet es in Weltkoordinaten.
    // form 'loch' bohrt ein rundes Loch am Trefferpunkt, form 'flaeche'
    // schneidet die ganze ebene Flaeche aus (Auswahl wie im Anlege-Modus).
    var kanal = null;   // { zielId, form, hoverIndex, hoverFlaeche, overlayHover, analyse }

    // Flaechen-Analyse des Zielobjekts, lazy und gecacht -- das Mesh aendert
    // sich im laufenden Modus nicht (nach jedem Schnitt startet die UI den
    // Modus neu, siehe beiMeshBereit).
    function analysiereKanalFlaechen() {
      if (kanal.analyse !== undefined) return kanal.analyse;
      var mesh = vp.meshes[kanal.zielId];
      var erg = null;
      if (mesh) {
        mesh.updateMatrixWorld();
        erg = window.KlotzwerkFlaechen.findeFlaechen(
          mesh.geometry.attributes.position.array,
          mesh.geometry.index.array,
          mesh.matrixWorld.elements
        );
      }
      kanal.analyse = erg;   // null = Mesh fehlt oder ueber Dreieckslimit
      return erg;
    }

    // Kreis-Vorschau des Bohrers am Trefferpunkt: zeigt Groesse und Lage des
    // Lochs, das der Klick erzeugt. Der Kreis liegt in der Flaechenebene,
    // minimal davor, damit er nicht im Objekt verschwindet.
    function kanalOverlay(punkt, normale, durchmesser) {
      var g = new THREE.CircleBufferGeometry(durchmesser / 2, 48);
      var o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: FARBE_FLAECHE, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
        depthTest: false
      }));
      o.renderOrder = 999;   // immer sichtbar, auch auf transparenten Objekten
      // CircleBufferGeometry liegt in der XY-Ebene (Normale +Z) -> auf die
      // Flaechennormale drehen und um 0.05 mm nach aussen versetzen.
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normale);
      o.position.copy(punkt).addScaledVector(normale, 0.05);
      szene.add(o);   // an der Szene, nicht am Mesh: unabhaengig vom Objekt-Transform
      return o;
    }

    // Konvexe Huelle von 2D-Punkten (Andrew monotone chain), Rueckgabe CCW.
    function konvexeHuelle2d(punkte) {
      var p = punkte.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      if (p.length < 3) return p;
      function kreuz2(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
      var unten = [], oben = [], i, q;
      for (i = 0; i < p.length; i++) {
        q = p[i];
        while (unten.length >= 2 && kreuz2(unten[unten.length - 2], unten[unten.length - 1], q) <= 0) unten.pop();
        unten.push(q);
      }
      for (i = p.length - 1; i >= 0; i--) {
        q = p[i];
        while (oben.length >= 2 && kreuz2(oben[oben.length - 2], oben[oben.length - 1], q) <= 0) oben.pop();
        oben.push(q);
      }
      unten.pop(); oben.pop();
      return unten.concat(oben);
    }

    // Kontur-Vorschau im Flaechen-Modus: die Oeffnung schneidet die konvexe
    // Huelle der Region aus (csg-kern.oeffneFlaeche) -- die Vorschau zeigt
    // darum die Huelle, nicht die einzelnen Dreiecke (auf Kuppen waeren das
    // zackige Facetten-Sterne).
    function flaechenKonturOverlay(meshId, flaeche) {
      var mesh = vp.meshes[meshId];
      if (!mesh) return null;
      mesh.updateMatrixWorld();
      var pos = mesh.geometry.attributes.position.array, idx = mesh.geometry.index.array;
      var n = new THREE.Vector3(flaeche.normale[0], flaeche.normale[1], flaeche.normale[2]);
      var c = new THREE.Vector3(flaeche.zentrum[0], flaeche.zentrum[1], flaeche.zentrum[2]);
      var seed = Math.abs(n.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      var u = new THREE.Vector3().crossVectors(n, seed).normalize();
      var v = new THREE.Vector3().crossVectors(n, u);
      var zweiD = [];
      var p = new THREE.Vector3();
      flaeche.dreiecke.forEach(function (t) {
        for (var e = 0; e < 3; e++) {
          var vi = idx[t * 3 + e];
          p.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).applyMatrix4(mesh.matrixWorld).sub(c);
          zweiD.push([p.dot(u), p.dot(v)]);
        }
      });
      var huelle = konvexeHuelle2d(zweiD);
      if (huelle.length < 3) return null;
      // Fan-Geometrie in Weltkoordinaten, minimal vor der Flaeche; wie
      // kanalOverlay an der Szene und ohne Tiefentest immer sichtbar.
      var flach = [];
      for (var i = 1; i + 1 < huelle.length; i++) {
        [huelle[0], huelle[i], huelle[i + 1]].forEach(function (q) {
          flach.push(c.x + u.x * q[0] + v.x * q[1] + n.x * 0.15,
                     c.y + u.y * q[0] + v.y * q[1] + n.y * 0.15,
                     c.z + u.z * q[0] + v.z * q[1] + n.z * 0.15);
        });
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flach), 3));
      var o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: FARBE_FLAECHE, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        depthTest: false
      }));
      o.renderOrder = 999;
      szene.add(o);
      return o;
    }

    function starteKanalModus(zielId, durchmesser, form) {
      beendeKanalModus();
      var mesh = vp.meshes[zielId];
      if (!mesh || !mesh.visible) return 'Das Objekt ist noch nicht fertig berechnet — einen Moment.';
      kanal = { zielId: zielId, form: form === 'flaeche' ? 'flaeche' : 'loch',
                hoverIndex: null, hoverFlaeche: null, overlayHover: null, punkt: null, normale: null,
                analyse: undefined, analyseGemeldet: false,
                durchmesser: durchmesser > 0 ? durchmesser : 3 };
      gizmoDetach();
      return null;
    }

    // Form im laufenden Modus umschalten (Panel-Auswahl): Hover-Zustand
    // zuruecksetzen, die Flaechen-Analyse bleibt gecacht.
    function setzeKanalForm(form) {
      if (!kanal) return;
      form = form === 'flaeche' ? 'flaeche' : 'loch';
      if (form === kanal.form) return;
      kanal.form = form;
      entferneOverlay(kanal.overlayHover);
      kanal.overlayHover = null;
      kanal.hoverIndex = null;
      kanal.hoverFlaeche = null;
      kanal.punkt = null;
      kanal.normale = null;
    }

    // Durchmesser im laufenden Modus aendern (Panel-Feld): die Vorschau folgt
    // beim naechsten Hover, ein bestehender Kreis wird sofort nachgezogen.
    function setzeKanalDurchmesser(durchmesser) {
      if (!kanal || !(durchmesser > 0)) return;
      kanal.durchmesser = durchmesser;
      if (kanal.overlayHover && kanal.punkt) {
        entferneOverlay(kanal.overlayHover);
        kanal.overlayHover = kanalOverlay(kanal.punkt, kanal.normale, kanal.durchmesser);
      }
    }

    function beendeKanalModus() {
      if (!kanal) return;
      entferneOverlay(kanal.overlayHover);
      kanal = null;
    }

    function klickKanal() {
      if (kanal.form === 'flaeche') {
        if (!kanal.hoverFlaeche) return;   // Klick ins Leere: Modus bleibt
        var f = kanal.hoverFlaeche;
        var mesh = vp.meshes[kanal.zielId];
        if (!mesh) return;
        // Flaechen-Dreiecke in Weltkoordinaten fuer den CSG-Worker (flach,
        // 9 Werte pro Dreieck); Normale/Zentrum sind bereits Welt (die
        // Analyse laeuft mit matrixWorld).
        mesh.updateMatrixWorld();
        var pos = mesh.geometry.attributes.position.array, idx = mesh.geometry.index.array;
        var arr = new Float32Array(f.dreiecke.length * 9);
        var p3 = new THREE.Vector3();
        f.dreiecke.forEach(function (t, i) {
          for (var e = 0; e < 3; e++) {
            var vi = idx[t * 3 + e];
            p3.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).applyMatrix4(mesh.matrixWorld);
            arr[i * 9 + e * 3] = p3.x;
            arr[i * 9 + e * 3 + 1] = p3.y;
            arr[i * 9 + e * 3 + 2] = p3.z;
          }
        });
        if (callbacks.beiKanalKlick) {
          callbacks.beiKanalKlick(kanal.zielId, { flaeche: { dreiecke: arr, normale: f.normale.slice() } });
        }
        return;
      }
      if (kanal.hoverIndex === null || !kanal.punkt) return;   // Klick ins Leere: Modus bleibt
      // Trefferpunkt und Normale stammen aus dem Hover-Listener, der
      // rueckseitige Treffer bereits verwirft (siehe dort).
      var p = kanal.punkt, n = kanal.normale;
      if (callbacks.beiKanalKlick) {
        callbacks.beiKanalKlick(kanal.zielId, { punkt: [p.x, p.y, p.z], normale: [n.x, n.y, n.z] });
      }
    }

    // Schnitt-Vorschau: die Seite HINTER der Ebene wird grau dargestellt.
    // Zwei Clipping-Planes teilen das Ziel in Original (vor der Ebene) und
    // grauen Klon (dahinter); die Planes folgen der Ebene in der Renderschleife.
    var schnittZiel = null, schnittGrau = null;
    var clipVorne = new THREE.Plane(), clipHinten = new THREE.Plane();

    function aktualisiereSchnittClipping() {
      if (!schnittEbene || !schnittZiel) return;
      var n = new THREE.Vector3(0, 0, 1).applyQuaternion(schnittEbene.quaternion).normalize();
      clipVorne.setFromNormalAndCoplanarPoint(n, schnittEbene.position);
      clipHinten.setFromNormalAndCoplanarPoint(n.clone().negate(), schnittEbene.position);
    }

    function entferneSchnittVorschau() {
      if (schnittZiel) {
        if (schnittZiel.material) schnittZiel.material.clippingPlanes = null;
        schnittZiel = null;
      }
      if (schnittGrau) {
        szene.remove(schnittGrau);
        schnittGrau.material.dispose();   // Geometrie gehoert dem Ziel-Mesh
        schnittGrau = null;
      }
    }

    // Grau-Vorschau an/aus, ohne den Schnitt-Modus zu beenden. Bei mehr als
    // einer Ebene (Raster) gibt es kein sinnvolles "dahinter" -- dann aus.
    function setzeGrauVorschau(aktiv) {
      if (!schnittZiel) return;
      if (aktiv && !schnittGrau) {
        schnittZiel.material.clippingPlanes = [clipVorne];
        schnittGrau = new THREE.Mesh(schnittZiel.geometry, new THREE.MeshPhongMaterial({
          color: 0x8f8f8f, flatShading: true, clippingPlanes: [clipHinten]
        }));
        schnittGrau.position.copy(schnittZiel.position);
        schnittGrau.quaternion.copy(schnittZiel.quaternion);
        schnittGrau.scale.copy(schnittZiel.scale);
        schnittGrau.visible = schnittZiel.visible;
        szene.add(schnittGrau);
        aktualisiereSchnittClipping();
      } else if (!aktiv && schnittGrau) {
        if (schnittZiel.material) schnittZiel.material.clippingPlanes = null;
        szene.remove(schnittGrau);
        schnittGrau.material.dispose();
        schnittGrau = null;
      }
    }

    // Zusatz-Platten des Raster-Schnitts. Geometrie und Material werden mit
    // der Anker-Platte GETEILT (kein dispose hier -- versteckeSchnittebene
    // raeumt die geteilten Ressourcen genau einmal ab). Als Kinder der
    // Anker-Platte folgen sie Gizmo-Drags und -Drehungen automatisch.
    function entferneRasterPlatten() {
      rasterPlatten.forEach(function (p) { schnittEbene.remove(p); });
      rasterPlatten = [];
    }

    // konfig {nZ,dZ,nX,dX,nY,dY}: Anzahl/Abstand mm je Achse des
    // Ebenen-Koordinatensystems (Z = Normale). Anker = erste Z-Ebene.
    // Einzel-Fall 1/0/0: keine Zusatz-Platten, Grau-Vorschau an.
    function setzeSchnittRaster(konfig) {
      if (!schnittEbene) return;
      entferneRasterPlatten();
      var einzeln = konfig.nZ === 1 && konfig.nX === 0 && konfig.nY === 0;
      setzeGrauVorschau(einzeln);
      if (einzeln) return;
      var kontur = schnittEbene.children[0];   // LineSegments der Anker-Platte
      function platte(px, py, pz, rx, ry) {
        var p = new THREE.Mesh(schnittEbene.geometry, schnittEbene.material);
        p.userData.id = '__schnittebene';
        p.add(new THREE.LineSegments(kontur.geometry, kontur.material));
        p.position.set(px, py, pz);
        p.rotation.set(rx, ry, 0);
        schnittEbene.add(p);
        rasterPlatten.push(p);
      }
      var k;
      for (k = 1; k < konfig.nZ; k++) platte(0, 0, k * konfig.dZ, 0, 0);
      for (k = 0; k < konfig.nX; k++) platte(k * konfig.dX, 0, 0, 0, Math.PI / 2);
      for (k = 0; k < konfig.nY; k++) platte(0, k * konfig.dY, 0, -Math.PI / 2, 0);
    }

    function zeigeSchnittebene(zielId, pose) {
      var ziel = vp.meshes[zielId];
      if (!ziel) return false;
      versteckeSchnittebene();
      var box = new THREE.Box3().setFromObject(ziel);
      var mitte = box.getCenter(new THREE.Vector3());
      // Platte ueberspannt die GANZE Szene (nicht nur das Ziel), damit sie
      // fuers Schneiden weiterer Objekte an Ort und Stelle gross genug ist
      var szenenBox = box.clone();
      Object.keys(vp.meshes).forEach(function (id) {
        szenenBox.union(new THREE.Box3().setFromObject(vp.meshes[id]));
      });
      var groesse = Math.max(szenenBox.getSize(new THREE.Vector3()).length() * 1.5, 100);
      var geo = new THREE.PlaneGeometry(groesse, groesse);
      var mat = new THREE.MeshBasicMaterial({
        color: 0xE32C14, transparent: true, opacity: 0.25,
        side: THREE.DoubleSide, depthWrite: false
      });
      schnittEbene = new THREE.Mesh(geo, mat);
      schnittEbene.userData.id = '__schnittebene';
      var kontur = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xE32C14 }));
      schnittEbene.add(kontur);
      schnittEbene.position.copy(mitte);
      // Gemerkte Pose vom letzten Schnitt: gleiche Ebene wiederverwenden,
      // nur die Plattengroesse richtet sich nach dem neuen Ziel.
      if (pose) setzeSchnittebeneTransform(pose.position, pose.rotation);
      szene.add(schnittEbene);
      gizmoDetach();
      gizmoAttach(schnittEbene, false);
      renderer.localClippingEnabled = true;
      schnittZiel = ziel;
      setzeGrauVorschau(true);
      aktualisiereSchnittClipping();
      return true;
    }

    function versteckeSchnittebene() {
      entferneSchnittVorschau();
      if (schnittEbene) entferneRasterPlatten();
      if (!schnittEbene) return;
      gizmoDetach(schnittEbene);
      szene.remove(schnittEbene);
      schnittEbene.children.forEach(function (c) { c.geometry.dispose(); c.material.dispose(); });
      schnittEbene.geometry.dispose();
      schnittEbene.material.dispose();
      schnittEbene = null;
    }

    function holeSchnittebene() {
      if (!schnittEbene) return null;
      var n = new THREE.Vector3(0, 0, 1).applyQuaternion(schnittEbene.quaternion).normalize();
      var p = schnittEbene.position;
      return {
        position: [rund(p.x), rund(p.y), rund(p.z)],
        rotation: [rund(schnittEbene.rotation.x * 180 / Math.PI),
                   rund(schnittEbene.rotation.y * 180 / Math.PI),
                   rund(schnittEbene.rotation.z * 180 / Math.PI)],
        normal: [n.x, n.y, n.z],
        offset: n.x * p.x + n.y * p.y + n.z * p.z
      };
    }

    function setzeSchnittebeneTransform(position, rotation) {
      if (!schnittEbene) return;
      schnittEbene.position.fromArray(position);
      schnittEbene.rotation.set(rotation[0] * Math.PI / 180, rotation[1] * Math.PI / 180,
        rotation[2] * Math.PI / 180, 'XYZ');
    }

    (function schleife() {
      requestAnimationFrame(schleife);
      if (flugAnimation) flugAnimation(performance.now());
      if (schnittZiel) aktualisiereSchnittClipping();
      if (messen) aktualisiereMessAnzeige();
      orbit.update();
      renderer.render(szene, kamera);
      if (navWuerfel) navWuerfel.sync();
    })();

    return vp;
  }

  window.KlotzwerkViewport = { initViewport: initViewport };
})();

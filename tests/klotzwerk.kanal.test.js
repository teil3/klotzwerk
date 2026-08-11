#!/usr/bin/env node
/*
 * Headless-Test fuer bohreKanal (Entleerungskanal) im CSG-Kern.
 * Der Kanal ist ein RUNDES Loch am Trefferpunkt (frueher: das angeklickte
 * Mesh-Dreieck -- bei Rundungen sind das lange Tortenstuecke, was schmale
 * Schlitze statt eines Lochs ergab).
 * Volumen-Gegenproben; Wasserdichtheit implizit ueber die Manifold-
 * Rekonstruktion des Ergebnisses.
 * Lauf:  node tests/generators/3d-konstruktor.kanal.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = path.join(__dirname, '../src');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function knoten(typ, params, transform) {
  return { id: 'k1', typ: typ, params: params,
           transform: transform || { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
           istLoch: false };
}

(async () => {
  const kern = await import(pathToFileURL(path.join(DATA, './esm/csg-kern.js')));
  const mod = await import(pathToFileURL(path.join(__dirname, '../vendor/manifold-3d/manifold.js')));
  const M = await mod.default();
  M.setup();

  // Ergebnis-Mesh zu Manifold rekonstruieren: liefert Volumen und beweist
  // zugleich Wasserdichtheit (Konstruktor wirft sonst).
  function meshVolumen(t) {
    const mesh = new M.Mesh({ numProp: 3, vertProperties: t.vertProperties, triVerts: t.triVerts });
    mesh.merge();
    const m = new M.Manifold(mesh);
    const v = kern.volumen(m);
    m.delete();
    return v;
  }
  // Hohler Wuerfel als Import-Knoten (Basis fuer die Wanddurchbruch-Faelle)
  function hohlerWuerfel() {
    const hohl = kern.offsetKoerper(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), 'innen', 2);
    const assets = { a1: { vertProperties: hohl.vertProperties, triVerts: hohl.triVerts, wasserdicht: true, name: 'hohl' } };
    const kn = { id: 'i1', typ: 'import', params: { assetId: 'a1', dreiecke: hohl.triVerts.length / 3, wasserdicht: true },
                 transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false };
    return { kn, assets, volumen: meshVolumen(hohl) };
  }

  // Mitte der Oberseite des 20er-Wuerfels (Unterseite liegt bei z=0)
  const oben = [0, 0, 20];
  const normale = [0, 0, 1];
  const D_LOCH = 3;
  const rLoch = D_LOCH / 2;

  console.log('Vollwuerfel 20 mm, Loch 3 mm, Tiefe 5:');
  {
    const t = kern.bohreKanal(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), oben, normale, 5, 0.1, D_LOCH);
    const ist = meshVolumen(t);
    const soll = 8000 - Math.PI * rLoch * rLoch * 5;   // Bohrer ragt 5 mm ins Material
    // Toleranz: der Bohrzylinder ist facettiert (64 Segmente), sein Volumen
    // liegt daher knapp unter dem der idealen Kreisformel.
    check('Volumen', Math.abs(ist - soll) < 1, ist.toFixed(1) + ' soll ~' + soll.toFixed(1));
  }

  console.log('Zylinder-Deckel (Tortenstueck-Triangulierung, Screenshot-Fall):');
  {
    // Die Deckflaeche eines Zylinders ist in lange, schmale Dreiecke vom
    // Mittelpunkt zum Rand zerlegt. Ein rundes Loch darf davon unabhaengig
    // sein: exakt die Bohrung abtragen, keinen Schlitz bis zum Rand.
    const zyl = knoten('zylinder', { durchmesser: 40, hoehe: 50 });
    const basis = kern.knotenZuManifold(M, zyl, false);
    const vorher = kern.volumen(basis);
    basis.delete();
    const t = kern.bohreKanal(M, zyl, [0, 0, 50], normale, 5, 0.1, D_LOCH);
    const entfernt = vorher - meshVolumen(t);
    const soll = Math.PI * rLoch * rLoch * 5;
    check('nur die Bohrung entfernt (kein Schlitz)', Math.abs(entfernt - soll) < 1,
      'entfernt ' + entfernt.toFixed(2) + ' soll ~' + soll.toFixed(2));
  }

  console.log('Ausgehoehlter Wuerfel (Wand 2), Kanal Tiefe 3 (= Wand x 1.5):');
  {
    const h = hohlerWuerfel();
    const t = kern.bohreKanal(M, h.kn, oben, normale, 3, 0.1, D_LOCH, h.assets);
    const entfernt = h.volumen - meshVolumen(t);
    // Der Kanal durchstoesst nur die 2-mm-Wand (~14 mm^3) und endet im
    // Hohlraum -- also weniger als die volle Bohrerlaenge (Pi*1.5^2*3.1 ~ 22)
    check('Wanddurchbruch ohne Gegenwand-Schaden', entfernt > 8 && entfernt < 20,
      'entfernt ' + entfernt.toFixed(1) + ' mm^3');
  }

  console.log('Transformiertes Objekt (verschoben, gedreht, nicht-uniform skaliert):');
  {
    // Weltkoordinaten-Trefferpunkt muss zum Knoten-Transform passen: lokale
    // Deckelmitte (0,0,20) -> skaliert (2,1,1) -> um Z gedreht -> verschoben.
    const tr = { position: [100, 50, 7], rotation: [0, 0, 30], skalierung: [2, 1, 1] };
    const kn = knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }, tr);
    const t = kern.bohreKanal(M, kn, [100, 50, 27], normale, 5, 0.1, D_LOCH);
    const entfernt = 20 * 20 * 20 * 2 - meshVolumen(t);
    const soll = Math.PI * rLoch * rLoch * 5;
    check('bohrt an der richtigen Weltposition', Math.abs(entfernt - soll) < 1,
      'entfernt ' + entfernt.toFixed(2) + ' soll ~' + soll.toFixed(2));
  }

  console.log('Durchmesser 0:');
  {
    let geworfen = false;
    try {
      kern.bohreKanal(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), oben, normale, 5, 0.1, 0);
    } catch (e) { geworfen = true; }
    check('wirft Fehler', geworfen);
  }

  console.log('Ausgehoehlter Wuerfel, invertierte Normale (Review-Finding 1 -- Roentgen-Rueckseitentreffer):');
  {
    // Normale zeigt ins Material/in den Hohlraum -- wie sie ein rueckseitiger
    // Raycast-Treffer im X-Ray-Modus (DoubleSide) liefern wuerde. Dann bohrt
    // der Zylinder nach aussen statt nach innen: muss abgelehnt werden.
    const h = hohlerWuerfel();
    let geworfen = false, nachher = null;
    try {
      const t = kern.bohreKanal(M, h.kn, oben, [0, 0, -1], 3, 0.1, D_LOCH, h.assets);
      nachher = meshVolumen(t);
    } catch (e) { geworfen = true; }
    check('wirft Fehler', geworfen,
      geworfen ? 'geworfen (erwartet)' : ('vorher ' + h.volumen.toFixed(1) + ' nachher ' + nachher.toFixed(1)));
  }

  // --- oeffneFlaeche: ganze Flaeche als Oeffnung (Alternative zum Loch) ----

  // Deckflaeche des 20er-Wuerfels (z=20) als Dreiecks-Liste in Weltkoordinaten
  function deckflaeche() {
    return new Float32Array([
      -10, -10, 20,  10, -10, 20,  10, 10, 20,
      -10, -10, 20,  10, 10, 20,  -10, 10, 20
    ]);
  }

  console.log('oeffneFlaeche: Vollwuerfel, ganze Deckflaeche, Tiefe 5:');
  {
    // Degeneriertes Dreieck angehaengt: muss uebersprungen werden, nicht crashen
    const mitDegeneriert = new Float32Array(deckflaeche().length + 9);
    mitDegeneriert.set(deckflaeche());
    mitDegeneriert.set([0, 0, 20, 0, 0, 20, 5, 5, 20], deckflaeche().length);
    const t = kern.oeffneFlaeche(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }),
      mitDegeneriert, normale, 5, 0.1);
    const entfernt = 20 * 20 * 20 - meshVolumen(t);
    check('exakt Flaeche x Tiefe entfernt', Math.abs(entfernt - 2000) < 1,
      'entfernt ' + entfernt.toFixed(2) + ' soll ~2000');
  }

  console.log('oeffneFlaeche: ausgehoehlter Wuerfel (Wand 2), Deckflaeche, Tiefe 3:');
  {
    // Erwartung: Deckplatte (400 x 2 = 800) plus 1 mm Wand-Ring
    // (400 - 256 = 144) verschwinden -- SDF-Streuung einkalkuliert.
    const h = hohlerWuerfel();
    const t = kern.oeffneFlaeche(M, h.kn, deckflaeche(), normale, 3, 0.1, h.assets);
    const entfernt = h.volumen - meshVolumen(t);
    check('Deckel komplett offen (Platte + Wand-Ring)', entfernt > 850 && entfernt < 1050,
      'entfernt ' + entfernt.toFixed(1) + ' mm^3');
  }

  console.log('oeffneFlaeche: Zacken-Flaeche folgt der Kontur (konvexe Huelle):');
  {
    // Vier kleine Dreiecke in den Ecken der Deckflaeche (wie die Zacken-
    // Regionen auf gewoelbten Kuppen): die Oeffnung soll der Kontur folgen
    // (konvexe Huelle = ganze 20x20-Flaeche), nicht den einzelnen Dreiecken.
    const z = 20, zacken = new Float32Array([
      -10, -10, z,  -6, -10, z,  -10, -6, z,
       10, -10, z,  10, -6, z,   6, -10, z,
       10,  10, z,  6,  10, z,   10,  6, z,
      -10,  10, z,  -10,  6, z,  -6,  10, z
    ]);
    const t = kern.oeffneFlaeche(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), zacken, normale, 5, 0.1);
    const entfernt = 20 * 20 * 20 - meshVolumen(t);
    check('Huelle der Zacken ausgeschnitten (2000, nicht 4x Dreieck)', Math.abs(entfernt - 2000) < 1,
      'entfernt ' + entfernt.toFixed(2) + ' soll ~2000');
  }

  console.log('oeffneFlaeche: invertierte Normale:');
  {
    const h = hohlerWuerfel();
    let geworfen = false;
    try {
      kern.oeffneFlaeche(M, h.kn, deckflaeche(), [0, 0, -1], 3, 0.1, h.assets);
    } catch (e) { geworfen = true; }
    check('wirft Fehler', geworfen);
  }

  console.log('oeffneFlaeche: nur degenerierte Dreiecke:');
  {
    let geworfen = false;
    try {
      kern.oeffneFlaeche(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }),
        new Float32Array([0, 0, 20, 0, 0, 20, 5, 5, 20]), normale, 5, 0.1);
    } catch (e) { geworfen = true; }
    check('wirft Fehler', geworfen);
  }

  console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
  process.exit(failures === 0 ? 0 : 1);
})();

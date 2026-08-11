#!/usr/bin/env node
/*
 * Headless-Test fuer offsetKoerper (Aushoehlen/Aufdicken) im CSG-Kern.
 * Volumen-Gegenproben an analytisch bekannten Koerpern; Wasserdichtheit
 * implizit ueber die Manifold-Rekonstruktion des Ergebnisses.
 * Lauf:  node tests/generators/3d-konstruktor.offset.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = path.join(__dirname, '../src');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwaProzent(a, b, p) { return Math.abs(a - b) <= Math.abs(b) * p; }
function knoten(typ, params) {
  return { id: 'k1', typ: typ, params: params,
           transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
           istLoch: false };
}

(async () => {
  const kern = await import(pathToFileURL(path.join(DATA, './esm/csg-kern.mjs')));
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

  console.log('Kugel Ø 20, Wand 3 (verifiziert zugleich die levelSet-Konvention):');
  {
    const hohl = kern.offsetKoerper(M, knoten('kugel', { durchmesser: 20 }), 'innen', 3);
    const sollHohl = (4 / 3) * Math.PI * (1000 - 343);   // r10 minus r7
    const istHohl = meshVolumen(hohl);
    check('Aushoehlen-Volumen', etwaProzent(istHohl, sollHohl, 0.08), istHohl.toFixed(0) + ' soll ~' + sollHohl.toFixed(0));

    const dick = kern.offsetKoerper(M, knoten('kugel', { durchmesser: 20 }), 'aussen', 3);
    const sollDick = (4 / 3) * Math.PI * 2197;           // r13
    const istDick = meshVolumen(dick);
    check('Aufdicken-Volumen', etwaProzent(istDick, sollDick, 0.08), istDick.toFixed(0) + ' soll ~' + sollDick.toFixed(0));
  }

  console.log('Wuerfel 20 mm, Wand 2:');
  {
    const hohl = kern.offsetKoerper(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), 'innen', 2);
    const ist = meshVolumen(hohl);
    check('Hohlwuerfel-Volumen', etwaProzent(ist, 8000 - 4096, 0.08), ist.toFixed(0) + ' soll ~3904');
  }

  console.log('Duenne Platte 30x30x0.4, Wand 2 (Aufdicken):');
  {
    const dick = kern.offsetKoerper(M, knoten('quader', { breite: 30, tiefe: 30, hoehe: 0.4 }), 'aussen', 2);
    const ist = meshVolumen(dick);
    // Platte selbst: 360 mm3. Aufgedickt (~34x34x4.4 mit gerundeten Kanten):
    // deutlich groesser -- exakter Wert haengt an der Kantenrundung.
    check('Platte deutlich dicker', ist > 2000, 'ist ' + ist.toFixed(0));
  }

  console.log('Kruemel-Filter (entferneKruemel):');
  {
    // Grosser Wuerfel + Marching-Cubes-grosser Splitter + legitimes kleines
    // Teil: der Splitter fliegt, das kleine Teil bleibt.
    const gross = M.Manifold.cube([20, 20, 20]);
    const kruemel = M.Manifold.cube([0.8, 0.8, 0.8]).translate([40, 0, 0]);   // ~0.5 mm3
    const klein = M.Manifold.cube([3, 3, 3]).translate([-40, 0, 0]);          // 27 mm3
    let u = M.Manifold.union(gross, kruemel);
    const u2 = M.Manifold.union(u, klein);
    u.delete(); gross.delete(); kruemel.delete(); klein.delete();
    const erg = kern.entferneKruemel(M, u2, 1);   // Grenze 8 * 1^3 = 8 mm3
    const teile = erg.decompose();
    const volumina = teile.map((t) => kern.volumen(t)).sort((a, b) => b - a);
    teile.forEach((t) => t.delete());
    erg.delete();
    check('Splitter entfernt, Rest bleibt', volumina.length === 2 &&
      etwaProzent(volumina[0], 8000, 0.01) && etwaProzent(volumina[1], 27, 0.01),
      'Volumina: ' + volumina.map((v) => v.toFixed(1)).join(','));
  }
  {
    // Nur ein winziges Objekt: die groesste Komponente bleibt IMMER,
    // auch wenn sie unter der Grenze liegt.
    const winzig = M.Manifold.cube([0.8, 0.8, 0.8]);
    const erg = kern.entferneKruemel(M, winzig, 1);
    check('groesste Komponente bleibt immer', etwaProzent(kern.volumen(erg), 0.512, 0.01),
      'Volumen: ' + kern.volumen(erg).toFixed(3));
    erg.delete();
  }

  console.log('Fehlerfaelle:');
  function erwarteFehler(name, fn, teil) {
    try { fn(); check(name, false, 'kein Fehler geworfen'); }
    catch (e) { check(name, String(e.message).indexOf(teil) >= 0, 'Meldung: ' + e.message); }
  }
  erwarteFehler('zu grosse Wand beim Aushoehlen',
    () => kern.offsetKoerper(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), 'innen', 12),
    'zu klein zum Aushöhlen');
  erwarteFehler('Wand bei Modellgroesse nicht aufloesbar',
    () => kern.offsetKoerper(M, knoten('quader', { breite: 500, tiefe: 500, hoehe: 500 }), 'innen', 1),
    'nicht auflösbar');

  console.log(failures === 0 ? 'Alle Offset-Tests ok.' : failures + ' Test(s) fehlgeschlagen.');
  process.exit(failures === 0 ? 0 : 1);
})();

#!/usr/bin/env node
/*
 * Headless-Test der signierten Distanzfunktion (esm/sdf.js).
 * Baut Referenzkoerper mit der echten manifold-3d-WASM und prueft Distanz
 * und Vorzeichen gegen analytisch bekannte Werte. Konvention: positiv innen.
 * Lauf:  node tests/generators/3d-konstruktor.sdf.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = path.join(__dirname, '../src');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwa(a, b, tol) { return Math.abs(a - b) <= tol; }

(async () => {
  const { baueSdf } = await import(pathToFileURL(path.join(DATA, './esm/sdf.js')));
  const kern = await import(pathToFileURL(path.join(DATA, './esm/csg-kern.js')));
  const mod = await import(pathToFileURL(path.join(__dirname, '../vendor/manifold-3d/manifold.js')));
  const M = await mod.default();
  M.setup();

  console.log('Kugel (Ø 20, Zentrum [0,0,10]):');
  {
    const m = kern.baueKoerper(M, 'kugel', { durchmesser: 20 });
    const mesh = m.getMesh();
    const sdf = baueSdf(mesh.vertProperties, mesh.triVerts);
    m.delete();
    // 64 Segmente: Sehnenfehler < 0.02 mm, Toleranz 0.2 mm ist grosszuegig
    check('Zentrum innen +10', etwa(sdf([0, 0, 10]), 10, 0.2), 'ist ' + sdf([0, 0, 10]));
    check('innen +5',          etwa(sdf([5, 0, 10]), 5, 0.2),  'ist ' + sdf([5, 0, 10]));
    check('aussen -5',         etwa(sdf([15, 0, 10]), -5, 0.2), 'ist ' + sdf([15, 0, 10]));
    check('ueber Pol -10',     etwa(sdf([0, 0, 30]), -10, 0.2), 'ist ' + sdf([0, 0, 30]));
  }

  console.log('Wuerfel (20x20x20, x/y -10..10, z 0..20):');
  {
    const m = kern.baueKoerper(M, 'quader', { breite: 20, tiefe: 20, hoehe: 20 });
    const mesh = m.getMesh();
    const sdf = baueSdf(mesh.vertProperties, mesh.triVerts);
    m.delete();
    check('Zentrum innen +10', etwa(sdf([0, 0, 10]), 10, 1e-6), 'ist ' + sdf([0, 0, 10]));
    check('ueber Deckel -5',   etwa(sdf([0, 0, 25]), -5, 1e-6), 'ist ' + sdf([0, 0, 25]));
    // vor der Ecke (10,10,20): Distanz sqrt(12) -- Ecken-Pseudo-Normale entscheidet
    check('vor Ecke aussen',   etwa(sdf([12, 12, 22]), -Math.sqrt(12), 1e-6), 'ist ' + sdf([12, 12, 22]));
    // vor der Kante x=10/z=20: Distanz sqrt(8) -- Kanten-Pseudo-Normale entscheidet
    check('vor Kante aussen',  etwa(sdf([12, 0, 22]), -Math.sqrt(8), 1e-6), 'ist ' + sdf([12, 0, 22]));
    check('nahe Ecke innen +1', etwa(sdf([9, 9, 19]), 1, 1e-6), 'ist ' + sdf([9, 9, 19]));
  }

  console.log(failures === 0 ? 'Alle SDF-Tests ok.' : failures + ' Test(s) fehlgeschlagen.');
  process.exit(failures === 0 ? 0 : 1);
})();

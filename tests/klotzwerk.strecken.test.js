#!/usr/bin/env node
/*
 * Headless-Test fuer streckeKnoten/streckenVorschau (Strecken-Tool):
 * Objekt an einer Ebene auseinanderziehen, die Luecke fuellt die Extrusion
 * des Schnitt-Querschnitts. Volumen-Gegenproben; Wasserdichtheit implizit
 * ueber die Manifold-Rekonstruktion des Ergebnisses.
 * Lauf:  node tests/generators/3d-konstruktor.strecken.test.js
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
function etwaProzent(ist, soll, toleranz) {
  return Math.abs(ist - soll) <= Math.abs(soll) * toleranz;
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
  function bbox(t) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.vertProperties.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], t.vertProperties[i + k]);
        max[k] = Math.max(max[k], t.vertProperties[i + k]);
      }
    }
    return { min, max };
  }

  console.log('Wuerfel 20, Ebene z=10, Breite 5:');
  {
    const t = kern.streckeKnoten(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), [0, 0, 1], 10, 5);
    check('Volumen = 8000 + 400*5', etwaProzent(meshVolumen(t), 10000, 0.001), meshVolumen(t).toFixed(1));
    const b = bbox(t);
    check('symmetrisch auseinandergezogen', Math.abs(b.min[2] - (-2.5)) < 0.01 && Math.abs(b.max[2] - 22.5) < 0.01,
      'z: ' + b.min[2].toFixed(2) + '..' + b.max[2].toFixed(2));
    check('X/Y unveraendert', Math.abs(b.min[0] + 10) < 0.01 && Math.abs(b.max[0] - 10) < 0.01);
  }

  console.log('Wuerfel 20, seitliche Ebene x=0, Breite 8:');
  {
    const t = kern.streckeKnoten(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), [1, 0, 0], 0, 8);
    check('Volumen = 8000 + 400*8', etwaProzent(meshVolumen(t), 11200, 0.001), meshVolumen(t).toFixed(1));
    const b = bbox(t);
    check('x symmetrisch: -14..14', Math.abs(b.min[0] + 14) < 0.01 && Math.abs(b.max[0] - 14) < 0.01,
      'x: ' + b.min[0].toFixed(2) + '..' + b.max[0].toFixed(2));
  }

  console.log('Rohr (Loch bleibt Loch):');
  {
    // Rohr aussen 20, innen 12, Hoehe 20; Ebene z=10 quer zur Achse
    const kn = knoten('rohr', { durchmesser: 20, wand: 4, hoehe: 20 });
    const basis = (await (async () => {
      const b = kern.knotenZuManifold(M, JSON.parse(JSON.stringify(kn)), false);
      const v = kern.volumen(b);
      const quer = b.slice(10);
      const flaeche = quer.area();
      quer.delete(); b.delete();
      return { v, flaeche };
    })());
    const t = kern.streckeKnoten(M, kn, [0, 0, 1], 10, 6);
    check('Volumen = Original + Ringflaeche*6', etwaProzent(meshVolumen(t), basis.v + basis.flaeche * 6, 0.001),
      meshVolumen(t).toFixed(1) + ' soll ' + (basis.v + basis.flaeche * 6).toFixed(1));
  }

  console.log('Transformierter Knoten (verschoben + gedreht):');
  {
    const tr = { position: [50, -20, 5], rotation: [0, 0, 30], skalierung: [1, 1, 1] };
    const t = kern.streckeKnoten(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }, tr), [0, 0, 1], 15, 4);
    check('Volumen = 8000 + 400*4', etwaProzent(meshVolumen(t), 9600, 0.001), meshVolumen(t).toFixed(1));
  }

  console.log('Randfaelle:');
  {
    let geworfen = false;
    try { kern.streckeKnoten(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), [0, 0, 1], 99, 5); }
    catch (e) { geworfen = true; }
    check('Ebene verfehlt Objekt -> wirft', geworfen);
    const t0 = kern.streckeKnoten(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), [0, 0, 1], 10, 0);
    check('Breite 0 -> Original-Volumen', etwaProzent(meshVolumen(t0), 8000, 0.001), meshVolumen(t0).toFixed(1));
  }

  console.log('streckenVorschau:');
  {
    const v = kern.streckenVorschau(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), [0, 0, 1], 10);
    check('teilA + teilB = Original-Volumen',
      etwaProzent(meshVolumen(v.teilA) + meshVolumen(v.teilB), 8000, 0.001),
      (meshVolumen(v.teilA) + meshVolumen(v.teilB)).toFixed(1));
    // teilA ist die Seite in Normalenrichtung (z >= 10)
    check('teilA auf der Normalen-Seite', bbox(v.teilA).min[2] >= 9.99, 'min z: ' + bbox(v.teilA).min[2]);
    // Mitte: Breite 1, in Ebenen-Koordinaten um z=0 zentriert
    check('Mitte: Einheitsbreite zentriert', etwaProzent(meshVolumen(v.mitte), 400, 0.001) &&
      Math.abs(bbox(v.mitte).min[2] + 0.5) < 0.01 && Math.abs(bbox(v.mitte).max[2] - 0.5) < 0.01,
      'vol ' + meshVolumen(v.mitte).toFixed(1) + ' z ' + bbox(v.mitte).min[2] + '..' + bbox(v.mitte).max[2]);
  }

  console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
  process.exit(failures === 0 ? 0 : 1);
})();

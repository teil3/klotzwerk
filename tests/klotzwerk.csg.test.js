#!/usr/bin/env node
/*
 * Headless-Test fuer den CSG-Kern des 3D-Konstruktors.
 * Rechnet mit der echten manifold-3d-WASM (dieselbe wie im Browser-Worker).
 * Prueft Volumen-Gegenproben, Loch-Semantik, leeres Ergebnis und dass die
 * Transform-Konvention mit dem Datenmodell (three 'XYZ') uebereinstimmt.
 * Lauf:  node tests/generators/3d-konstruktor.csg.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = path.join(__dirname, '../src');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwa(a, b, tolProzent) {
  return Math.abs(a - b) <= Math.abs(b) * (tolProzent || 0.02);
}

(async () => {
  const kern = await import(pathToFileURL(path.join(DATA, './esm/csg-kern.js')));
  const mod = await import(pathToFileURL(path.join(__dirname, '../vendor/manifold-3d/manifold.js')));
  const M = await mod.default();
  M.setup();

  console.log('Primitive:');
  const proben = [
    ['quader',   { breite: 20, tiefe: 10, hoehe: 5 },                 20 * 10 * 5],
    ['zylinder', { durchmesser: 20, hoehe: 10 },                      Math.PI * 100 * 10],
    ['kugel',    { durchmesser: 20 },                                 (4 / 3) * Math.PI * 1000],
    ['kegel',    { durchmesserUnten: 20, durchmesserOben: 0, hoehe: 9 }, (1 / 3) * Math.PI * 100 * 9],
    ['pyramide', { seite: 20, hoehe: 9 },                             (1 / 3) * 400 * 9],
    ['torus',    { durchmesser: 24, dicke: 6 },                       2 * Math.PI * Math.PI * 9 * 9], // 2*pi^2*R*r^2, R=(24-6)/2=9, r=3
    ['rohr',     { durchmesser: 20, wand: 2, hoehe: 10 },             Math.PI * (100 - 64) * 10]
  ];
  for (const [typ, params, soll] of proben) {
    const m = kern.baueKoerper(M, typ, params);
    const vol = kern.volumen(m);
    // Rundkoerper sind Polygon-Annaeherungen: 3 Prozent Toleranz
    check('Volumen ' + typ, etwa(vol, soll, 0.03), 'ist ' + vol.toFixed(1) + ', soll ~' + soll.toFixed(1));
    const bb = m.boundingBox();
    check('Unterseite Z=0 bei ' + typ, Math.abs(bb.min[2]) < 1e-4, 'min z = ' + bb.min[2]);
    m.delete();
  }

  console.log('Transform-Konvention (muss three XYZ entsprechen):');
  {
    const knoten = {
      id: 'k1', typ: 'quader', params: { breite: 10, tiefe: 20, hoehe: 30 },
      transform: { position: [0, 0, 0], rotation: [90, 0, 0], skalierung: [1, 1, 1] },
      istLoch: false
    };
    const m = kern.knotenZuManifold(M, knoten, false);
    const bb = m.boundingBox();
    const dy = bb.max[1] - bb.min[1], dz = bb.max[2] - bb.min[2];
    // 90 Grad um X: Tiefe (Y=20) und Hoehe (Z=30) tauschen
    check('Rotation 90 um X tauscht Y/Z', etwa(dy, 30, 0.01) && etwa(dz, 20, 0.01), 'dy=' + dy + ' dz=' + dz);
    m.delete();
  }

  console.log('Loch-Semantik:');
  {
    // Quader 20x20x20 minus durchgehender Zylinder d=10 => V = 8000 - pi*25*20
    const wurzel = {
      id: 'g1', typ: 'gruppe', istLoch: false,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
      kinder: [
        { id: 'k1', typ: 'quader', params: { breite: 20, tiefe: 20, hoehe: 20 },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false },
        { id: 'k2', typ: 'zylinder', params: { durchmesser: 10, hoehe: 40 },
          transform: { position: [0, 0, -10], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: true }
      ]
    };
    const m = kern.knotenZuManifold(M, wurzel, true);
    const soll = 8000 - Math.PI * 25 * 20;
    check('Quader minus Zylinder', etwa(kern.volumen(m), soll, 0.03), 'ist ' + kern.volumen(m).toFixed(1));
    const mesh = kern.manifoldZuMesh(m);
    check('Mesh hat Dreiecke und Punkte', mesh.triVerts.length > 0 && mesh.vertProperties.length > 0);
    check('Indizes im Bereich', Math.max.apply(null, Array.from(mesh.triVerts)) < mesh.vertProperties.length / 3);
    m.delete();
  }

  console.log('Leeres Ergebnis:');
  {
    const wurzel = {
      id: 'g1', typ: 'gruppe', istLoch: false,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
      kinder: [
        { id: 'k1', typ: 'quader', params: { breite: 10, tiefe: 10, hoehe: 10 },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false },
        { id: 'k2', typ: 'quader', params: { breite: 50, tiefe: 50, hoehe: 50 },
          transform: { position: [0, 0, -10], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: true }
      ]
    };
    check('Loch frisst alles -> null', kern.knotenZuManifold(M, wurzel, true) === null);
    check('nur Loecher -> null', kern.knotenZuManifold(M, {
      id: 'g2', typ: 'gruppe', istLoch: false,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
      kinder: [{ id: 'k3', typ: 'kugel', params: { durchmesser: 10 },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: true }]
    }, true) === null);
  }

  console.log('Ueberschneiden:');
  {
    const T = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] });
    const quader = (id, pos) => ({ id, typ: 'quader', params: { breite: 20, tiefe: 20, hoehe: 20 },
      transform: { position: pos, rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false });
    // A um [0,0,0], B um [10,0,0]: Schnitt = 10 x 20 x 20 = 4000
    const g2 = { id: 'g', typ: 'gruppe', modus: 'ueberschneiden', istLoch: false, transform: T(),
      kinder: [quader('a', [0, 0, 0]), quader('b', [10, 0, 0])] };
    const m2 = kern.knotenZuManifold(M, g2);
    check('Schnitt 2 Quader Volumen', etwa(kern.volumen(m2), 4000, 0.001), 'ist ' + kern.volumen(m2).toFixed(1));
    m2.delete();
    // dritter Quader um [0,10,0]: Schnitt = 10 x 10 x 20 = 2000
    const g3 = { id: 'g3', typ: 'gruppe', modus: 'ueberschneiden', istLoch: false, transform: T(),
      kinder: [quader('a', [0, 0, 0]), quader('b', [10, 0, 0]), quader('c', [0, 10, 0])] };
    const m3 = kern.knotenZuManifold(M, g3);
    check('Schnitt 3 Quader Volumen', etwa(kern.volumen(m3), 2000, 0.001), 'ist ' + kern.volumen(m3).toFixed(1));
    m3.delete();
    // disjunkt: B um [100,0,0] -> leer -> null
    const g0 = { id: 'g0', typ: 'gruppe', modus: 'ueberschneiden', istLoch: false, transform: T(),
      kinder: [quader('a', [0, 0, 0]), quader('b', [100, 0, 0])] };
    check('leerer Schnitt liefert null', kern.knotenZuManifold(M, g0) === null);
    // istLoch am direkten Kind wird ignoriert
    const kindLoch = quader('b', [10, 0, 0]); kindLoch.istLoch = true;
    const gl = { id: 'gl', typ: 'gruppe', modus: 'ueberschneiden', istLoch: false, transform: T(),
      kinder: [quader('a', [0, 0, 0]), kindLoch] };
    const ml = kern.knotenZuManifold(M, gl);
    check('istLoch in Schnittgruppe ignoriert', ml !== null && etwa(kern.volumen(ml), 4000, 0.001));
    if (ml) ml.delete();
  }

  console.log('Schneiden (Cut-Tool):');
  function meshVolumen(daten) {
    const mesh = new M.Mesh({ numProp: 3, vertProperties: daten.vertProperties, triVerts: daten.triVerts });
    mesh.merge();
    const m = new M.Manifold(mesh);
    const v = kern.volumen(m);
    m.delete();
    return v;
  }
  {
    // Quader 20x20x20 (Unterseite Z=0), horizontale Ebene bei z=8
    const knoten = {
      id: 'k1', typ: 'quader', params: { breite: 20, tiefe: 20, hoehe: 20 },
      transform: { position: [5, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false
    };
    const teile = kern.schneideKnoten(M, knoten, [0, 0, 1], 8);
    check('Quader horizontal: 2 Teile', teile.length === 2, 'sind ' + teile.length);
    const vols = teile.map(meshVolumen);
    check('Volumensumme = Original', etwa(vols[0] + vols[1], 8000, 0.01), 'summe=' + (vols[0] + vols[1]));
    // Erstes Teil liegt auf der Normalen-Seite (oberhalb z=8): 20*20*12
    check('Teil 1 = Normalen-Seite', etwa(vols[0], 4800, 0.01), 'vol=' + vols[0]);
  }
  {
    // U-Form: Quader 30x10x30 minus Loch-Quader 10x12x26 ab z=5.
    // Schnitt bei z=20: unten 1 zusammenhaengendes U, oben 2 Buegelenden = 3 Teile
    const u = {
      id: 'g1', typ: 'gruppe', istLoch: false,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
      kinder: [
        { id: 'k1', typ: 'quader', params: { breite: 30, tiefe: 10, hoehe: 30 },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false },
        { id: 'k2', typ: 'quader', params: { breite: 10, tiefe: 12, hoehe: 26 },
          transform: { position: [0, 0, 5], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: true }
      ]
    };
    const teile = kern.schneideKnoten(M, u, [0, 0, 1], 20);
    check('U-Form: 3 Teile', teile.length === 3, 'sind ' + teile.length);
  }
  {
    // Ebene ausserhalb der Bounding-Box: nur 1 Teil (UI meldet "verfehlt")
    const knoten = {
      id: 'k1', typ: 'kugel', params: { durchmesser: 20 },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false
    };
    const teile = kern.schneideKnoten(M, knoten, [0, 0, 1], 100);
    check('Ebene verfehlt: 1 Teil', teile.length === 1, 'sind ' + teile.length);
  }
  {
    // Schraege Ebene (45 Grad) durch das Quader-Zentrum (0,0,10)
    const knoten = {
      id: 'k1', typ: 'quader', params: { breite: 20, tiefe: 20, hoehe: 20 },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false
    };
    const w = Math.SQRT1_2;
    const teile = kern.schneideKnoten(M, knoten, [w, 0, w], w * 10);
    check('Schraege Ebene: 2 Teile', teile.length === 2, 'sind ' + teile.length);
    const vols = teile.map(meshVolumen);
    check('Volumensumme schraeg', etwa(vols[0] + vols[1], 8000, 0.01), 'summe=' + (vols[0] + vols[1]));
  }

  console.log('Auftrennen (trenneMesh, Suppe):');
  {
    // Zwei getrennte Dreiecke als Suppe (6 Eckpunkte, keine geteilten)
    const vp = new Float32Array([
      0, 0, 0,   1, 0, 0,   0, 1, 0,        // Dreieck A am Ursprung
      100, 0, 0, 101, 0, 0, 100, 1, 0       // Dreieck B weit weg
    ]);
    const tv = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const teile = kern.trenneMesh(vp, tv);
    check('Suppe: 2 Komponenten', teile.length === 2, 'sind ' + teile.length);
    const triSumme = teile.reduce((s, t) => s + t.triVerts.length / 3, 0);
    check('Suppe: Dreiecke erhalten', triSumme === 2, 'sind ' + triSumme);
  }
  {
    // Quader als Suppe (jeder Dreieck-Eckpunkt dupliziert) -> 1 Komponente,
    // weil exakt gleiche Koordinaten verschweisst werden
    const q = kern.baueKoerper(M, 'quader', { breite: 10, tiefe: 10, hoehe: 10 });
    const mesh = kern.manifoldZuMesh(q);
    q.delete();
    const n = mesh.triVerts.length;
    const vp = new Float32Array(n * 3);
    const tv = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const v = mesh.triVerts[i];
      vp[3 * i] = mesh.vertProperties[3 * v];
      vp[3 * i + 1] = mesh.vertProperties[3 * v + 1];
      vp[3 * i + 2] = mesh.vertProperties[3 * v + 2];
      tv[i] = i;
    }
    const teile = kern.trenneMesh(vp, tv);
    check('Quader-Suppe: 1 Komponente', teile.length === 1, 'sind ' + teile.length);
  }

  console.log('Auftrennen (trenneKnoten):');
  {
    // Gruppe aus zwei getrennten Quadern -> 2 wasserdichte Teile
    const g = {
      id: 'g1', typ: 'gruppe', istLoch: false,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
      kinder: [
        { id: 'k1', typ: 'quader', params: { breite: 10, tiefe: 10, hoehe: 10 },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false },
        { id: 'k2', typ: 'quader', params: { breite: 10, tiefe: 10, hoehe: 10 },
          transform: { position: [50, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false }
      ]
    };
    const teile = kern.trenneKnoten(M, g);
    check('Gruppe: 2 Teile', teile.length === 2, 'sind ' + teile.length);
    check('Gruppe: beide wasserdicht', teile.every(t => t.wasserdicht === true));
    const vols = teile.map(meshVolumen);
    check('Gruppe: Volumen je 1000', etwa(vols[0], 1000, 0.01) && etwa(vols[1], 1000, 0.01), 'sind ' + vols.join(','));
  }
  {
    // Einzelner Quader -> 1 Teil (UI meldet dann "besteht aus einem Teil")
    const k = {
      id: 'k1', typ: 'quader', params: { breite: 10, tiefe: 10, hoehe: 10 },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false
    };
    const teile = kern.trenneKnoten(M, k);
    check('Quader: 1 Teil', teile.length === 1, 'sind ' + teile.length);
  }
  {
    // Nicht-wasserdichter Import: Quader-Suppe (geschlossen) + offenes
    // Dreieck weit weg, in EINEM Asset. Erwartung: 2 Teile, genau eines
    // fuer sich wasserdicht, Welt-Transform (+7 in X) ist angewendet.
    const q = kern.baueKoerper(M, 'quader', { breite: 10, tiefe: 10, hoehe: 10 });
    const qm = kern.manifoldZuMesh(q);
    q.delete();
    const nQ = qm.triVerts.length;
    const vp = new Float32Array(nQ * 3 + 9);
    const tv = new Uint32Array(nQ + 3);
    for (let i = 0; i < nQ; i++) {
      const v = qm.triVerts[i];
      vp[3 * i] = qm.vertProperties[3 * v];
      vp[3 * i + 1] = qm.vertProperties[3 * v + 1];
      vp[3 * i + 2] = qm.vertProperties[3 * v + 2];
      tv[i] = i;
    }
    vp.set([100, 0, 0, 101, 0, 0, 100, 1, 0], nQ * 3);   // offenes Dreieck
    tv[nQ] = nQ; tv[nQ + 1] = nQ + 1; tv[nQ + 2] = nQ + 2;
    const assets = { a1: { vertProperties: vp, triVerts: tv, wasserdicht: false, name: 'test' } };
    const kn = {
      id: 'i1', typ: 'import', params: { assetId: 'a1', dreiecke: tv.length / 3, wasserdicht: false },
      transform: { position: [7, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false
    };
    const teile = kern.trenneKnoten(M, kn, assets);
    check('Import: 2 Teile', teile.length === 2, 'sind ' + teile.length);
    const dichte = teile.filter(t => t.wasserdicht);
    check('Import: genau ein Teil wasserdicht', dichte.length === 1, 'sind ' + dichte.length);
    if (dichte.length === 1) {
      let maxX = -Infinity;
      for (let i = 0; i < dichte[0].vertProperties.length; i += 3) {
        if (dichte[0].vertProperties[i] > maxX) maxX = dichte[0].vertProperties[i];
      }
      // Quader ist zentriert gebaut (x: -5..5), Knoten steht bei x=7 -> max 12
      check('Import: Welt-Transform angewendet', etwa(maxX, 12, 0.01), 'maxX=' + maxX);
    }
  }

  console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

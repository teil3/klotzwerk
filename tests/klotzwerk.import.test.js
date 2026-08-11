#!/usr/bin/env node
/*
 * Headless-Tests fuer Etappe 2 des 3D-Konstruktors: STL-Import
 * (Asset-Pruefung, Import-Koerper, Asset-Store, Projektdatei, Roh-Export).
 * Lauf:  node tests/generators/3d-konstruktor.import.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = path.join(__dirname, '../src');
const A = require(path.join(DATA, './assets.js'));
const IO = require(path.join(DATA, './io.js'));
const D = require(path.join(DATA, './dokument.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwa(a, b, tolProzent) {
  return Math.abs(a - b) <= Math.abs(b) * (tolProzent || 0.02);
}
function neutral() { return { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }; }

// Mesh mit geteilten Eckpunkten zu einer STL-typischen Soup entfalten
// (jeder Eckpunkt pro Dreieck einzeln) -- so kommt Geometrie aus parseSTL.
function zuSoup(mesh) {
  const v = [], t = [];
  for (let i = 0; i < mesh.triVerts.length; i++) {
    const p = mesh.triVerts[i] * 3;
    v.push(mesh.vertProperties[p], mesh.vertProperties[p + 1], mesh.vertProperties[p + 2]);
    t.push(i);
  }
  return { vertProperties: new Float32Array(v), triVerts: new Uint32Array(t) };
}

(async () => {
  const kern = await import(pathToFileURL(path.join(DATA, './esm/csg-kern.js')));
  const mod = await import(pathToFileURL(path.join(__dirname, '../vendor/manifold-3d/manifold.js')));
  const M = await mod.default();
  M.setup();

  // Referenz-Soup: Quader 20x20x20 aus dem eigenen Kern (korrekte Windung)
  const q = kern.baueKoerper(M, 'quader', { breite: 20, tiefe: 20, hoehe: 20 });
  const soup = zuSoup(kern.manifoldZuMesh(q));
  q.delete();

  console.log('pruefeAsset:');
  {
    const erg = kern.pruefeAsset(M, soup.vertProperties, soup.triVerts);
    check('Wuerfel-Soup ist wasserdicht', erg.wasserdicht === true);
    check('Dreieckszahl stimmt', erg.dreiecke === soup.triVerts.length / 3);

    // ein Dreieck entfernen -> offenes Mesh
    const kaputt = kern.pruefeAsset(M,
      soup.vertProperties.slice(0, soup.vertProperties.length - 9),
      new Uint32Array(soup.triVerts.length - 3).map((_, i) => i));
    check('offenes Mesh ist nicht wasserdicht', kaputt.wasserdicht === false);
  }

  console.log('Import-Koerper:');
  {
    const assets = { a1: { vertProperties: soup.vertProperties, triVerts: soup.triVerts, wasserdicht: true, name: 'wuerfel.stl' } };
    const knoten = { id: 'k1', typ: 'import', name: 'wuerfel.stl',
      params: { assetId: 'a1', dreiecke: 12, wasserdicht: true },
      transform: neutral(), istLoch: false };
    const m = kern.knotenZuManifold(M, knoten, false, assets);
    check('Volumen 8000', etwa(kern.volumen(m), 8000, 0.01), 'ist ' + kern.volumen(m).toFixed(1));
    m.delete();
  }

  console.log('Import als Loch in Gruppe:');
  {
    // Import-Wuerfel (20) als Loch mit Skalierung 0.5 => 10er-Loch mittig unten
    const assets = { a1: { vertProperties: soup.vertProperties, triVerts: soup.triVerts, wasserdicht: true, name: 'wuerfel.stl' } };
    const wurzel = { id: 'g1', typ: 'gruppe', istLoch: false, transform: neutral(),
      kinder: [
        { id: 'k1', typ: 'quader', params: { breite: 20, tiefe: 20, hoehe: 20 },
          transform: neutral(), istLoch: false },
        { id: 'k2', typ: 'import', name: 'wuerfel.stl',
          params: { assetId: 'a1', dreiecke: 12, wasserdicht: true },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [0.5, 0.5, 0.5] },
          istLoch: true }
      ] };
    const m = kern.knotenZuManifold(M, wurzel, true, assets);
    check('8000 minus 1000', etwa(kern.volumen(m), 7000, 0.01), 'ist ' + kern.volumen(m).toFixed(1));
    m.delete();
  }

  console.log('Fehlerpfade:');
  {
    const assets = { a2: { vertProperties: soup.vertProperties.slice(0, 27), triVerts: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]), wasserdicht: false, name: 'offen.stl' } };
    let msg = '';
    try {
      kern.knotenZuManifold(M, { id: 'k1', typ: 'import', name: 'offen.stl',
        params: { assetId: 'a2', dreiecke: 3, wasserdicht: false },
        transform: neutral(), istLoch: false }, false, assets);
    } catch (e) { msg = e.message; }
    check('nicht wasserdicht wirft', /wasserdicht/.test(msg), msg);

    msg = '';
    try {
      kern.knotenZuManifold(M, { id: 'k1', typ: 'import', name: 'x',
        params: { assetId: 'fehlt', dreiecke: 1, wasserdicht: true },
        transform: neutral(), istLoch: false }, false, {});
    } catch (e) { msg = e.message; }
    check('fehlendes Asset wirft', /nicht gefunden/.test(msg), msg);

    // F4: Gruppe mit einem bereits gebauten Geschwister-Koerper + einem
    // Kind, dessen Import-Asset fehlt -- vereinige()/Cleanup darf beim
    // Rethrow nicht selbst crashen (der Leak-Fix wraps den Kind-Loop in
    // try/catch und loescht bereits gesammelte Manifolds vor dem throw).
    msg = '';
    let geworfen = false;
    try {
      kern.knotenZuManifold(M, {
        id: 'g1', typ: 'gruppe', istLoch: false, transform: neutral(),
        kinder: [
          { id: 'k1', typ: 'quader', params: { breite: 10, tiefe: 10, hoehe: 10 },
            transform: neutral(), istLoch: false },
          { id: 'k2', typ: 'import', name: 'fehlt.stl',
            params: { assetId: 'fehlt', dreiecke: 1, wasserdicht: true },
            transform: neutral(), istLoch: false }
        ]
      }, true, {});
    } catch (e) { geworfen = true; msg = e.message; }
    check('Gruppe mit fehlendem Import-Asset wirft', geworfen);
    check('Fehlermeldung nennt "nicht gefunden"', /nicht gefunden/.test(msg), msg);
  }

  console.log('Asset-Store (in-memory):');
  {
    A.loescheAlle();
    const id1 = A.neueAssetId();
    check('erste Id a1', id1 === 'a1');
    A.registriere(id1, { vertProperties: soup.vertProperties, triVerts: soup.triVerts, wasserdicht: true, name: 'wuerfel.stl' });
    check('hole liefert Eintrag', A.hole(id1).name === 'wuerfel.stl');
    check('unbekannte Id -> null', A.hole('zzz') === null);
    const id2 = A.neueAssetId();
    check('naechste Id neu', id2 !== id1);
    check('alleIds', A.alleIds().length === 1);
    A.loescheAlle();
    check('loescheAlle leert', A.alleIds().length === 0);
    check('nach loescheAlle wieder a1', A.neueAssetId() === 'a1');
  }

  console.log('Projektdatei:');
  {
    const dok = D.neuesDokument();
    D.neuerKoerper(dok, 'quader');
    D.neuerImport(dok, 'halter.stl', 'a1', 12, true);
    const assetDaten = { a1: { vertProperties: soup.vertProperties, triVerts: soup.triVerts, wasserdicht: true, name: 'halter.stl' },
                         verwaist: { vertProperties: new Float32Array(9), triVerts: new Uint32Array(3), wasserdicht: false, name: 'alt.stl' } };
    const text = IO.exportiereProjekt(dok, function (id) { return assetDaten[id] || null; });

    const zurueck = IO.importiereProjekt(text);
    check('Dokument gleich', JSON.stringify(zurueck.dok) === JSON.stringify(dok));
    check('nur referenzierte Assets', Object.keys(zurueck.assets).length === 1);
    check('Typed Arrays wiederhergestellt',
      zurueck.assets.a1.vertProperties instanceof Float32Array &&
      zurueck.assets.a1.triVerts instanceof Uint32Array);
    check('Byte-identisch',
      zurueck.assets.a1.vertProperties.length === soup.vertProperties.length &&
      zurueck.assets.a1.vertProperties.every((v, i) => v === soup.vertProperties[i]));
    check('wasserdicht-Flag erhalten', zurueck.assets.a1.wasserdicht === true);
  }

  console.log('Projektdatei-Fehlerpfade:');
  {
    let geworfen = 0;
    try { IO.importiereProjekt('kein json'); } catch (e) { geworfen++; }
    try { IO.importiereProjekt('{"format":"anderes"}'); } catch (e) { geworfen++; }
    try { IO.importiereProjekt(JSON.stringify({ format: 't3-konstruktor-projekt', version: 99, dok: { version: 1, naechsteId: 1, objekte: [] }, assets: {} })); } catch (e) { geworfen++; }
    check('3x geworfen', geworfen === 3);
  }

  console.log('Roh-Export-Helfer:');
  {
    // Verschiebung [5,0,0] + Rotation 90 Grad um Z: (10,0,0) -> (5,10,0)
    const mat = D.matAusTransform({ position: [5, 0, 0], rotation: [0, 0, 90], skalierung: [1, 1, 1] });
    const v = IO.transformiereVertices(new Float32Array([10, 0, 0]), mat);
    check('Rotation+Translation', etwa(v[0], 5, 0.001) && etwa(v[1], 10, 0.001) && Math.abs(v[2]) < 1e-5,
      '[' + v[0] + ',' + v[1] + ',' + v[2] + ']');

    const a = { vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), triVerts: new Uint32Array([0, 1, 2]) };
    const b = { vertProperties: new Float32Array([0, 0, 5, 1, 0, 5, 0, 1, 5]), triVerts: new Uint32Array([0, 1, 2]) };
    const m = IO.verbindeMeshes([a, b]);
    check('6 Punkte, 2 Dreiecke', m.vertProperties.length === 18 && m.triVerts.length === 6);
    check('Offset im 2. Dreieck', m.triVerts[3] === 3 && m.triVerts[5] === 5);
    check('2. Mesh-Daten dahinter', m.vertProperties[11] === 5);
  }

  console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

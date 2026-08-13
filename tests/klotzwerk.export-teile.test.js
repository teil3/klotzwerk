#!/usr/bin/env node
/*
 * Headless-Test fuer den Einzelteile-Export (ZIP mit einer STL pro
 * eindeutigem Teil, wie Onshape «export unique parts as individual files»).
 * Prueft die Gruppierung nach Eindeutigkeit, die Stueckzahl im Dateinamen,
 * Namens-Kollisionen und den Negativ-Sonderfall (keine Dedup).
 * Lauf:  node tests/klotzwerk.export-teile.test.js
 */
const path = require('path');

const IO = require(path.join(__dirname, '../src/io.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}

function koerper(id, name, params, extra) {
  return Object.assign({
    id: id, typ: 'quader', name: name, params: params,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
    istLoch: false, farbe: '#5a8dc8', sichtbar: true
  }, extra || {});
}

console.log('Dedup nach Typ/Params/Skalierung:');
{
  // Duplikat an anderer Position/Drehung = gleiches Teil; andere Skalierung nicht
  const a = koerper('k1', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 });
  const b = koerper('k2', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 });
  b.transform.position = [50, 0, 0];
  b.transform.rotation = [0, 0, 45];
  const c = koerper('k3', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 });
  c.transform.skalierung = [2, 2, 2];
  const erg = IO.gruppiereEindeutigeTeile([a, b, c]);
  check('2 eindeutige Teile', erg.teile.length === 2, 'ist ' + erg.teile.length);
  check('Duplikat gezaehlt: 2x', erg.teile[0].anzahl === 2);
  check('Stueckzahl im Dateinamen', erg.teile[0].dateiname === 'Quader-2x.stl', erg.teile[0].dateiname);
  check('Einzelstueck ohne Stueckzahl', erg.teile[1].dateiname === 'Quader.stl', erg.teile[1].dateiname);
  check('keine Loecher gemeldet', erg.hatLoecher === false);
}

console.log('Andere Params = anderes Teil, Namens-Kollision nummeriert:');
{
  const a = koerper('k1', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 });
  const b = koerper('k2', 'Quader', { breite: 30, tiefe: 20, hoehe: 20 });
  const erg = IO.gruppiereEindeutigeTeile([a, b]);
  check('2 Teile', erg.teile.length === 2);
  check('Kollision nummeriert', erg.teile[0].dateiname === 'Quader.stl' && erg.teile[1].dateiname === 'Quader-2.stl',
    erg.teile.map(t => t.dateiname).join(', '));
}

console.log('Imports dedupen ueber assetId:');
{
  const a = koerper('k1', 'Kettenglied.stl', { assetId: 'a1', dreiecke: 100, wasserdicht: true });
  a.typ = 'import';
  const b = koerper('k2', 'Kettenglied.stl', { assetId: 'a1', dreiecke: 100, wasserdicht: true });
  b.typ = 'import';
  b.transform.position = [10, 10, 0];
  const anders = koerper('k3', 'Kettenglied.stl', { assetId: 'a2', dreiecke: 80, wasserdicht: true });
  anders.typ = 'import';
  const erg = IO.gruppiereEindeutigeTeile([a, b, anders]);
  check('gleiche assetId = ein Teil (2x), andere getrennt', erg.teile.length === 2 && erg.teile[0].anzahl === 2);
  check('Dateiname bereinigt (.stl nicht doppelt)', erg.teile[0].dateiname === 'Kettenglied-2x.stl', erg.teile[0].dateiname);
}

console.log('Sonderzeichen im Namen werden bereinigt:');
{
  const a = koerper('k1', 'Böse/Datei: <name>?', { breite: 20, tiefe: 20, hoehe: 20 });
  const erg = IO.gruppiereEindeutigeTeile([a]);
  check('keine Pfad-/Sonderzeichen', !/[\/\\:*?"<>|]/.test(erg.teile[0].dateiname), erg.teile[0].dateiname);
}

console.log('Negative im Umfang: keine Dedup (Position schneidet mit):');
{
  const a = koerper('k1', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 });
  const b = koerper('k2', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 });
  b.transform.position = [50, 0, 0];
  const loch = koerper('k3', 'Zylinder (Negativ)', { durchmesser: 5, hoehe: 30 }, { istLoch: true });
  loch.typ = 'zylinder';
  const erg = IO.gruppiereEindeutigeTeile([a, b, loch]);
  check('hatLoecher gemeldet', erg.hatLoecher === true);
  check('beide Quader einzeln (keine Dedup)', erg.teile.length === 2 && erg.teile.every(t => t.anzahl === 1),
    JSON.stringify(erg.teile.map(t => t.anzahl)));
  check('Negativ selbst ist keine Datei', erg.teile.every(t => t.objekt.istLoch === false));
}

console.log('Gruppen dedupen ueber Kinder + Skalierung:');
{
  function gruppe(id, kinder, skal) {
    return { id: id, typ: 'gruppe', name: 'Gruppe', kinder: kinder,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: skal || [1, 1, 1] },
      istLoch: false, farbe: '#5a8dc8', sichtbar: true };
  }
  // Kinder-IDs unterscheiden sich bei Duplikaten -- fuer die Eindeutigkeit
  // zaehlt die Geometrie, nicht die Id.
  const g1 = gruppe('g1', [koerper('k1', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 })]);
  const g2 = gruppe('g2', [koerper('k9', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 })]);
  const g3 = gruppe('g3', [koerper('k5', 'Quader', { breite: 20, tiefe: 20, hoehe: 20 })], [3, 3, 3]);
  const erg = IO.gruppiereEindeutigeTeile([g1, g2, g3]);
  check('identische Gruppen dedupt, skalierte getrennt', erg.teile.length === 2 && erg.teile[0].anzahl === 2,
    JSON.stringify(erg.teile.map(t => t.anzahl)));
}

process.exit(failures ? 1 : 0);

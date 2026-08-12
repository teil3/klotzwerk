#!/usr/bin/env node
/*
 * Test fuer die Ebenen-Konstruktion des Raster-Schnitts (pure Funktion,
 * kein three.js). Konvention: pose.rotation in Grad, three-Euler 'XYZ';
 * Ebene n*x = offset, Anker = erste Ebene jeder Achse, weitere bei
 * +k*Abstand entlang der Achse.
 * Lauf:  node tests/klotzwerk.schnitt.test.js
 */
const S = require('../src/schnitt.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwa(a, b) { return Math.abs(a - b) < 1e-9; }
function etwaVec(a, b) { return etwa(a[0], b[0]) && etwa(a[1], b[1]) && etwa(a[2], b[2]); }

console.log('baueSchnittEbenen:');
{
  // 1/0/0 unrotiert = exakt die heutige Einzel-Ebene: Normale +Z, offset = n*p
  const e = S.baueSchnittEbenen(
    { position: [5, 2, 3], rotation: [0, 0, 0] },
    { nZ: 1, dZ: 20, nX: 0, dX: 20, nY: 0, dY: 20 });
  check('1/0/0: genau 1 Ebene', e.length === 1, 'sind ' + e.length);
  check('1/0/0: Normale +Z', etwaVec(e[0].normal, [0, 0, 1]));
  check('1/0/0: offset = z der Position', etwa(e[0].offset, 3), 'ist ' + e[0].offset);
}
{
  // Stapeln in +Richtung: 3 Z-Ebenen, Abstand 7, Anker bei z=3 -> 3, 10, 17
  const e = S.baueSchnittEbenen(
    { position: [5, 2, 3], rotation: [0, 0, 0] },
    { nZ: 3, dZ: 7, nX: 0, dX: 20, nY: 0, dY: 20 });
  check('Stapeln: 3 Ebenen', e.length === 3, 'sind ' + e.length);
  check('Stapeln: offsets 3/10/17',
    etwa(e[0].offset, 3) && etwa(e[1].offset, 10) && etwa(e[2].offset, 17),
    'sind ' + e.map(function (x) { return x.offset; }).join('/'));
}
{
  // Quer-Achsen unrotiert: X-Ebenen haben Normale +X, Y-Ebenen +Y,
  // erste geht durch den Anker-Punkt
  const e = S.baueSchnittEbenen(
    { position: [5, 2, 3], rotation: [0, 0, 0] },
    { nZ: 1, dZ: 20, nX: 2, dX: 15, nY: 1, dY: 20 });
  check('Quer: 4 Ebenen (1Z+2X+1Y)', e.length === 4, 'sind ' + e.length);
  check('Quer X: Normale +X', etwaVec(e[1].normal, [1, 0, 0]));
  check('Quer X: offsets 5/20', etwa(e[1].offset, 5) && etwa(e[2].offset, 20),
    'sind ' + e[1].offset + '/' + e[2].offset);
  check('Quer Y: Normale +Y, offset 2', etwaVec(e[3].normal, [0, 1, 0]) && etwa(e[3].offset, 2));
}
{
  // Gedrehter Anker (90 Grad um Z): lokale X-Achse zeigt nach Welt-Y
  const e = S.baueSchnittEbenen(
    { position: [5, 2, 3], rotation: [0, 0, 90] },
    { nZ: 1, dZ: 20, nX: 2, dX: 15, nY: 0, dY: 20 });
  check('Rot Z90: Z-Normale bleibt +Z', etwaVec(e[0].normal, [0, 0, 1]));
  check('Rot Z90: X-Normale = Welt-Y', etwaVec(e[1].normal, [0, 1, 0]),
    'ist ' + e[1].normal.join(','));
  check('Rot Z90: X-offsets 2/17', etwa(e[1].offset, 2) && etwa(e[2].offset, 17),
    'sind ' + e[1].offset + '/' + e[2].offset);
}
{
  // Gedrehter Anker (90 Grad um X): Normale +Z kippt nach Welt -Y
  const e = S.baueSchnittEbenen(
    { position: [5, 2, 3], rotation: [90, 0, 0] },
    { nZ: 1, dZ: 20, nX: 0, dX: 20, nY: 0, dY: 20 });
  check('Rot X90: Normale = -Y', etwaVec(e[0].normal, [0, -1, 0]),
    'ist ' + e[0].normal.join(','));
  check('Rot X90: offset = -y der Position', etwa(e[0].offset, -2), 'ist ' + e[0].offset);
}

process.exit(failures ? 1 : 0);

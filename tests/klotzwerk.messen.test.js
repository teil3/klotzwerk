#!/usr/bin/env node
/*
 * Headless-Test fuer die Mess-Logik des Massstab-Werkzeugs.
 * Prueft Vertex-Snap (naechster Eckpunkt zum Trefferpunkt), Punkt-Transform
 * in Weltkoordinaten und die Skalierfaktor-Berechnung samt Validierung.
 * Lauf:  node tests/klotzwerk.messen.test.js
 */
const path = require('path');

const DATA = path.join(__dirname, '../src');
const M = require(path.join(DATA, './messen.js'));
const D = require(path.join(DATA, './dokument.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwa(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }
function etwaP(p, soll, tol) {
  return etwa(p[0], soll[0], tol) && etwa(p[1], soll[1], tol) && etwa(p[2], soll[2], tol);
}

// Ein Dreieck in der XY-Ebene: (0,0,0), (10,0,0), (0,10,0)
const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
const idx = new Uint32Array([0, 1, 2]);

console.log('naechsterVertex:');
{
  check('Treffer nahe Ecke 0 liefert Ecke 0',
    etwaP(M.naechsterVertex(pos, idx, 0, [1, 1, 0]), [0, 0, 0]));
  check('Treffer nahe Ecke 1 liefert Ecke 1',
    etwaP(M.naechsterVertex(pos, idx, 0, [8, 1, 0]), [10, 0, 0]));
  check('Treffer nahe Ecke 2 liefert Ecke 2',
    etwaP(M.naechsterVertex(pos, idx, 0, [1, 8, 0]), [0, 10, 0]));
  // Zweites Dreieck im selben Buffer: Index zeigt auf dieselben Vertices
  const idx2 = new Uint32Array([2, 1, 0, 0, 1, 2]);
  check('faceIndex waehlt das richtige Dreieck',
    etwaP(M.naechsterVertex(pos, idx2, 1, [8, 1, 0]), [10, 0, 0]));
}

console.log('transformPunkt:');
{
  const t = { position: [5, 0, 0], rotation: [0, 0, 90], skalierung: [2, 2, 2] };
  const mat = D.matAusTransform(t);
  // Lokal (10,0,0): skaliert (20,0,0), um Z 90 Grad gedreht (0,20,0), verschoben (5,20,0)
  check('Skalierung + Rotation + Translation',
    etwaP(M.transformPunkt(mat, [10, 0, 0]), [5, 20, 0], 1e-6));
  check('Ursprung landet auf der Position',
    etwaP(M.transformPunkt(mat, [0, 0, 0]), [5, 0, 0], 1e-6));
}

console.log('distanz:');
{
  check('3-4-5-Dreieck', etwa(M.distanz([0, 0, 0], [3, 4, 0]), 5));
  check('gleicher Punkt = 0', etwa(M.distanz([1, 2, 3], [1, 2, 3]), 0));
  // Distanz skaliert mit dem Objekt-Transform mit
  const mat = D.matAusTransform({ position: [7, -3, 2], rotation: [30, 45, 60], skalierung: [2, 2, 2] });
  check('Weltdistanz = lokale Distanz x Faktor (starre Drehung + uniforme Skalierung)',
    etwa(M.distanz(M.transformPunkt(mat, [0, 0, 0]), M.transformPunkt(mat, [3, 4, 0])), 10, 1e-6));
}

console.log('skalierFaktor:');
{
  check('50 auf 100 = Faktor 2', etwa(M.skalierFaktor(50, 100), 2));
  check('Wunsch 0 ungueltig', M.skalierFaktor(50, 0) === null);
  check('Wunsch negativ ungueltig', M.skalierFaktor(50, -5) === null);
  check('Wunsch NaN ungueltig', M.skalierFaktor(50, NaN) === null);
  check('aktuelle Laenge 0 ungueltig', M.skalierFaktor(0, 100) === null);
}

console.log('wendeFaktor:');
{
  const t = { position: [1, 2, 3], rotation: [10, 20, 30], skalierung: [1, 2, 0.5] };
  const neu = M.wendeFaktor(t, 3);
  check('Skalierung uniform multipliziert',
    etwaP(neu.skalierung, [3, 6, 1.5]));
  check('Position unveraendert (Pivot = Objekt-Ursprung)',
    etwaP(neu.position, [1, 2, 3]));
  check('Rotation unveraendert', etwaP(neu.rotation, [10, 20, 30]));
  check('Original nicht mutiert', etwaP(t.skalierung, [1, 2, 0.5]));
}

process.exit(failures ? 1 : 0);

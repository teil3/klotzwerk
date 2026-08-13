#!/usr/bin/env node
/*
 * Headless-Test fuer die Rahmen-Auswahl (Box-Select).
 * Prueft Rechteck-Normalisierung, den Vollstaendig-innerhalb-Test auf
 * projizierten Punkten (NDC) und die Shift-Vereinigung der Auswahl.
 * Lauf:  node tests/klotzwerk.auswahl.test.js
 */
const path = require('path');

const A = require(path.join(__dirname, '../src/auswahl.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}

console.log('normalisiereRechteck:');
{
  const r = A.normalisiereRechteck(0.5, -0.2, -0.1, 0.4);
  check('beliebige Aufzieh-Richtung wird sortiert',
    r.minX === -0.1 && r.maxX === 0.5 && r.minY === -0.2 && r.maxY === 0.4, JSON.stringify(r));
}

console.log('alleImRechteck (Punkte in NDC, [x,y,z]):');
{
  const r = A.normalisiereRechteck(-0.5, -0.5, 0.5, 0.5);
  check('alle Punkte drin = true',
    A.alleImRechteck([[0, 0, 0], [0.4, -0.4, 0.5]], r) === true);
  check('ein Punkt draussen = false',
    A.alleImRechteck([[0, 0, 0], [0.6, 0, 0]], r) === false);
  check('Punkt auf dem Rand zaehlt als drin',
    A.alleImRechteck([[0.5, 0.5, 0]], r) === true);
  check('leere Punktliste = false', A.alleImRechteck([], r) === false);
  check('Punkt hinter der Kamera (z > 1) = false',
    A.alleImRechteck([[0, 0, 1.5]], r) === false);
  check('Punkt vor der near-Plane (z < -1) = false',
    A.alleImRechteck([[0, 0, -1.5]], r) === false);
}

console.log('vereinige:');
{
  check('Vereinigung ohne Dubletten, Reihenfolge alt zuerst',
    JSON.stringify(A.vereinige(['a', 'b'], ['b', 'c'])) === JSON.stringify(['a', 'b', 'c']));
  check('leere alte Auswahl', JSON.stringify(A.vereinige([], ['x'])) === JSON.stringify(['x']));
  check('leeres neues Ergebnis', JSON.stringify(A.vereinige(['x'], [])) === JSON.stringify(['x']));
}

process.exit(failures ? 1 : 0);

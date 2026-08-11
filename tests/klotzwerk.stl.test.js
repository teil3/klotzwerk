#!/usr/bin/env node
/*
 * Headless-Test fuer den binaeren STL-Writer des 3D-Konstruktors.
 * Prueft Dateigroesse, Dreieckszahl-Feld und eine Normale.
 * Lauf:  node tests/generators/3d-konstruktor.stl.test.js
 */
const path = require('path');

const DATA = path.join(__dirname, '../src');
const IO = require(path.join(DATA, './io.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}

// Ein Dreieck in der XY-Ebene, gegen den Uhrzeigersinn => Normale +Z
const verts = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
const tris = new Uint32Array([0, 1, 2]);
const buf = IO.baueBinaerSTL(verts, tris);

check('Groesse 84 + 50*n', buf.byteLength === 84 + 50 * 1, 'ist ' + buf.byteLength);
const dv = new DataView(buf);
check('Dreieckszahl im Header', dv.getUint32(80, true) === 1);
check('Normale zeigt +Z', Math.abs(dv.getFloat32(84 + 8, true) - 1) < 1e-6,
  'nz = ' + dv.getFloat32(84 + 8, true));
check('erster Eckpunkt x', dv.getFloat32(84 + 12, true) === 0);
check('zweiter Eckpunkt x', dv.getFloat32(84 + 24, true) === 10);

// --- parseSTL ----------------------------------------------------------

console.log('parseSTL binaer (Roundtrip):');
{
  const zurueck = IO.parseSTL(buf); // buf = binaeres STL des Dreiecks von oben
  check('1 Dreieck', zurueck.triVerts.length === 3);
  check('9 Koordinaten', zurueck.vertProperties.length === 9);
  check('Eckpunkt 2 x=10', zurueck.vertProperties[3] === 10);
  check('Indizes fortlaufend', zurueck.triVerts[0] === 0 && zurueck.triVerts[2] === 2);
}

console.log('parseSTL ascii:');
{
  const ascii = 'solid test\n' +
    ' facet normal 0 0 1\n  outer loop\n' +
    '   vertex 0 0 0\n   vertex 10 0 0\n   vertex 0 10 0\n' +
    '  endloop\n endfacet\nendsolid test\n';
  const bytes = new TextEncoder().encode(ascii);
  const erg = IO.parseSTL(bytes.buffer);
  check('ascii 1 Dreieck', erg.triVerts.length === 3);
  check('ascii Eckpunkt 2 x=10', erg.vertProperties[3] === 10);
}

console.log('parseSTL kaputte Dateien:');
{
  let geworfen = 0;
  try { IO.parseSTL(buf.slice(0, 100)); } catch (e) { geworfen++; }          // abgeschnitten
  try { IO.parseSTL(new TextEncoder().encode('hallo welt').buffer); } catch (e) { geworfen++; }
  try { IO.parseSTL(new ArrayBuffer(10)); } catch (e) { geworfen++; }
  check('3x geworfen', geworfen === 3);
  try { IO.parseSTL(new TextEncoder().encode('solid kaputt\n vertex 1 2\nendsolid').buffer); }
  catch (e) { check('ascii ohne Dreiecke wirft deutsch', /STL/.test(e.message)); }
}

console.log('bboxMitte (Cut-Tool):');
{
  const mitte = IO.bboxMitte(new Float32Array([0, 0, 0, 10, 20, 30, 4, 5, 6]));
  check('bboxMitte xyz', mitte[0] === 5 && mitte[1] === 10 && mitte[2] === 15,
    'ist ' + JSON.stringify(mitte));
}

console.log('bboxGroesse (Import-Panel):');
{
  const g = IO.bboxGroesse(new Float32Array([-2, 0, 1, 10, 20, 30, 4, 5, 6]));
  check('bboxGroesse xyz', g[0] === 12 && g[1] === 20 && g[2] === 29,
    'ist ' + JSON.stringify(g));
}

console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
process.exit(failures === 0 ? 0 : 1);

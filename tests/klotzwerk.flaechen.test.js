#!/usr/bin/env node
/*
 * Headless-Test fuer flaechen.js: Clustering ebener Flaechen aus
 * Dreiecks-Meshes und (ab Task 2) die Anlege-Mathematik.
 * Lauf:  node tests/generators/3d-konstruktor.flaechen.test.js
 */
const path = require('path');

const DATA = path.join(__dirname, '../src');
const D = require(path.join(DATA, './dokument.js'));
const F = require(path.join(DATA, './flaechen.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwa(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-4); }
function etwaVec(a, b, tol) { return etwa(a[0], b[0], tol) && etwa(a[1], b[1], tol) && etwa(a[2], b[2], tol); }

const EINHEIT = D.matAusTransform({ position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] });

// --- Mesh-Baukasten (Soup: jedes Dreieck eigene Vertices, wie STL) -------
function dreieck(p0, p1, p2, V, T) {
  const b = V.length / 3;
  [p0, p1, p2].forEach(p => V.push(p[0], p[1], p[2]));
  T.push(b, b + 1, b + 2);
}
function flaeche4(p0, p1, p2, p3, V, T) {   // Quad als 2 Dreiecke
  dreieck(p0, p1, p2, V, T);
  dreieck(p0, p2, p3, V, T);
}
function meshAus(V, T) {
  return { vertProperties: new Float32Array(V), triVerts: new Uint32Array(T) };
}

function quaderMesh(a) {   // Wuerfel Kantenlaenge a, zentriert auf Ursprung
  const h = a / 2, V = [], T = [];
  flaeche4([-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h], V, T);       // +Z
  flaeche4([-h, h, -h], [h, h, -h], [h, -h, -h], [-h, -h, -h], V, T);   // -Z
  flaeche4([h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h], V, T);       // +X
  flaeche4([-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h], V, T);   // -X
  flaeche4([-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h], V, T);       // +Y
  flaeche4([-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], V, T);   // -Y
  return meshAus(V, T);
}

function zylinderMesh(r, hoehe, n) {   // Boden auf Z=0
  const V = [], T = [];
  for (let i = 0; i < n; i++) {
    const a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n;
    const x0 = r * Math.cos(a0), y0 = r * Math.sin(a0);
    const x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
    flaeche4([x0, y0, 0], [x1, y1, 0], [x1, y1, hoehe], [x0, y0, hoehe], V, T);  // Mantel
    dreieck([0, 0, hoehe], [x0, y0, hoehe], [x1, y1, hoehe], V, T);              // Deckel
    dreieck([0, 0, 0], [x1, y1, 0], [x0, y0, 0], V, T);                          // Boden
  }
  return meshAus(V, T);
}

function ringMesh(r1, r2, hoehe, n) {   // Rohr: aussen r1, innen r2, Boden auf Z=0
  const V = [], T = [];
  for (let i = 0; i < n; i++) {
    const a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n;
    const xo0 = r1 * Math.cos(a0), yo0 = r1 * Math.sin(a0);
    const xo1 = r1 * Math.cos(a1), yo1 = r1 * Math.sin(a1);
    const xi0 = r2 * Math.cos(a0), yi0 = r2 * Math.sin(a0);
    const xi1 = r2 * Math.cos(a1), yi1 = r2 * Math.sin(a1);
    flaeche4([xo0, yo0, 0], [xo1, yo1, 0], [xo1, yo1, hoehe], [xo0, yo0, hoehe], V, T);   // Mantel aussen
    flaeche4([xi0, yi0, hoehe], [xi1, yi1, hoehe], [xi1, yi1, 0], [xi0, yi0, 0], V, T);   // Mantel innen
    flaeche4([xo0, yo0, hoehe], [xo1, yo1, hoehe], [xi1, yi1, hoehe], [xi0, yi0, hoehe], V, T); // Ring oben
    flaeche4([xi0, yi0, 0], [xi1, yi1, 0], [xo1, yo1, 0], [xo0, yo0, 0], V, T);           // Ring unten
  }
  return meshAus(V, T);
}

function kugelMesh(r, seg, ringe) {   // UV-Kugel, zentriert
  const V = [], T = [];
  function punkt(j, i) {
    const phi = Math.PI * j / ringe, theta = 2 * Math.PI * i / seg;
    return [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)];
  }
  for (let j = 0; j < ringe; j++) {
    for (let i = 0; i < seg; i++) {
      const p00 = punkt(j, i), p01 = punkt(j, i + 1), p10 = punkt(j + 1, i), p11 = punkt(j + 1, i + 1);
      if (j > 0) dreieck(p00, p11, p01, V, T);
      if (j < ringe - 1) dreieck(p00, p10, p11, V, T);
    }
  }
  return meshAus(V, T);
}

// --- Clustering ----------------------------------------------------------
console.log('Wuerfel:');
{
  const m = quaderMesh(20);
  const erg = F.findeFlaechen(m.vertProperties, m.triVerts, EINHEIT);
  check('6 Flaechen', erg.flaechen.length === 6, 'gefunden: ' + erg.flaechen.length);
  check('Flaeche = 400 mm2', erg.flaechen.every(f => etwa(f.flaecheMm2, 400, 0.01)));
  const nPlusZ = erg.flaechen.find(f => etwaVec(f.normale, [0, 0, 1], 1e-3));
  check('+Z-Flaeche existiert', !!nPlusZ);
  check('+Z-Zentrum auf Seitenmitte', nPlusZ && etwaVec(nPlusZ.zentrum, [0, 0, 10], 1e-3));
  const achsen = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  check('alle 6 Achsen-Normalen da', achsen.every(a => erg.flaechen.some(f => etwaVec(f.normale, a, 1e-3))));
  check('dreieckZuFlaeche konsistent', erg.flaechen.every((f, fi) =>
    f.dreiecke.every(t => erg.dreieckZuFlaeche[t] === fi)));
}

console.log('Zylinder:');
{
  const m = zylinderMesh(10, 20, 32);
  const erg = F.findeFlaechen(m.vertProperties, m.triVerts, EINHEIT);
  // Bambu-Verhalten: Deckel + Boden + 32 einzelne Mantel-Quads
  check('34 Flaechen (Deckel/Boden + 32 Mantel-Quads)', erg.flaechen.length === 34, 'gefunden: ' + erg.flaechen.length);
  const deckel = erg.flaechen.find(f => f.normale[2] > 0.9);
  const boden = erg.flaechen.find(f => f.normale[2] < -0.9);
  check('Deckel + Boden', !!deckel && !!boden);
  check('Deckel-Zentrum auf der Achse', deckel && etwaVec(deckel.zentrum, [0, 0, 20], 0.01));
  check('groesste Flaechen sind Deckel/Boden', erg.flaechen.indexOf(deckel) < 2 && erg.flaechen.indexOf(boden) < 2);
  // Auch die Mantel-Dreiecke sind anwaehlbar
  const zugeordnet = erg.flaechen.reduce((s, f) => s + f.dreiecke.length, 0);
  check('ALLE Dreiecke zugeordnet', zugeordnet === 128, 'zugeordnet: ' + zugeordnet);
}

console.log('Ring (Rohr-Abschluss):');
{
  const m = ringMesh(10, 6, 20, 32);
  const erg = F.findeFlaechen(m.vertProperties, m.triVerts, EINHEIT);
  // Ring oben/unten + 2x32 Mantel-Quadss
  check('66 Flaechen (Ringe + Mantel-Quads)', erg.flaechen.length === 66, 'gefunden: ' + erg.flaechen.length);
  const oben = erg.flaechen.find(f => f.normale[2] > 0.9);
  check('Ring oben ist EINE Flaeche aus 64 Dreiecken', oben && oben.dreiecke.length === 64);
  check('Zentrum liegt auf der Achse (im Loch)', oben && etwaVec(oben.zentrum, [0, 0, 20], 0.01));
}

console.log('Kugel:');
{
  // Bambu-Verhalten: auch auf Rundungen ist jede Facette anwaehlbar
  const m = kugelMesh(10, 24, 12);
  const erg = F.findeFlaechen(m.vertProperties, m.triVerts, EINHEIT);
  const n = m.triVerts.length / 3;
  let alle = true;
  for (let t = 0; t < n; t++) { if (erg.dreieckZuFlaeche[t] === -1) { alle = false; break; } }
  check('jedes Dreieck gehoert zu einer Flaeche', alle);
}

console.log('Tangentiale Rundung (Bambu-Fall):');
{
  // Deckflaeche 10x10 auf z=10 + Rundungs-Streifen, nur 5 Grad geneigt
  // (tangentialer Anschluss einer Kantenrundung). Die Deckflaeche muss
  // trotzdem anwaehlbar sein — frueher warf der Facetten-Filter sie weg.
  const t5 = 5 * Math.PI / 180, w = 2;
  const V = [], T = [];
  flaeche4([0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10], V, T);
  flaeche4([0, 10, 10], [10, 10, 10],
    [10, 10 + w * Math.cos(t5), 10 - w * Math.sin(t5)],
    [0, 10 + w * Math.cos(t5), 10 - w * Math.sin(t5)], V, T);
  const erg = F.findeFlaechen(new Float32Array(V), new Uint32Array(T), EINHEIT);
  const deck = erg.flaechen.find(f => etwaVec(f.normale, [0, 0, 1], 1e-3) && etwa(f.flaecheMm2, 100, 0.1));
  check('Deckflaeche trotz tangentialem Nachbarn anwaehlbar', !!deck);
  check('Streifen ebenfalls anwaehlbar', erg.flaechen.length === 2, 'gefunden: ' + erg.flaechen.length);
}

console.log('Insel-Merge-Limit:');
{
  // Zwei koplanare Insel-Quadrate: normal EINE Flaeche; ueber dem Limit
  // bleibt der O(k^2)-Merge aus und sie bleiben getrennt.
  const V = [], T = [];
  flaeche4([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], V, T);
  flaeche4([20, 0, 0], [30, 0, 0], [30, 10, 0], [20, 10, 0], V, T);
  const m = meshAus(V, T);
  check('MAX_MERGE_KANDIDATEN definiert', typeof F.MAX_MERGE_KANDIDATEN === 'number' && F.MAX_MERGE_KANDIDATEN > 0);
  check('Inseln in einer Ebene verschmolzen', F.findeFlaechen(m.vertProperties, m.triVerts, EINHEIT).flaechen.length === 1);
  const alt = F.MAX_MERGE_KANDIDATEN;
  F.MAX_MERGE_KANDIDATEN = 1;   // Testzugriff: Limit temporaer druecken
  check('ueber Limit -> Inseln getrennt', F.findeFlaechen(m.vertProperties, m.triVerts, EINHEIT).flaechen.length === 2);
  F.MAX_MERGE_KANDIDATEN = alt;
}

console.log('Weltmatrix:');
{
  const m = quaderMesh(20);
  const mat = D.matAusTransform({ position: [10, 0, 5], rotation: [0, 0, 45], skalierung: [1, 1, 1] });
  const erg = F.findeFlaechen(m.vertProperties, m.triVerts, mat);
  const w = Math.SQRT1_2;
  check('Normale mitgedreht (+X -> 45 Grad)', erg.flaechen.some(f => etwaVec(f.normale, [w, w, 0], 1e-3)));
  const gedreht = erg.flaechen.find(f => etwaVec(f.normale, [w, w, 0], 1e-3));
  check('Zentrum mitverschoben', gedreht && etwaVec(gedreht.zentrum, [10 + 10 * w, 10 * w, 5], 1e-3));
}

console.log('Dreieckslimit:');
{
  check('MAX_DREIECKE definiert', typeof F.MAX_DREIECKE === 'number' && F.MAX_DREIECKE > 0);
  const m = quaderMesh(20);
  const alt = F.MAX_DREIECKE;
  F.MAX_DREIECKE = 5;   // Testzugriff: Limit temporaer druecken
  check('ueber Limit -> null', F.findeFlaechen(m.vertProperties, m.triVerts, EINHEIT) === null);
  F.MAX_DREIECKE = alt;
}

// --- Anlege-Mathematik ---------------------------------------------------
function flaechenVon(mesh, transform) {
  return F.findeFlaechen(mesh.vertProperties, mesh.triVerts, D.matAusTransform(transform)).flaechen;
}
function findeNormale(flaechen, richtung) {
  return flaechen.find(f => etwaVec(f.normale, richtung, 1e-3));
}

console.log('berechneAnlegeTransform:');
{
  // Wuerfel A (20) am Ursprung; Ziel: Deckel eines Wuerfels B bei [50,0,0]
  const mesh = quaderMesh(20);
  const tA = { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] };
  const fA = findeNormale(flaechenVon(mesh, tA), [1, 0, 0]);                 // +X-Seite von A
  const fB = findeNormale(flaechenVon(mesh, { position: [50, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }), [0, 0, 1]); // Deckel von B
  const neu = F.berechneAnlegeTransform(tA, fA, fB);
  // Nach Anwendung: die angelegte Flaeche zeigt nach -Z und ihr Zentrum
  // liegt exakt auf dem Zentrum der Zielflaeche [50,0,10]
  const nachher = flaechenVon(mesh, { position: neu.position, rotation: neu.rotation, skalierung: [1, 1, 1] });
  const unten = findeNormale(nachher, [0, 0, -1]);
  check('Flaeche zeigt nach -Z', !!unten);
  check('Zentren buendig', unten && etwaVec(unten.zentrum, [50, 0, 10], 0.02));
  check('genau 6 Flaechen nach Transform', nachher.length === 6);
}

console.log('berechneAnlegeTransform (antiparallel, 180 Grad):');
{
  // Deckel von A soll auf den Deckel von B: A muss auf den Kopf
  const mesh = quaderMesh(20);
  const tA = { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] };
  const fA = findeNormale(flaechenVon(mesh, tA), [0, 0, 1]);
  const fB = findeNormale(flaechenVon(mesh, { position: [50, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] }), [0, 0, 1]);
  const neu = F.berechneAnlegeTransform(tA, fA, fB);
  const nachher = flaechenVon(mesh, { position: neu.position, rotation: neu.rotation, skalierung: [1, 1, 1] });
  const unten = findeNormale(nachher, [0, 0, -1]);
  check('180-Grad-Fall: Flaeche unten', !!unten && etwaVec(unten.zentrum, [50, 0, 10], 0.02));
}

console.log('berechnePlattenTransform:');
{
  const mesh = quaderMesh(20);
  const tA = { position: [7, 3, 25], rotation: [0, 0, 0], skalierung: [1, 1, 1] };
  const fA = findeNormale(flaechenVon(mesh, tA), [1, 0, 0]);   // +X-Seite soll nach unten
  const neu = F.berechnePlattenTransform(tA, fA, mesh.vertProperties);
  const nachher = flaechenVon(mesh, { position: neu.position, rotation: neu.rotation, skalierung: [1, 1, 1] });
  const unten = findeNormale(nachher, [0, 0, -1]);
  check('gewaehlte Flaeche liegt unten', !!unten);
  check('liegt auf Z=0', unten && etwa(unten.zentrum[2], 0, 0.02));
  check('X/Y bleiben', unten && etwa(unten.zentrum[0], 7, 0.02) && etwa(unten.zentrum[1], 3, 0.02));
}

console.log('berechnePlattenTransform (skaliert):');
{
  const mesh = quaderMesh(20);
  const tA = { position: [0, 0, 30], rotation: [0, 0, 0], skalierung: [1, 2, 1] };
  const fA = findeNormale(flaechenVon(mesh, tA), [0, 1, 0]);
  const neu = F.berechnePlattenTransform(tA, fA, mesh.vertProperties);
  const nachher = flaechenVon(mesh, { position: neu.position, rotation: neu.rotation, skalierung: [1, 2, 1] });
  const unten = findeNormale(nachher, [0, 0, -1]);
  check('skaliert: Flaeche unten auf Z=0', !!unten && etwa(unten.zentrum[2], 0, 0.02));
}

console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
process.exit(failures === 0 ? 0 : 1);

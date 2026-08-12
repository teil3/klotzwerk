#!/usr/bin/env node
/*
 * Headless-Test fuer das Datenmodell des 3D-Konstruktors.
 * Prueft Dokument-Operationen, Gruppen-Semantik (verlustfreies Aufloesen
 * inkl. eingerechnetem Gruppen-Transform), Serialisierung und Undo/Redo.
 * Lauf:  node tests/generators/3d-konstruktor.dokument.test.js
 */
const path = require('path');

const DATA = path.join(__dirname, '../src');
const D = require(path.join(DATA, './dokument.js'));
const H = require(path.join(DATA, './historie.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwa(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

// --- Grundoperationen ----------------------------------------------------
console.log('Grundoperationen:');
{
  const dok = D.neuesDokument();
  const k = D.neuerKoerper(dok, 'quader');
  check('neuerKoerper haengt an', dok.objekte.length === 1 && dok.objekte[0] === k);
  check('Standard-Params kopiert, nicht geteilt', k.params !== D.STANDARD_PARAMS.quader);
  check('findeKnoten findet', D.findeKnoten(dok, k.id) === k);
  check('unbekannter Typ wirft', (() => { try { D.neuerKoerper(dok, 'banane'); return false; } catch (e) { return true; } })());
  D.setzeLoch(dok, k.id, true);
  check('setzeLoch', k.istLoch === true);
  const dupId = D.dupliziere(dok, k.id);
  const dup = D.findeKnoten(dok, dupId);
  check('dupliziere: neuer Knoten, neue Id', dup !== null && dupId !== k.id);
  // User-Entscheid 2026-08-10: Duplikat an der GLEICHEN Position, kein Versatz.
  check('dupliziere: gleiche Position wie das Original',
    etwa(dup.transform.position[0], k.transform.position[0])
    && etwa(dup.transform.position[1], k.transform.position[1])
    && etwa(dup.transform.position[2], k.transform.position[2]));
  check('entferneKnoten', D.entferneKnoten(dok, dupId) === true && D.findeKnoten(dok, dupId) === null);
}

// --- Gruppieren / Aufloesen ---------------------------------------------
console.log('Gruppieren/Aufloesen:');
{
  const dok = D.neuesDokument();
  const a = D.neuerKoerper(dok, 'quader');
  const b = D.neuerKoerper(dok, 'zylinder');
  b.istLoch = true;
  const gId = D.gruppiere(dok, [a.id, b.id]);
  const g = D.findeKnoten(dok, gId);
  check('Gruppe top-level, Kinder drin', dok.objekte.length === 1 && g.kinder.length === 2);
  check('Kinder unveraendert erhalten', g.kinder[0] === a && g.kinder[1] === b && b.istLoch === true);
  check('gruppiere mit 1 Id wirft', (() => { try { D.gruppiere(dok, [a.id]); return false; } catch (e) { return true; } })());

  // Gruppen-Transform muss beim Aufloesen in die Kinder eingerechnet werden
  g.transform.position = [5, 0, 0];
  g.transform.rotation = [0, 0, 90];
  const kindIds = D.loeseAuf(dok, gId);
  check('aufgeloest: 2 Kinder top-level', kindIds.length === 2 && dok.objekte.length === 2 && D.findeKnoten(dok, gId) === null);
  // a stand auf [0,0,0]: 90 Grad um Z + Verschiebung [5,0,0] => bleibt [5,0,0]
  check('Kind-Position eingerechnet', etwa(a.transform.position[0], 5, 1e-4) && etwa(a.transform.position[1], 0, 1e-4));
  check('Kind-Rotation eingerechnet', etwa(a.transform.rotation[2], 90, 1e-3));
}

console.log('Ueberschneiden-Modus:');
{
  const dok = D.neuesDokument();
  const a = D.neuerKoerper(dok, 'quader');
  const b = D.neuerKoerper(dok, 'quader');
  const gId = D.gruppiere(dok, [a.id, b.id], 'ueberschneiden');
  const g = D.findeKnoten(dok, gId);
  check('modus gesetzt', g.modus === 'ueberschneiden', 'ist ' + g.modus);
  check('Name Schnittgruppe', g.name === 'Schnittgruppe', 'ist ' + g.name);
  const kopie = JSON.parse(JSON.stringify(dok));
  check('Roundtrip erhaelt modus', kopie.objekte[0].modus === 'ueberschneiden');
  D.loeseAuf(dok, gId);
  check('Ungruppieren stellt 2 Objekte wieder her', dok.objekte.length === 2, 'sind ' + dok.objekte.length);
}
{
  const dok = D.neuesDokument();
  const a = D.neuerKoerper(dok, 'quader');
  const b = D.neuerKoerper(dok, 'quader');
  const gId = D.gruppiere(dok, [a.id, b.id]);
  const g = D.findeKnoten(dok, gId);
  check('ohne Modus KEIN modus-Feld', !('modus' in g), 'Feld vorhanden: ' + g.modus);
}

// --- Mat4-Helfer ---------------------------------------------------------
console.log('Mat4:');
{
  const t = { position: [3, 0, 0], rotation: [0, 0, 90], skalierung: [1, 1, 1] };
  const m = D.matAusTransform(t);
  // Punkt (1,0,0) -> 90 Grad um Z -> (0,1,0) -> +3 in X -> (3,1,0). Column-major.
  const x = m[0] * 1 + m[4] * 0 + m[8] * 0 + m[12];
  const y = m[1] * 1 + m[5] * 0 + m[9] * 0 + m[13];
  check('matAusTransform dreht und verschiebt', etwa(x, 3, 1e-6) && etwa(y, 1, 1e-6));
  const t2 = D.transformAusMat(m);
  check('transformAusMat kehrt um', etwa(t2.position[0], 3) && etwa(t2.rotation[2], 90, 1e-3) && etwa(t2.skalierung[1], 1));
}

// --- Serialisierung ------------------------------------------------------
console.log('Serialisierung:');
{
  const dok = D.neuesDokument();
  D.neuerKoerper(dok, 'torus');
  D.gruppiere(dok, [D.neuerKoerper(dok, 'kugel').id, D.neuerKoerper(dok, 'rohr').id]);
  const rt = D.deserialisiere(D.serialisiere(dok));
  check('Roundtrip identisch', JSON.stringify(rt) === JSON.stringify(dok));
  check('fremde Version wirft', (() => { try { D.deserialisiere('{"version":99,"objekte":[]}'); return false; } catch (e) { return true; } })());
}

// --- Historie ------------------------------------------------------------
console.log('Historie:');
{
  const dok = D.neuesDokument();
  const h = H.neueHistorie(dok);
  D.neuerKoerper(dok, 'quader');
  H.merke(h, dok);
  D.neuerKoerper(dok, 'kugel');
  H.merke(h, dok);
  check('kannRueckgaengig', H.kannRueckgaengig(h) === true);
  const zurueck = H.rueckgaengig(h);
  check('rueckgaengig: 1 Objekt', zurueck.objekte.length === 1);
  const nochmal = H.rueckgaengig(h);
  check('rueckgaengig: leer', nochmal.objekte.length === 0);
  check('rueckgaengig am Anfang: null', H.rueckgaengig(h) === null);
  const vor = H.wiederholen(h);
  check('wiederholen: 1 Objekt', vor.objekte.length === 1);
  H.merke(h, vor);   // neuer Zweig verwirft Redo-Zukunft
  check('merke verwirft Zukunft', H.kannWiederholen(h) === false);
  check('Snapshot ist Kopie', H.rueckgaengig(h).objekte !== vor.objekte);
}

// --- Import-Knoten und Wasserdichtheit -----------------------------------
console.log('Import-Knoten:');
{
  const dok = D.neuesDokument();
  const k = D.neuerImport(dok, 'halter.stl', 'a1', 1234, true);
  check('typ import', k.typ === 'import');
  check('Name = Dateiname', k.name === 'halter.stl');
  check('params', k.params.assetId === 'a1' && k.params.dreiecke === 1234 && k.params.wasserdicht === true);
  check('istLoch false', k.istLoch === false);

  const kopieId = D.dupliziere(dok, k.id);
  const kopie = D.findeKnoten(dok, kopieId);
  check('Duplikat teilt Asset', kopie.params.assetId === 'a1' && kopie.id !== k.id);

  const zurueck = D.deserialisiere(D.serialisiere(dok));
  check('Roundtrip behaelt Import', D.findeKnoten(zurueck, k.id).params.assetId === 'a1');
}

console.log('enthaeltNichtWasserdicht:');
{
  const dok = D.neuesDokument();
  const dicht = D.neuerImport(dok, 'a.stl', 'a1', 10, true);
  const offen = D.neuerImport(dok, 'b.stl', 'a2', 10, false);
  const quader = D.neuerKoerper(dok, 'quader');
  check('dichter Import: nein', D.enthaeltNichtWasserdicht(dicht) === false);
  check('offener Import: ja', D.enthaeltNichtWasserdicht(offen) === true);
  check('Grundkoerper: nein', D.enthaeltNichtWasserdicht(quader) === false);
  const gId = D.gruppiere(dok, [dicht.id, quader.id]);
  check('Gruppe ohne offene: nein', D.enthaeltNichtWasserdicht(D.findeKnoten(dok, gId)) === false);
}

// --- Sichtbarkeit --------------------------------------------------------
console.log('Sichtbarkeit:');
{
  const dok = D.neuesDokument();
  const k = D.neuerKoerper(dok, 'quader');
  check('neuerKoerper: sichtbar true', k.sichtbar === true);
  const imp = D.neuerImport(dok, 'halter.stl', 'a9', 12, true);
  check('neuerImport: sichtbar true', imp.sichtbar === true);

  D.setzeSichtbar(dok, k.id, false);
  check('setzeSichtbar false', k.sichtbar === false);
  D.setzeSichtbar(dok, 'gibtsnicht', false);
  check('setzeSichtbar mit unbekannter Id wirft nicht', true);

  const dupId = D.dupliziere(dok, k.id);
  check('dupliziere kopiert Flag', D.findeKnoten(dok, dupId).sichtbar === false);

  const gId = D.gruppiere(dok, [k.id, dupId]);
  const g = D.findeKnoten(dok, gId);
  check('gruppiere: Gruppe sichtbar true', g.sichtbar === true);
  check('gruppiere: Kind behaelt Flag', D.findeKnoten(dok, dupId).sichtbar === false);

  // Tolerantes Laden: altes Projekt ohne sichtbar-Feld (auch in Gruppen-Kindern)
  const alt = JSON.parse(D.serialisiere(dok));
  (function entferne(liste) {
    liste.forEach(function (kn) { delete kn.sichtbar; if (kn.typ === 'gruppe') entferne(kn.kinder); });
  })(alt.objekte);
  const geladen = D.deserialisiere(JSON.stringify(alt));
  check('deserialisiere ergaenzt sichtbar top-level',
    geladen.objekte.every(function (kn) { return kn.sichtbar === true; }));
  const gGeladen = D.findeKnoten(geladen, gId);
  check('deserialisiere ergaenzt sichtbar in Kindern',
    gGeladen.kinder.every(function (kn) { return kn.sichtbar === true; }));

  // Roundtrip erhaelt ein gesetztes false
  D.setzeSichtbar(dok, gId, false);
  const rt = D.deserialisiere(D.serialisiere(dok));
  check('Roundtrip erhaelt verstecktes Flag', D.findeKnoten(rt, gId).sichtbar === false);
}

// --- Objektfarbe ---------------------------------------------------------
console.log('Objektfarbe:');
{
  const dok = D.neuesDokument();
  const k = D.neuerKoerper(dok, 'quader');
  check('STANDARD_FARBE exportiert', D.STANDARD_FARBE === '#5a8dc8');
  check('neuer Koerper hat Standardfarbe', k.farbe === '#5a8dc8');

  D.setzeFarbe(dok, k.id, '#D64541');
  check('setzeFarbe normalisiert auf Kleinschreibung', k.farbe === '#d64541');
  D.setzeFarbe(dok, k.id, 'rot');
  D.setzeFarbe(dok, k.id, '#12345');
  D.setzeFarbe(dok, k.id, '#12345g');
  D.setzeFarbe(dok, k.id, null);
  check('ungueltige Werte ignoriert', k.farbe === '#d64541');

  const kopieId = D.dupliziere(dok, k.id);
  check('dupliziere kopiert Farbe', D.findeKnoten(dok, kopieId).farbe === '#d64541');

  const imp = D.neuerImport(dok, 'teil.stl', 'asset1', 12, true);
  check('neuer Import hat Standardfarbe', imp.farbe === '#5a8dc8');

  // Gruppe erbt die Farbe des ersten SOLIDEN Kindes (a ist Negativ)
  const a = D.neuerKoerper(dok, 'quader');
  const b = D.neuerKoerper(dok, 'zylinder');
  D.setzeLoch(dok, a.id, true);
  D.setzeFarbe(dok, a.id, '#1a1a1a');
  D.setzeFarbe(dok, b.id, '#4caf50');
  const gId = D.gruppiere(dok, [a.id, b.id]);
  check('Gruppe erbt Farbe des ersten soliden Kindes',
    D.findeKnoten(dok, gId).farbe === '#4caf50');

  // Roundtrip erhaelt Farben
  const rt = D.deserialisiere(D.serialisiere(dok));
  check('Roundtrip erhaelt Farbe', D.findeKnoten(rt, kopieId).farbe === '#d64541');

  // Altes Projekt ohne farbe-Felder laedt tolerant (auch Gruppen-Kinder)
  const alt = JSON.parse(D.serialisiere(dok));
  (function loescheFarben(liste) {
    liste.forEach(function (kn) {
      delete kn.farbe;
      if (kn.typ === 'gruppe') loescheFarben(kn.kinder);
    });
  })(alt.objekte);
  const geladen = D.deserialisiere(JSON.stringify(alt));
  check('deserialisiere ergaenzt Farbe', D.findeKnoten(geladen, kopieId).farbe === '#5a8dc8');
  check('deserialisiere ergaenzt Farbe in Gruppen-Kindern',
    D.findeKnoten(geladen, gId).kinder.every(function (kn) { return kn.farbe === '#5a8dc8'; }));
}

console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
process.exit(failures === 0 ? 0 : 1);

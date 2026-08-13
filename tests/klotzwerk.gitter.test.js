#!/usr/bin/env node
/*
 * Headless-Test fuer die konfigurierbare Arbeitsflaeche.
 * Prueft die Linien-Geometrie des Gitters (Raster + Rand + Mittellinien)
 * und die Normalisierung der Einstellungen (Defaults, Clamping, Farben).
 * Lauf:  node tests/klotzwerk.gitter.test.js
 */
const path = require('path');

const G = require(path.join(__dirname, '../src/gitter.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}

// Segmente als [x1,y1,z1,x2,y2,z2]-Sextette zaehlen/inspizieren
function segmente(arr) {
  const s = [];
  for (let i = 0; i < arr.length; i += 6) s.push(arr.slice(i, i + 6));
  return s;
}
// Senkrechte (x fix, laeuft in Y) mit diesem x-Wert vorhanden?
function hatSenkrechte(segs, x) {
  return segs.some(s => s[0] === x && s[3] === x && s[1] !== s[4]);
}

console.log('linienPositionen 300x300, Abstand 10 (heutiger Default):');
{
  const erg = G.linienPositionen(300, 300, 10);
  const linien = segmente(erg.linien), mitte = segmente(erg.mitte);
  // Pro Richtung: Vielfache von 10 bis zum Rand ±150 = je 15 pro Seite = 30,
  // Rand faellt aufs Raster (nicht doppelt). x=0/y=0 liegen separat in mitte.
  check('60 Rasterlinien', linien.length === 60, 'ist ' + linien.length);
  check('2 Mittellinien', mitte.length === 2, 'ist ' + mitte.length);
  check('Randlinie bei x=150 vorhanden', hatSenkrechte(linien, 150));
  check('keine Rasterlinie bei x=0 (die ist Mittellinie)', !hatSenkrechte(linien, 0));
  check('alles auf Z=0', linien.concat(mitte).every(s => s[2] === 0 && s[5] === 0));
}

console.log('linienPositionen 100x40, Abstand 10 (Rechteck):');
{
  const erg = G.linienPositionen(100, 40, 10);
  const linien = segmente(erg.linien);
  // Senkrechte (ueber X verteilt): ±10..±50 = 10; Waagrechte: ±10, ±20 = 4
  check('14 Rasterlinien', linien.length === 14, 'ist ' + linien.length);
  const senkrechte = linien.filter(s => s[0] === s[3]);
  check('Senkrechte laufen ueber die volle Breite ±20',
    senkrechte.every(s => Math.min(s[1], s[4]) === -20 && Math.max(s[1], s[4]) === 20));
}

console.log('linienPositionen 100x100, Abstand 30 (Rand nicht auf dem Raster):');
{
  const erg = G.linienPositionen(100, 100, 30);
  const linien = segmente(erg.linien);
  // Vielfache: ±30 (60 > 50 faellt weg) = 2 pro Richtung, plus Rand ±50 = 2
  check('8 Rasterlinien (je 2 Vielfache + 2 Randlinien)', linien.length === 8, 'ist ' + linien.length);
  check('Randlinie bei x=50 vorhanden', hatSenkrechte(linien, 50));
  check('Vielfachen-Linie bei x=30 vorhanden', hatSenkrechte(linien, 30));
}

console.log('normalisiere:');
{
  const std = G.normalisiere({});
  check('leeres Objekt liefert Standard 300x300/10',
    std.laenge === 300 && std.breite === 300 && std.abstand === 10);
  check('Standard-Farben', std.farbeLinien === '#dddddd' && std.farbeMitte === '#bbbbbb');
  check('Standard sichtbar', std.sichtbar === true);
  check('null liefert Standard', G.normalisiere(null).laenge === 300);
  const e = G.normalisiere({ laenge: 500, breite: 120.5, abstand: 5, farbeLinien: '#FF0000', farbeMitte: '#00ff00', sichtbar: false });
  check('gueltige Werte bleiben', e.laenge === 500 && e.breite === 120.5 && e.abstand === 5);
  check('Farben kleingeschrieben uebernommen', e.farbeLinien === '#ff0000' && e.farbeMitte === '#00ff00');
  check('sichtbar false bleibt', e.sichtbar === false);
  check('Laenge unter Minimum wird geklemmt', G.normalisiere({ laenge: 3 }).laenge === 10);
  check('Laenge ueber Maximum wird geklemmt', G.normalisiere({ laenge: 99999 }).laenge === 5000);
  check('Abstand unter Minimum wird geklemmt', G.normalisiere({ abstand: 0 }).abstand === 1);
  check('NaN faellt auf Standard zurueck', G.normalisiere({ breite: 'abc' }).breite === 300);
  check('kaputte Farbe faellt auf Standard zurueck', G.normalisiere({ farbeLinien: 'rot' }).farbeLinien === '#dddddd');
  check('sichtbar akzeptiert nur Boolean', G.normalisiere({ sichtbar: 'nein' }).sichtbar === true);
}

process.exit(failures ? 1 : 0);

/*
 * Konfigurierbare Arbeitsflaeche: reine Daten, kein three.js.
 * Liefert die Linien-Segmente des Gitters (zentriert am Ursprung, Z=0)
 * und normalisiert die Einstellungen aus dem localStorage.
 * Browser haengt an window.KlotzwerkGitter, Node testet via require().
 */
(function () {
  'use strict';

  var STANDARD = {
    laenge: 300, breite: 300, abstand: 10,
    farbeLinien: '#dddddd', farbeMitte: '#bbbbbb', sichtbar: true
  };

  function zahl(wert, standard, min, max) {
    if (typeof wert !== 'number' || !isFinite(wert)) return standard;
    return Math.min(max, Math.max(min, wert));
  }

  function farbe(wert, standard) {
    return (typeof wert === 'string' && /^#[0-9a-f]{6}$/i.test(wert)) ? wert.toLowerCase() : standard;
  }

  function normalisiere(e) {
    e = e || {};
    return {
      laenge: zahl(e.laenge, STANDARD.laenge, 10, 5000),
      breite: zahl(e.breite, STANDARD.breite, 10, 5000),
      abstand: zahl(e.abstand, STANDARD.abstand, 1, 5000),
      farbeLinien: farbe(e.farbeLinien, STANDARD.farbeLinien),
      farbeMitte: farbe(e.farbeMitte, STANDARD.farbeMitte),
      sichtbar: typeof e.sichtbar === 'boolean' ? e.sichtbar : STANDARD.sichtbar
    };
  }

  // Positionen fuer Vielfache von abstand bis halb (exklusive 0),
  // plus Randlinie bei ±halb, falls sie nicht aufs Raster faellt.
  function stufen(halb, abstand) {
    var s = [];
    for (var x = abstand; x < halb; x += abstand) s.push(x, -x);
    s.push(halb, -halb);
    return s;
  }

  function linienPositionen(laenge, breite, abstand) {
    var hx = laenge / 2, hy = breite / 2;
    var linien = [], mitte = [];
    stufen(hx, abstand).forEach(function (x) { linien.push(x, -hy, 0, x, hy, 0); });
    stufen(hy, abstand).forEach(function (y) { linien.push(-hx, y, 0, hx, y, 0); });
    mitte.push(0, -hy, 0, 0, hy, 0);
    mitte.push(-hx, 0, 0, hx, 0, 0);
    return { linien: linien, mitte: mitte };
  }

  var api = {
    STANDARD: STANDARD,
    normalisiere: normalisiere,
    linienPositionen: linienPositionen
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.KlotzwerkGitter = api; }
})();

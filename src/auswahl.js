/*
 * Rahmen-Auswahl (Box-Select): reine Daten, kein three.js.
 * Punkte sind projizierte [x,y,z] in NDC (three Vector3.project);
 * z ausserhalb [-1,1] liegt vor der near- bzw. hinter der far-Plane.
 * Browser haengt an window.KlotzwerkAuswahl, Node testet via require().
 */
(function () {
  'use strict';

  function normalisiereRechteck(ax, ay, bx, by) {
    return {
      minX: Math.min(ax, bx), maxX: Math.max(ax, bx),
      minY: Math.min(ay, by), maxY: Math.max(ay, by)
    };
  }

  function punktImRechteck(x, y, z, r) {
    if (z < -1 || z > 1) return false;
    return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
  }

  // Vollstaendig-innerhalb: JEDER Punkt muss im Rechteck und im Sichtbereich
  // liegen. Leere Punktliste zaehlt nicht als Treffer.
  function alleImRechteck(punkte, r) {
    if (!punkte.length) return false;
    for (var i = 0; i < punkte.length; i++) {
      if (!punktImRechteck(punkte[i][0], punkte[i][1], punkte[i][2], r)) return false;
    }
    return true;
  }

  function vereinige(alt, neu) {
    var erg = alt.slice();
    neu.forEach(function (id) { if (erg.indexOf(id) < 0) erg.push(id); });
    return erg;
  }

  var api = {
    normalisiereRechteck: normalisiereRechteck,
    punktImRechteck: punktImRechteck,
    alleImRechteck: alleImRechteck,
    vereinige: vereinige
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.KlotzwerkAuswahl = api; }
})();

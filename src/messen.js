/*
 * Mess-Logik des Massstab-Werkzeugs: reine Daten, kein three.js.
 * Browser haengt an window.KlotzwerkMessen, Node testet via require().
 * Punkte sind [x,y,z]-Arrays; Matrizen column-major wie in dokument.js.
 */
(function () {
  'use strict';

  // Naechstgelegener Eckpunkt des getroffenen Dreiecks zum Trefferpunkt,
  // alles in Lokalkoordinaten des Meshs.
  function naechsterVertex(pos, idx, faceIndex, punkt) {
    var bester = null, besteD = Infinity;
    for (var e = 0; e < 3; e++) {
      var vi = idx[faceIndex * 3 + e];
      var p = [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]];
      var d = distanz(p, punkt);
      if (d < besteD) { besteD = d; bester = p; }
    }
    return bester;
  }

  function transformPunkt(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }

  function distanz(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function skalierFaktor(aktuell, neu) {
    if (!isFinite(neu) || neu <= 0) return null;
    if (!isFinite(aktuell) || aktuell <= 0) return null;
    return neu / aktuell;
  }

  function wendeFaktor(transform, faktor) {
    var t = JSON.parse(JSON.stringify(transform));
    t.skalierung = [t.skalierung[0] * faktor, t.skalierung[1] * faktor, t.skalierung[2] * faktor];
    return t;
  }

  var api = {
    naechsterVertex: naechsterVertex,
    transformPunkt: transformPunkt,
    distanz: distanz,
    skalierFaktor: skalierFaktor,
    wendeFaktor: wendeFaktor
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.KlotzwerkMessen = api; }
})();

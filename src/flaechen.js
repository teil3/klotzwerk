/*
 * Flaechenerkennung + Anlege-Mathematik des 3D-Konstruktors.
 * Reine Geometrie, kein three.js. Browser: window.T3KFlaechen, Node: require.
 *
 * findeFlaechen clustert koplanare Dreiecke (Nachbarschaft NICHT noetig --
 * der Ring-Abschluss eines Rohrs ist EINE Flaeche). Wie bei Bambu Studio
 * ist JEDE Region anwaehlbar: ebene Bereiche als eine grosse Flaeche,
 * Rundungen als ihre lokalen Facetten. Frueher warf ein Facetten-Filter
 * Regionen mit glatten Randkanten weg -- das machte Flaechen mit tangential
 * anschliessender Kantenrundung unanwaehlbar.
 * Alle Ein-/Ausgaben in Weltkoordinaten (matrixWelt column-major wie
 * T3KDokument.matAusTransform).
 */
(function () {
  'use strict';

  var D = (typeof module !== 'undefined' && module.exports)
    ? require('./dokument.js') : window.T3KDokument;

  var NORMALE_GRAD = 1;    // Koplanaritaet: Normalen-Abweichung in Grad
  var OFFSET_MM = 0.1;     // Koplanaritaet: Ebenen-Abstand in mm
  var TOL_NORMALE = Math.cos(NORMALE_GRAD * Math.PI / 180);
  var MIN_FLAECHE = 1e-6;  // degenerierte Dreiecke ignorieren (mm2)

  function kreuz(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function skalar(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function normiere(a) {
    var l = Math.sqrt(skalar(a, a));
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  }
  function rund2(x) { return Math.round(x * 100) / 100; }

  function findeFlaechen(vertProperties, triVerts, matrixWelt) {
    var n = Math.floor(triVerts.length / 3);
    if (n > api.MAX_DREIECKE) return null;

    // Vertices in Weltkoordinaten
    var m = matrixWelt;
    var welt = new Float64Array(vertProperties.length);
    for (var vi = 0; vi < vertProperties.length; vi += 3) {
      var x = vertProperties[vi], y = vertProperties[vi + 1], z = vertProperties[vi + 2];
      welt[vi] = m[0] * x + m[4] * y + m[8] * z + m[12];
      welt[vi + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      welt[vi + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    function punkt(idx) { return [welt[idx * 3], welt[idx * 3 + 1], welt[idx * 3 + 2]]; }

    // Je Dreieck: Normale, Flaeche, Schwerpunkt, Ebenen-Offset
    var normalen = [], flaechenMass = [], schwerpunkte = [], offsets = [];
    for (var t = 0; t < n; t++) {
      var p0 = punkt(triVerts[t * 3]), p1 = punkt(triVerts[t * 3 + 1]), p2 = punkt(triVerts[t * 3 + 2]);
      var c = kreuz([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
                    [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]);
      var doppelt = Math.sqrt(skalar(c, c));
      flaechenMass.push(doppelt / 2);
      var nrm = doppelt > 0 ? [c[0] / doppelt, c[1] / doppelt, c[2] / doppelt] : [0, 0, 0];
      normalen.push(nrm);
      schwerpunkte.push([(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3]);
      offsets.push(skalar(nrm, p0));
    }

    // Kanten-Map ueber quantisierte Positionen: STL-Soups haben doppelte
    // Vertices, Index-basierte Kanten wuerden dort nie zusammenfinden.
    function punktKey(idx) {
      return Math.round(welt[idx * 3] * 1e4) + ',' +
             Math.round(welt[idx * 3 + 1] * 1e4) + ',' +
             Math.round(welt[idx * 3 + 2] * 1e4);
    }
    var kanten = {};   // "keyA|keyB" (sortiert) -> [Dreieck-Indizes]
    for (t = 0; t < n; t++) {
      if (flaechenMass[t] < MIN_FLAECHE) continue;
      for (var e = 0; e < 3; e++) {
        var kA = punktKey(triVerts[t * 3 + e]), kB = punktKey(triVerts[t * 3 + (e + 1) % 3]);
        var schluessel = kA < kB ? kA + '|' + kB : kB + '|' + kA;
        (kanten[schluessel] = kanten[schluessel] || []).push(t);
      }
    }

    // Union-Find; Vergleich immer gegen die REFERENZ-Ebene der Region
    // (erstes Dreieck), damit leichte Kruemmung nicht schleichend driftet.
    var wurzel = new Int32Array(n);
    for (t = 0; t < n; t++) wurzel[t] = t;
    function finde(a) { while (wurzel[a] !== a) { wurzel[a] = wurzel[wurzel[a]]; a = wurzel[a]; } return a; }
    function koplanar(a, b) {
      return skalar(normalen[a], normalen[b]) >= TOL_NORMALE &&
             Math.abs(offsets[a] - offsets[b]) <= OFFSET_MM;
    }
    Object.keys(kanten).forEach(function (k) {
      var ts = kanten[k];
      if (ts.length !== 2) return;
      var ra = finde(ts[0]), rb = finde(ts[1]);
      if (ra !== rb && koplanar(ra, rb)) wurzel[rb] = ra;
    });

    // Regionen einsammeln
    var regionen = {};   // wurzel -> [Dreieck-Indizes]
    for (t = 0; t < n; t++) {
      if (flaechenMass[t] < MIN_FLAECHE) continue;
      var r = finde(t);
      (regionen[r] = regionen[r] || []).push(t);
    }

    // Alle Regionen aggregieren -- jede ist anwaehlbar (Bambu-Verhalten)
    var kandidaten = [];
    Object.keys(regionen).forEach(function (r) {
      var tris = regionen[r];
      var gesamt = 0, nrm = [0, 0, 0], zen = [0, 0, 0];
      tris.forEach(function (ti) {
        var f = flaechenMass[ti];
        gesamt += f;
        nrm[0] += normalen[ti][0] * f; nrm[1] += normalen[ti][1] * f; nrm[2] += normalen[ti][2] * f;
        zen[0] += schwerpunkte[ti][0] * f; zen[1] += schwerpunkte[ti][1] * f; zen[2] += schwerpunkte[ti][2] * f;
      });
      kandidaten.push({
        dreiecke: tris, flaecheMm2: gesamt, normale: normiere(nrm),
        zentrum: [zen[0] / gesamt, zen[1] / gesamt, zen[2] / gesamt],
        offset: skalar(normiere(nrm), schwerpunkte[tris[0]])
      });
    });

    // Koplanare Regionen verschmelzen (Inseln in einer Ebene). Der Merge
    // ist O(k^2) -- bei organischen Meshes (jedes Dreieck eine Region)
    // waere das zu teuer, dort bleiben Inseln getrennt. Verschmerzbar:
    // der Merge ist nur eine Nettigkeit fuers Anlegen auf z.B. vier Fuessen.
    var flaechen = [];
    if (kandidaten.length > api.MAX_MERGE_KANDIDATEN) {
      flaechen = kandidaten;
    } else kandidaten.forEach(function (kand) {
      for (var i = 0; i < flaechen.length; i++) {
        var f = flaechen[i];
        if (skalar(f.normale, kand.normale) >= TOL_NORMALE && Math.abs(f.offset - kand.offset) <= OFFSET_MM) {
          var g = f.flaecheMm2 + kand.flaecheMm2;
          f.zentrum = [
            (f.zentrum[0] * f.flaecheMm2 + kand.zentrum[0] * kand.flaecheMm2) / g,
            (f.zentrum[1] * f.flaecheMm2 + kand.zentrum[1] * kand.flaecheMm2) / g,
            (f.zentrum[2] * f.flaecheMm2 + kand.zentrum[2] * kand.flaecheMm2) / g];
          f.normale = normiere([
            f.normale[0] * f.flaecheMm2 + kand.normale[0] * kand.flaecheMm2,
            f.normale[1] * f.flaecheMm2 + kand.normale[1] * kand.flaecheMm2,
            f.normale[2] * f.flaecheMm2 + kand.normale[2] * kand.flaecheMm2]);
          f.flaecheMm2 = g;
          f.dreiecke = f.dreiecke.concat(kand.dreiecke);
          return;
        }
      }
      flaechen.push(kand);
    });

    flaechen.sort(function (a, b) { return b.flaecheMm2 - a.flaecheMm2; });
    var dreieckZuFlaeche = new Int32Array(n).fill(-1);
    flaechen.forEach(function (f, fi) {
      delete f.offset;
      f.dreiecke.forEach(function (ti) { dreieckZuFlaeche[ti] = fi; });
    });
    return { flaechen: flaechen, dreieckZuFlaeche: dreieckZuFlaeche };
  }

  // Kuerzeste Rotation, die Einheitsvektor u auf Einheitsvektor v dreht,
  // als 4x4 column-major (Rodrigues). Sonderfaelle: parallel -> Einheit,
  // antiparallel -> 180 Grad um eine beliebige orthogonale Achse.
  function rotationZwischen(u, v) {
    var d = Math.max(-1, Math.min(1, skalar(u, v)));
    var achse;
    if (d < -0.999999) {
      achse = normiere(kreuz(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    } else if (d > 0.999999) {
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    } else {
      achse = normiere(kreuz(u, v));
    }
    var w = Math.acos(d);
    var c = Math.cos(w), s = Math.sin(w), t = 1 - c;
    var x = achse[0], y = achse[1], z = achse[2];
    return [
      t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
      t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
      0, 0, 0, 1
    ];
  }

  function drehePunkt(R, p) {
    return [R[0] * p[0] + R[4] * p[1] + R[8] * p[2],
            R[1] * p[0] + R[5] * p[1] + R[9] * p[2],
            R[2] * p[0] + R[6] * p[1] + R[10] * p[2]];
  }

  // R (Weltrotation) vor die bestehende Objektrotation setzen
  function komponiereRotation(R, transform) {
    var alt = D.matAusTransform({ position: [0, 0, 0], rotation: transform.rotation, skalierung: [1, 1, 1] });
    return D.transformAusMat(D.matMul(R, alt)).rotation.map(rund2);
  }

  // Flaeche A (am Objekt mit transform) buendig auf Flaeche B:
  // Normalen entgegengesetzt, Zentrum A landet auf Zentrum B.
  function berechneAnlegeTransform(transform, flaecheA, flaecheB) {
    var R = rotationZwischen(flaecheA.normale,
      [-flaecheB.normale[0], -flaecheB.normale[1], -flaecheB.normale[2]]);
    var v = drehePunkt(R, [
      flaecheA.zentrum[0] - transform.position[0],
      flaecheA.zentrum[1] - transform.position[1],
      flaecheA.zentrum[2] - transform.position[2]]);
    return {
      position: [rund2(flaecheB.zentrum[0] - v[0]), rund2(flaecheB.zentrum[1] - v[1]), rund2(flaecheB.zentrum[2] - v[2])],
      rotation: komponiereRotation(R, transform)
    };
  }

  // Flaeche A nach unten auf die Arbeitsflaeche: Rotation um das
  // BBox-Zentrum (X/Y bleiben), dann absenken auf Z=0.
  function berechnePlattenTransform(transform, flaecheA, vertProperties) {
    var R = rotationZwischen(flaecheA.normale, [0, 0, -1]);
    var mAlt = D.matAusTransform(transform);
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    var i, x, y, z, wx, wy, wz;
    for (i = 0; i < vertProperties.length; i += 3) {
      x = vertProperties[i]; y = vertProperties[i + 1]; z = vertProperties[i + 2];
      wx = mAlt[0] * x + mAlt[4] * y + mAlt[8] * z + mAlt[12];
      wy = mAlt[1] * x + mAlt[5] * y + mAlt[9] * z + mAlt[13];
      wz = mAlt[2] * x + mAlt[6] * y + mAlt[10] * z + mAlt[14];
      if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
      if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
      if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
    }
    var zentrum = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    var v = drehePunkt(R, [
      transform.position[0] - zentrum[0],
      transform.position[1] - zentrum[1],
      transform.position[2] - zentrum[2]]);
    var position = [zentrum[0] + v[0], zentrum[1] + v[1], zentrum[2] + v[2]];
    var rotation = komponiereRotation(R, transform);
    // Absenken: tiefstes Vertex der NEUEN Pose auf Z=0
    var mNeu = D.matAusTransform({ position: position, rotation: rotation, skalierung: transform.skalierung });
    var minZ = Infinity;
    for (i = 0; i < vertProperties.length; i += 3) {
      x = vertProperties[i]; y = vertProperties[i + 1]; z = vertProperties[i + 2];
      wz = mNeu[2] * x + mNeu[6] * y + mNeu[10] * z + mNeu[14];
      if (wz < minZ) minZ = wz;
    }
    return {
      position: [rund2(position[0]), rund2(position[1]), rund2(position[2] - minZ)],
      rotation: rotation
    };
  }

  var api = {
    MAX_DREIECKE: 300000,
    MAX_MERGE_KANDIDATEN: 2000,
    findeFlaechen: findeFlaechen,
    berechneAnlegeTransform: berechneAnlegeTransform,
    berechnePlattenTransform: berechnePlattenTransform
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.T3KFlaechen = api; }
})();

/*
 * Ebenen-Konstruktion fuer den Raster-Schnitt (Mehrfach-Schnittebenen).
 * Reine Geometrie, kein three.js. Browser: window.KlotzwerkSchnitt, Node: require.
 *
 * baueSchnittEbenen macht aus der Anker-Pose (Position + Rotation der
 * Gizmo-Ebene, Grad, three-Euler 'XYZ') und der Raster-Konfig
 * {nZ,dZ,nX,dX,nY,dY} eine Ebenen-Liste [{normal, offset}] in
 * Weltkoordinaten (Ebene: normal*x = offset). Der Anker ist die erste
 * Ebene jeder Achse, weitere stapeln bei +k*Abstand entlang der Achse.
 * Da |normal| = 1 gilt: offset(k) = normal*position + k*abstand.
 */
(function () {
  'use strict';

  var D = (typeof module !== 'undefined' && module.exports)
    ? require('./dokument.js') : window.KlotzwerkDokument;

  function baueSchnittEbenen(pose, raster) {
    // Rotationsmatrix ueber matAusTransform (garantiert three-'XYZ'-Konvention);
    // Spalten der 4x4 (column-major) = lokale Achsen in Weltkoordinaten.
    var m = D.matAusTransform({ position: [0, 0, 0], rotation: pose.rotation, skalierung: [1, 1, 1] });
    var achseX = [m[0], m[1], m[2]];
    var achseY = [m[4], m[5], m[6]];
    var achseZ = [m[8], m[9], m[10]];
    var p = pose.position;
    var ebenen = [];
    function dazu(n, anzahl, abstand) {
      var basis = n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
      for (var k = 0; k < anzahl; k++) {
        ebenen.push({ normal: [n[0], n[1], n[2]], offset: basis + k * abstand });
      }
    }
    dazu(achseZ, raster.nZ, raster.dZ);
    dazu(achseX, raster.nX, raster.dX);
    dazu(achseY, raster.nY, raster.dY);
    return ebenen;
  }

  var api = { baueSchnittEbenen: baueSchnittEbenen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.KlotzwerkSchnitt = api;
})();

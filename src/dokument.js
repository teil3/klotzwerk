/*
 * Datenmodell des 3D-Konstruktors: reine Daten, kein three.js.
 * Browser haengt an window.KlotzwerkDokument, Node testet via require().
 * Transform-Konvention wie three.js: Euler 'XYZ' in Grad, Matrix column-major,
 * Komposition T * R * S. Die CSG-Seite nutzt DIESELBEN Matrizen (csg-kern.js),
 * damit Anzeige und Verrechnung nie auseinanderlaufen.
 */
(function () {
  'use strict';

  var STANDARD_PARAMS = {
    quader:   { breite: 20, tiefe: 20, hoehe: 20 },
    zylinder: { durchmesser: 20, hoehe: 20 },
    kugel:    { durchmesser: 20 },
    kegel:    { durchmesserUnten: 20, durchmesserOben: 0, hoehe: 20 },
    pyramide: { seite: 20, hoehe: 20 },
    torus:    { durchmesser: 24, dicke: 6 },
    rohr:     { durchmesser: 20, wand: 2, hoehe: 20 }
  };

  var STANDARD_FARBE = '#5a8dc8';

  var NAMEN = {
    quader: 'Quader', zylinder: 'Zylinder', kugel: 'Kugel', kegel: 'Kegel',
    pyramide: 'Pyramide', torus: 'Torus', rohr: 'Rohr', gruppe: 'Gruppe',
    schnittgruppe: 'Schnittgruppe'
  };

  function neutralesTransform() {
    return { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] };
  }

  function neuesDokument() {
    return { version: 1, naechsteId: 1, objekte: [] };
  }

  function neuerKoerper(dok, typ) {
    if (!STANDARD_PARAMS[typ]) throw new Error('Unbekannter Koerper-Typ: ' + typ);
    var k = {
      id: 'k' + (dok.naechsteId++),
      typ: typ,
      name: NAMEN[typ],
      params: JSON.parse(JSON.stringify(STANDARD_PARAMS[typ])),
      transform: neutralesTransform(),
      istLoch: false,
      farbe: STANDARD_FARBE,
      sichtbar: true
    };
    dok.objekte.push(k);
    return k;
  }

  function neuerImport(dok, name, assetId, dreiecke, wasserdicht) {
    var k = {
      id: 'k' + (dok.naechsteId++),
      typ: 'import',
      name: name,
      params: { assetId: assetId, dreiecke: dreiecke, wasserdicht: !!wasserdicht },
      transform: neutralesTransform(),
      istLoch: false,
      farbe: STANDARD_FARBE,
      sichtbar: true
    };
    dok.objekte.push(k);
    return k;
  }

  function enthaeltNichtWasserdicht(knoten) {
    if (knoten.typ === 'import') return !knoten.params.wasserdicht;
    if (knoten.typ === 'gruppe') return knoten.kinder.some(enthaeltNichtWasserdicht);
    return false;
  }

  function findeIn(liste, id) {
    for (var i = 0; i < liste.length; i++) {
      if (liste[i].id === id) return liste[i];
      if (liste[i].typ === 'gruppe') {
        var t = findeIn(liste[i].kinder, id);
        if (t) return t;
      }
    }
    return null;
  }

  function findeKnoten(dok, id) { return findeIn(dok.objekte, id); }

  function entferneKnoten(dok, id) {
    for (var i = 0; i < dok.objekte.length; i++) {
      if (dok.objekte[i].id === id) { dok.objekte.splice(i, 1); return true; }
    }
    return false;
  }

  function setzeLoch(dok, id, istLoch) {
    var k = findeKnoten(dok, id);
    if (k) k.istLoch = !!istLoch;
  }

  function setzeSichtbar(dok, id, sichtbar) {
    var k = findeKnoten(dok, id);
    if (k) k.sichtbar = !!sichtbar;
  }

  function setzeFarbe(dok, id, farbe) {
    if (typeof farbe !== 'string' || !/^#[0-9a-f]{6}$/i.test(farbe)) return;
    var k = findeKnoten(dok, id);
    if (k) k.farbe = farbe.toLowerCase();
  }

  function kopiereMitNeuenIds(dok, knoten) {
    var kopie = JSON.parse(JSON.stringify(knoten));
    (function neueIds(n) {
      n.id = (n.typ === 'gruppe' ? 'g' : 'k') + (dok.naechsteId++);
      if (n.typ === 'gruppe') n.kinder.forEach(neueIds);
    })(kopie);
    return kopie;
  }

  function dupliziere(dok, id) {
    var orig = null;
    for (var i = 0; i < dok.objekte.length; i++) {
      if (dok.objekte[i].id === id) orig = dok.objekte[i];
    }
    if (!orig) return null;
    // Kein Versatz: das Duplikat liegt an der GLEICHEN Position wie das
    // Original (User-Entscheid 2026-08-10). Der fruehere +10/+10-Versatz
    // sollte die Kopie sichtbar machen, verstellte aber genau den haeufigen
    // Anwendungsfall «kopieren und dann exakt verschieben/ausrichten».
    var kopie = kopiereMitNeuenIds(dok, orig);
    dok.objekte.push(kopie);
    return kopie.id;
  }

  function gruppiere(dok, ids, modus) {
    if (!ids || ids.length < 2) throw new Error('Gruppieren braucht mindestens 2 Objekte');
    var kinder = [];
    ids.forEach(function (id) {
      var idx = -1;
      for (var i = 0; i < dok.objekte.length; i++) {
        if (dok.objekte[i].id === id) idx = i;
      }
      if (idx < 0) throw new Error('Objekt nicht auf oberster Ebene: ' + id);
      kinder.push(dok.objekte[idx]);
      dok.objekte.splice(idx, 1);
    });
    var vorbild = null;
    kinder.forEach(function (kind) { if (!vorbild && !kind.istLoch) vorbild = kind; });
    var g = {
      id: 'g' + (dok.naechsteId++),
      typ: 'gruppe',
      name: modus === 'ueberschneiden' ? NAMEN.schnittgruppe : NAMEN.gruppe,
      kinder: kinder,
      transform: neutralesTransform(),
      istLoch: false,
      farbe: (vorbild && vorbild.farbe) || STANDARD_FARBE,
      sichtbar: true
    };
    if (modus === 'ueberschneiden') g.modus = 'ueberschneiden';
    dok.objekte.push(g);
    return g.id;
  }

  function loeseAuf(dok, gruppenId) {
    var g = null, idx = -1;
    for (var i = 0; i < dok.objekte.length; i++) {
      if (dok.objekte[i].id === gruppenId) { g = dok.objekte[i]; idx = i; }
    }
    if (!g || g.typ !== 'gruppe') return [];
    var mg = matAusTransform(g.transform);
    var ids = [];
    g.kinder.forEach(function (kind) {
      kind.transform = transformAusMat(matMul(mg, matAusTransform(kind.transform)));
      dok.objekte.push(kind);
      ids.push(kind.id);
    });
    dok.objekte.splice(idx, 1);
    return ids;
  }

  function serialisiere(dok) { return JSON.stringify(dok); }

  // Aeltere Projekte (vor sichtbar-Flag bzw. Objektfarbe) rekursiv nachruesten
  function ergaenzeStandards(liste) {
    liste.forEach(function (k) {
      if (typeof k.sichtbar !== 'boolean') k.sichtbar = true;
      if (typeof k.farbe !== 'string') k.farbe = STANDARD_FARBE;
      if (k.typ === 'gruppe') ergaenzeStandards(k.kinder);
    });
  }

  function deserialisiere(s) {
    var dok = JSON.parse(s);
    if (!dok || dok.version !== 1) throw new Error('Unbekannte Projekt-Version');
    ergaenzeStandards(dok.objekte);
    return dok;
  }

  // --- Mat4-Helfer (Konvention wie THREE.Matrix4, column-major) ----------

  var GRAD = Math.PI / 180;

  function matAusTransform(t) {
    // Quaternion aus Euler 'XYZ' (wie THREE.Quaternion.setFromEuler)
    var x = t.rotation[0] * GRAD, y = t.rotation[1] * GRAD, z = t.rotation[2] * GRAD;
    var c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    var s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    var qx = s1 * c2 * c3 + c1 * s2 * s3;
    var qy = c1 * s2 * c3 - s1 * c2 * s3;
    var qz = c1 * c2 * s3 + s1 * s2 * c3;
    var qw = c1 * c2 * c3 - s1 * s2 * s3;
    // Matrix aus Quaternion + Skalierung + Translation (wie Matrix4.compose)
    var x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    var xx = qx * x2, xy = qx * y2, xz = qx * z2;
    var yy = qy * y2, yz = qy * z2, zz = qz * z2;
    var wx = qw * x2, wy = qw * y2, wz = qw * z2;
    var sx = t.skalierung[0], sy = t.skalierung[1], sz = t.skalierung[2];
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t.position[0], t.position[1], t.position[2], 1
    ];
  }

  function matMul(a, b) {
    var r = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var z = 0; z < 4; z++) {
        r[c * 4 + z] = a[z] * b[c * 4] + a[4 + z] * b[c * 4 + 1] +
                       a[8 + z] * b[c * 4 + 2] + a[12 + z] * b[c * 4 + 3];
      }
    }
    return r;
  }

  function laenge(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

  function transformAusMat(m) {
    // wie THREE.Matrix4.decompose + Euler.setFromRotationMatrix('XYZ').
    // Scherung (Rotation kombiniert mit ungleicher Skalierung in der Gruppe)
    // wird auf die naechstliegende T/R/S-Kombination gerundet.
    var sx = laenge(m[0], m[1], m[2]);
    var sy = laenge(m[4], m[5], m[6]);
    var sz = laenge(m[8], m[9], m[10]);
    var det = m[0] * (m[5] * m[10] - m[6] * m[9]) -
              m[4] * (m[1] * m[10] - m[2] * m[9]) +
              m[8] * (m[1] * m[6] - m[2] * m[5]);
    if (det < 0) sx = -sx;
    var r11 = m[0] / sx, r12 = m[4] / sy, r13 = m[8] / sz;
    var r21 = m[1] / sx, r22 = m[5] / sy, r23 = m[9] / sz;
    var r31 = m[2] / sx, r32 = m[6] / sy, r33 = m[10] / sz;
    var ry = Math.asin(Math.max(-1, Math.min(1, r13)));
    var rx, rz;
    if (Math.abs(r13) < 0.9999999) {
      rx = Math.atan2(-r23, r33);
      rz = Math.atan2(-r12, r11);
    } else {
      rx = Math.atan2(r32, r22);
      rz = 0;
    }
    return {
      position: [m[12], m[13], m[14]],
      rotation: [rx / GRAD, ry / GRAD, rz / GRAD],
      skalierung: [sx, sy, sz]
    };
  }

  var api = {
    STANDARD_PARAMS: STANDARD_PARAMS,
    STANDARD_FARBE: STANDARD_FARBE,
    neuesDokument: neuesDokument,
    neuerKoerper: neuerKoerper,
    neuerImport: neuerImport,
    findeKnoten: findeKnoten,
    entferneKnoten: entferneKnoten,
    setzeLoch: setzeLoch,
    setzeSichtbar: setzeSichtbar,
    setzeFarbe: setzeFarbe,
    dupliziere: dupliziere,
    gruppiere: gruppiere,
    loeseAuf: loeseAuf,
    serialisiere: serialisiere,
    deserialisiere: deserialisiere,
    matAusTransform: matAusTransform,
    matMul: matMul,
    transformAusMat: transformAusMat,
    enthaeltNichtWasserdicht: enthaeltNichtWasserdicht
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.KlotzwerkDokument = api; }
})();

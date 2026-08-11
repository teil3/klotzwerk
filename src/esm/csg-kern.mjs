/*
 * CSG-Kern des 3D-Konstruktors: baut Manifold-Koerper aus Dokument-Knoten
 * und verrechnet Gruppen (difference(union(solide), union(loecher))).
 * Laeuft im Modul-Worker (Browser) und via import() in Node-Tests.
 *
 * WICHTIG: matAusTransform ist eine Kopie der gleichnamigen Funktion in
 * ../dokument.js (three-'XYZ'-Konvention). Wer die eine aendert, muss die
 * andere nachziehen -- der Transform-Test in
 * tests/generators/3d-konstruktor.csg.test.js faengt Abweichungen.
 */

import { baueSdf } from './sdf.mjs?v=2026-08-05p';

const SEGMENTE = 64;
const GRAD = Math.PI / 180;

export function matAusTransform(t) {
  const x = t.rotation[0] * GRAD, y = t.rotation[1] * GRAD, z = t.rotation[2] * GRAD;
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  const qx = s1 * c2 * c3 + c1 * s2 * s3;
  const qy = c1 * s2 * c3 - s1 * c2 * s3;
  const qz = c1 * c2 * s3 + s1 * s2 * c3;
  const qw = c1 * c2 * c3 - s1 * s2 * s3;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  const sx = t.skalierung[0], sy = t.skalierung[1], sz = t.skalierung[2];
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t.position[0], t.position[1], t.position[2], 1
  ];
}

export function volumen(m) {
  return (typeof m.volume === 'function') ? m.volume() : m.getProperties().volume;
}

function istLeer(m) {
  if (!m) return true;
  if (typeof m.isEmpty === 'function') return m.isEmpty();
  return m.numTri() === 0;
}

// Prueft, ob eine importierte Dreieck-Soup als Manifold verrechenbar
// (wasserdicht) ist. merge() verschweisst deckungsgleiche Eckpunkte;
// die Manifold-Konstruktion schlaegt bei offenen Meshes fehl.
export function pruefeAsset(M, vertProperties, triVerts) {
  const mesh = new M.Mesh({ numProp: 3, vertProperties, triVerts });
  mesh.merge();
  let wasserdicht = false;
  try {
    const m = new M.Manifold(mesh);
    wasserdicht = !istLeer(m);
    m.delete();
  } catch (e) { wasserdicht = false; }
  return { wasserdicht, dreiecke: triVerts.length / 3 };
}

export function baueKoerper(M, typ, params, assets) {
  const Man = M.Manifold;
  const p = params;
  switch (typ) {
    case 'quader': {
      // cube(groesse, center=true) zentriert; danach Unterseite auf Z=0
      const c = Man.cube([p.breite, p.tiefe, p.hoehe], true);
      const r = c.translate([0, 0, p.hoehe / 2]);
      c.delete();
      return r;
    }
    case 'zylinder':
      // cylinder(hoehe, rUnten, rOben, segmente, center=false): Basis auf Z=0
      return Man.cylinder(p.hoehe, p.durchmesser / 2, p.durchmesser / 2, SEGMENTE, false);
    case 'kugel': {
      const s = Man.sphere(p.durchmesser / 2, SEGMENTE);
      const r = s.translate([0, 0, p.durchmesser / 2]);
      s.delete();
      return r;
    }
    case 'kegel':
      return Man.cylinder(p.hoehe, p.durchmesserUnten / 2, Math.max(p.durchmesserOben / 2, 0), SEGMENTE, false);
    case 'pyramide': {
      // 4-eckiger "Zylinder": Umkreisradius = seite/sqrt(2), um 45 Grad gedreht
      const zyl = Man.cylinder(p.hoehe, p.seite / Math.SQRT2, 0, 4, false);
      const r = zyl.rotate([0, 0, 45]);
      zyl.delete();
      return r;
    }
    case 'torus': {
      // Kreisquerschnitt um die Z-Achse rotiert; durchmesser = Aussendurchmesser
      const r = p.dicke / 2;
      const R = (p.durchmesser - p.dicke) / 2;
      const cs = M.CrossSection.circle(r, 32).translate([R, 0]);
      const t = Man.revolve(cs, SEGMENTE);
      cs.delete();
      const erg = t.translate([0, 0, r]);
      t.delete();
      return erg;
    }
    case 'rohr': {
      const aussen = Man.cylinder(p.hoehe, p.durchmesser / 2, p.durchmesser / 2, SEGMENTE, false);
      const innen = Man.cylinder(p.hoehe + 2, p.durchmesser / 2 - p.wand, p.durchmesser / 2 - p.wand, SEGMENTE, false)
        .translate([0, 0, -1]);
      const r = Man.difference(aussen, innen);
      aussen.delete(); innen.delete();
      return r;
    }
    case 'import': {
      const asset = assets && assets[p.assetId];
      if (!asset) throw new Error('Importiertes Modell nicht gefunden');
      if (!asset.wasserdicht) {
        throw new Error('"' + (asset.name || 'Import') + '" ist nicht wasserdicht und kann nicht verrechnet werden');
      }
      const mesh = new M.Mesh({ numProp: 3, vertProperties: asset.vertProperties, triVerts: asset.triVerts });
      mesh.merge();
      return new M.Manifold(mesh);
    }
    default:
      throw new Error('Unbekannter Koerper-Typ: ' + typ);
  }
}

function vereinige(M, liste) {
  if (liste.length === 0) return null;
  let acc = liste[0];
  for (let i = 1; i < liste.length; i++) {
    const next = M.Manifold.union(acc, liste[i]);
    acc.delete(); liste[i].delete();
    acc = next;
  }
  return acc;
}

export function knotenZuManifold(M, knoten, ohneEigenesTransform, assets) {
  let basis;
  if (knoten.typ === 'gruppe') {
    const solide = [], loecher = [];
    try {
      for (const kind of knoten.kinder) {
        const m = knotenZuManifold(M, kind, false, assets);
        if (!m) continue;                    // leere Unter-Gruppe
        (kind.istLoch ? loecher : solide).push(m);
      }
    } catch (e) {
      // Kind-Aufbau abgebrochen (Import "nicht gefunden"/"nicht wasserdicht"):
      // bereits gebaute Manifolds dieser Gruppe sonst geleakt.
      solide.forEach((m) => m.delete());
      loecher.forEach((m) => m.delete());
      throw e;
    }
    let s = vereinige(M, solide);
    const l = vereinige(M, loecher);
    if (!s) { if (l) l.delete(); return null; }
    if (l) {
      const d = M.Manifold.difference(s, l);
      s.delete(); l.delete();
      s = d;
    }
    if (istLeer(s)) { s.delete(); return null; }
    basis = s;
  } else {
    basis = baueKoerper(M, knoten.typ, knoten.params, assets);
  }
  if (!ohneEigenesTransform) {
    const t = basis.transform(matAusTransform(knoten.transform));
    basis.delete();
    basis = t;
  }
  if (istLeer(basis)) { basis.delete(); return null; }
  return basis;
}

// Schneidet einen Knoten (mit seinem Transform, also in Weltkoordinaten)
// an der Ebene n*x = offset. Liefert pro zusammenhaengendem Stueck ein
// Mesh, zuerst die Stuecke auf der Normalen-Seite. Weniger als 2 Teile
// heisst: die Ebene verfehlt das Objekt.
export function schneideKnoten(M, knoten, normal, offset, assets) {
  const basis = knotenZuManifold(M, knoten, false, assets);
  if (!basis) return [];
  const seiten = basis.splitByPlane(normal, offset);
  basis.delete();
  const teile = [];
  for (const seite of seiten) {
    if (!seite) continue;
    if (istLeer(seite)) { seite.delete(); continue; }
    for (const stueck of seite.decompose()) {
      if (istLeer(stueck)) { stueck.delete(); continue; }
      teile.push(manifoldZuMesh(stueck));
      stueck.delete();
    }
    seite.delete();
  }
  return teile;
}

// --- Strecken: Objekt an einer Ebene auseinanderziehen -------------------
// Ebene n*x = offset (Weltkoordinaten). Beide Haelften wandern um breite/2
// symmetrisch auseinander, die Luecke fuellt die Extrusion des Schnitt-
// Querschnitts (CrossSection: Loecher bleiben Loecher). Gerechnet wird im
// Ebenen-Koordinatensystem (Normale -> +Z, Ebene auf z=0).

function streckenTransforms(normal, offset) {
  const R = rotationVonZ(normal);   // dreht +Z auf die Normale (3x3, spaltenweise)
  // hin: x' = R^T * x, dann z' -= offset  (Spalten von R^T = Zeilen von R)
  const hin = [
    R[0], R[3], R[6], 0,
    R[1], R[4], R[7], 0,
    R[2], R[5], R[8], 0,
    0, 0, -offset, 1
  ];
  // zurueck: x = R * x' + n * offset
  const zurueck = [
    R[0], R[1], R[2], 0,
    R[3], R[4], R[5], 0,
    R[6], R[7], R[8], 0,
    normal[0] * offset, normal[1] * offset, normal[2] * offset, 1
  ];
  return { hin, zurueck };
}

export function streckeKnoten(M, knoten, normal, offset, breite, assets) {
  const basis = knotenZuManifold(M, knoten, false, assets);
  if (!basis) throw new Error('Das Objekt ist leer.');
  if (!(breite >= 0)) throw new Error('Die Breite muss 0 oder grösser sein.');
  const mats = streckenTransforms(normal, offset);
  let gedreht = null, quer = null, seiten = null, mitte = null, mitteV = null,
      obenV = null, untenV = null, u1 = null, erg = null, zurueckM = null;
  try {
    gedreht = basis.transform(mats.hin);
    quer = gedreht.slice(0);
    if (!quer || quer.area() < 1e-9) throw new Error('Die Ebene trifft das Objekt nicht.');
    if (breite < 1e-9) return manifoldZuMesh(basis);
    seiten = gedreht.splitByPlane([0, 0, 1], 0);
    mitte = M.Manifold.extrude(quer, breite);          // z in [0, breite]
    mitteV = mitte.translate([0, 0, -breite / 2]);
    obenV = seiten[0].translate([0, 0, breite / 2]);
    untenV = seiten[1].translate([0, 0, -breite / 2]);
    u1 = M.Manifold.union(untenV, mitteV);
    erg = M.Manifold.union(u1, obenV);
    if (istLeer(erg)) throw new Error('Das Ergebnis ist leer — Vorgang abgebrochen.');
    zurueckM = erg.transform(mats.zurueck);
    return manifoldZuMesh(zurueckM);
  } finally {
    basis.delete();
    if (gedreht) gedreht.delete();
    if (quer) quer.delete();
    if (seiten) seiten.forEach((s) => { if (s) s.delete(); });
    if (mitte) mitte.delete();
    if (mitteV) mitteV.delete();
    if (obenV) obenV.delete();
    if (untenV) untenV.delete();
    if (u1) u1.delete();
    if (erg) erg.delete();
    if (zurueckM) zurueckM.delete();
  }
}

// Vorschau-Bausteine fuer die Live-Interaktion im Client: die beiden
// Haelften in WELT-Koordinaten (teilA = Seite in Normalenrichtung) plus
// das Mittelstueck mit Einheitsbreite in EBENEN-Koordinaten (z in
// [-0.5, 0.5]) -- der Client skaliert es entlang z auf die Breite und
// verschiebt die Haelften, ganz ohne CSG pro Scroll-Tick.
export function streckenVorschau(M, knoten, normal, offset, assets) {
  const basis = knotenZuManifold(M, knoten, false, assets);
  if (!basis) throw new Error('Das Objekt ist leer.');
  const mats = streckenTransforms(normal, offset);
  let gedreht = null, quer = null, seiten = null, mitte = null, mitteV = null,
      obenW = null, untenW = null;
  try {
    gedreht = basis.transform(mats.hin);
    quer = gedreht.slice(0);
    if (!quer || quer.area() < 1e-9) throw new Error('Die Ebene trifft das Objekt nicht.');
    seiten = gedreht.splitByPlane([0, 0, 1], 0);
    obenW = seiten[0].transform(mats.zurueck);
    untenW = seiten[1].transform(mats.zurueck);
    mitte = M.Manifold.extrude(quer, 1);
    mitteV = mitte.translate([0, 0, -0.5]);
    return { teilA: manifoldZuMesh(obenW), teilB: manifoldZuMesh(untenW), mitte: manifoldZuMesh(mitteV) };
  } finally {
    basis.delete();
    if (gedreht) gedreht.delete();
    if (quer) quer.delete();
    if (seiten) seiten.forEach((s) => { if (s) s.delete(); });
    if (mitte) mitte.delete();
    if (mitteV) mitteV.delete();
    if (obenW) obenW.delete();
    if (untenW) untenW.delete();
  }
}

// Versetzt die Oberflaeche eines Knotens um wandstaerke nach innen oder
// aussen (eigene SDF + Manifold.levelSet) und verrechnet mit dem Original:
//   innen  -> Original minus geschrumpfter Koerper (aushoehlen)
//   aussen -> gewachsener Koerper vereinigt mit Original (aufdicken)
// Aufloesung ist hart gedeckelt (~200^3 Abtastpunkte), damit die Rechenzeit
// durch die Modellgroesse begrenzt bleibt statt eines Timeouts.
// Entfernt winzige lose Komponenten ("Kruemel") aus einem Manifold:
// Vorzeichen-Rauschen des SDF an scharfen Kanten (Sliver-Dreiecke aus
// CSG-Schnitten) kann beim levelSet einzelne Marching-Cubes-Zellen als
// schwebende Splitter hinterlassen (User-Fund beim Aufdicken). Grenze:
// Volumen unter ~2 Zellen Kantenlaenge (8 * edgeLength^3); die groesste
// Komponente bleibt IMMER, auch wenn sie darunter laege. Nimmt Besitz
// des uebergebenen Manifolds (loescht es bei Ersatz).
export function entferneKruemel(M, m, edgeLength) {
  const teile = m.decompose();
  if (teile.length <= 1) {
    teile.forEach((t) => t.delete());
    return m;
  }
  const grenze = 8 * edgeLength * edgeLength * edgeLength;
  let groesste = 0;
  for (let i = 1; i < teile.length; i++) {
    if (Math.abs(volumen(teile[i])) > Math.abs(volumen(teile[groesste]))) groesste = i;
  }
  const behalten = [];
  let entfernt = 0;
  teile.forEach((t, i) => {
    if (i === groesste || Math.abs(volumen(t)) >= grenze) behalten.push(t);
    else { t.delete(); entfernt++; }
  });
  if (!entfernt) {
    behalten.forEach((t) => t.delete());
    return m;
  }
  const neu = vereinige(M, behalten);   // loescht die Eintraege
  m.delete();
  return neu;
}

export function offsetKoerper(M, knoten, richtung, wandstaerke, assets) {
  const basis = knotenZuManifold(M, knoten, false, assets);
  if (!basis) throw new Error('Das Objekt ist leer.');
  let versatz = null, erg = null;
  try {
    const bb = basis.boundingBox();
    const maxKante = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
    const edgeLength = Math.max(wandstaerke / 2, maxKante / 200);
    if (edgeLength > wandstaerke) {
      throw new Error('Eine Wandstärke von ' + wandstaerke +
        ' mm ist bei dieser Modellgrösse nicht auflösbar — wähle eine grössere Wandstärke.');
    }
    const mesh = basis.getMesh();
    const sdf = baueSdf(mesh.vertProperties, mesh.triVerts);
    const rand = (richtung === 'aussen' ? wandstaerke : 0) + 2 * edgeLength;
    const bounds = {
      min: [bb.min[0] - rand, bb.min[1] - rand, bb.min[2] - rand],
      max: [bb.max[0] + rand, bb.max[1] + rand, bb.max[2] + rand]
    };
    // sdf ist positiv innen; levelSet baut die Flaeche sdf == level, der
    // Koerper ist die Region sdf > level. Also: +w schrumpft, -w waechst.
    const level = richtung === 'innen' ? wandstaerke : -wandstaerke;
    versatz = M.Manifold.levelSet(sdf, bounds, edgeLength, level);
    if (richtung === 'innen') {
      if (istLeer(versatz)) {
        throw new Error('Das Objekt ist zu klein zum Aushöhlen mit ' + wandstaerke + ' mm Wand.');
      }
      erg = M.Manifold.difference(basis, versatz);
    } else {
      erg = M.Manifold.union(versatz, basis);
    }
    if (istLeer(erg)) throw new Error('Das Ergebnis ist leer — Vorgang abgebrochen.');
    erg = entferneKruemel(M, erg, edgeLength);
    return manifoldZuMesh(erg);
  } finally {
    basis.delete();
    if (versatz) versatz.delete();
    if (erg) erg.delete();
  }
}

// Rotationsmatrix (spaltenweise 4x3 wie matAusTransform), die die Z-Achse
// auf 'ziel' (normierter Vektor) dreht -- Rodrigues ueber die Drehachse
// Z x ziel. Bei fast antiparalleler Richtung ist die Achse entartet, dann
// dreht eine 180-Grad-Drehung um X.
function rotationVonZ(ziel) {
  const [zx, zy, zz] = ziel;
  // Achse = Z x ziel = (-zy, zx, 0), Laenge = sin(Winkel), zz = cos(Winkel)
  const s2 = zx * zx + zy * zy;
  if (s2 < 1e-12) {
    return zz >= 0
      ? [1, 0, 0, 0, 1, 0, 0, 0, 1]
      : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  }
  const ax = -zy, ay = zx;                     // Achse (unnormiert, az = 0)
  const s = Math.sqrt(s2), c = zz;             // sin/cos des Drehwinkels
  const ux = ax / s, uy = ay / s;              // normierte Achse (uz = 0)
  const t = 1 - c;
  // Rodrigues mit uz = 0, spaltenweise (erste Spalte = Bild der X-Achse)
  return [
    t * ux * ux + c,  t * ux * uy,      -uy * s,
    t * ux * uy,      t * uy * uy + c,   ux * s,
    uy * s,          -ux * s,            c
  ];
}

// Bohrt einen runden Kanal (Weltkoordinaten) in den Knoten: Zylinder mit
// 'durchmesser' entlang der Flaechennormale, von 'marge' ausserhalb der
// Oberflaeche bis 'tiefe' nach innen, per Differenz abgezogen. 'punkt' ist
// der Trefferpunkt auf der Oberflaeche, 'normale' zeigt nach AUSSEN.
// (Frueher wurde das angeklickte Mesh-Dreieck selbst gebohrt -- bei
// Rundungen sind das lange Tortenstuecke, was schmale Schlitze statt eines
// Lochs ergab.)
export function bohreKanal(M, knoten, punkt, normale, tiefe, marge, durchmesser, assets) {
  const basis = knotenZuManifold(M, knoten, false, assets);
  if (!basis) throw new Error('Das Objekt ist leer.');
  const r = durchmesser / 2;
  if (!(r > 0)) throw new Error('Der Lochdurchmesser muss grösser als 0 sein.');
  let roh = null, bohrer = null, probeRoh = null, probe = null, schnitt = null, erg = null;
  try {
    // Zylinder liegt zunaechst entlang +Z mit Basis auf Z=0; Laenge deckt
    // Marge (aussen) und Tiefe (innen) ab, danach an den Trefferpunkt.
    const laenge = marge + tiefe;
    roh = M.Manifold.cylinder(laenge, r, r, SEGMENTE, false);
    // Der Zylinder faengt lokal bei Z=0 an und waechst nach +Z; die gedrehte
    // Z-Achse muss also nach INNEN zeigen (-normale). Startpunkt ist der
    // Trefferpunkt um 'marge' nach aussen versetzt.
    const rotInnen = rotationVonZ([-normale[0], -normale[1], -normale[2]]);
    const rotAussen = rotationVonZ(normale);
    // transform() erwartet 16 Werte (4x4, spaltenweise) wie matAusTransform
    bohrer = roh.transform([
      rotInnen[0], rotInnen[1], rotInnen[2], 0,
      rotInnen[3], rotInnen[4], rotInnen[5], 0,
      rotInnen[6], rotInnen[7], rotInnen[8], 0,
      punkt[0] + normale[0] * marge,
      punkt[1] + normale[1] * marge,
      punkt[2] + normale[2] * marge, 1
    ]);
    if (istLeer(bohrer) || Math.abs(volumen(bohrer)) < 1e-6) {
      throw new Error('Der Lochdurchmesser ist zu klein — wähle einen groesseren Wert.');
    }
    // Verteidigung in der Tiefe gegen eine invertierte Normale (z.B. rueck-
    // seitiger Raycast-Treffer im Roentgen-Modus): dann zeigt die Normale ins
    // Material und der Bohrer frisst sich nach AUSSEN statt nach innen. Eine
    // duenne Probe knapp jenseits der Oberflaeche darf kaum Material treffen.
    // Bewusst kurz und schmal gehalten: bei schraeg zur Flaeche stehenden
    // Normalen (Kanten, Facetten) ragt eine lange Probe sonst ins Nachbar-
    // material und wuerde legitime Stellen ablehnen.
    const probeLaenge = Math.max(marge * 4, r * 0.5);
    probeRoh = M.Manifold.cylinder(probeLaenge, r * 0.5, r * 0.5, SEGMENTE, false);
    probe = probeRoh.transform([
      rotAussen[0], rotAussen[1], rotAussen[2], 0,
      rotAussen[3], rotAussen[4], rotAussen[5], 0,
      rotAussen[6], rotAussen[7], rotAussen[8], 0,
      punkt[0] + normale[0] * marge,
      punkt[1] + normale[1] * marge,
      punkt[2] + normale[2] * marge, 1
    ]);
    schnitt = M.Manifold.intersection(basis, probe);
    if (!istLeer(schnitt) && volumen(schnitt) > 0.25 * volumen(probe)) {
      throw new Error('Der Kanal würde das Modell beschädigen — wähle eine Stelle auf der Aussenseite.');
    }
    erg = M.Manifold.difference(basis, bohrer);
    if (istLeer(erg)) throw new Error('Das Ergebnis ist leer — Vorgang abgebrochen.');
    if (volumen(erg) >= volumen(basis)) {
      throw new Error('Der Kanal würde das Modell beschädigen — wähle eine Stelle auf der Aussenseite.');
    }
    return manifoldZuMesh(erg);
  } finally {
    basis.delete();
    if (roh) roh.delete();
    if (bohrer) bohrer.delete();
    if (probeRoh) probeRoh.delete();
    if (probe) probe.delete();
    if (schnitt) schnitt.delete();
    if (erg) erg.delete();
  }
}

// Schneidet eine ganze ebene Flaeche als Oeffnung aus (Alternative zum
// runden Loch, wie bei Bambu): EINE konvexe Huelle ueber alle Flaechen-
// Punkte, von 'marge' ausserhalb bis 'tiefe' nach innen versetzt, per
// Differenz abgezogen. Die Oeffnung folgt damit der KONTUR der gewaehlten
// Region -- auf gewoelbten Kuppen sind die Regionen zackige Facetten-
// Sterne, ein Prisma pro Dreieck ergab dort zackige Loecher. Bewusster
// Trade-off: nicht-konvexe ebene Flaechen (z.B. L-Form) werden auf ihre
// Huelle aufgeweitet; die Hover-Vorschau zeigt die echte Schnittform.
// 'dreiecke' ist eine flache Liste in Weltkoordinaten (9 Werte pro
// Dreieck), 'normale' zeigt nach AUSSEN. Gleiche Schutzmassnahmen wie
// bohreKanal: Probe knapp ausserhalb gegen invertierte Normalen,
// Volumen-Gegenprobe.
export function oeffneFlaeche(M, knoten, dreiecke, normale, tiefe, marge, assets) {
  const basis = knotenZuManifold(M, knoten, false, assets);
  if (!basis) throw new Error('Das Objekt ist leer.');
  const anzahl = Math.floor(dreiecke.length / 9);
  const [nx, ny, nz] = normale;
  const probeLaenge = Math.max(marge * 4, 0.5);
  const punkte = [], punkteProbe = [];
  let messer = null, probe = null, schnitt = null, erg = null;
  try {
    for (let i = 0; i < anzahl * 9; i += 3) {
      const x = dreiecke[i], y = dreiecke[i + 1], z = dreiecke[i + 2];
      punkte.push([x + nx * marge, y + ny * marge, z + nz * marge],
                  [x - nx * tiefe, y - ny * tiefe, z - nz * tiefe]);
      punkteProbe.push([x + nx * marge, y + ny * marge, z + nz * marge],
                       [x + nx * (marge + probeLaenge), y + ny * (marge + probeLaenge), z + nz * (marge + probeLaenge)]);
    }
    if (punkte.length < 6) throw new Error('Die Fläche ist zu klein zum Ausschneiden.');
    messer = M.Manifold.hull(punkte);
    if (istLeer(messer) || Math.abs(volumen(messer)) < 1e-6) {
      throw new Error('Die Fläche ist zu klein zum Ausschneiden.');
    }
    probe = M.Manifold.hull(punkteProbe);
    // Verteidigung in der Tiefe gegen eine invertierte Normale (analog
    // bohreKanal): eine duenne Probe knapp jenseits der Oberflaeche darf
    // kaum Material treffen, sonst frisst das Prisma nach AUSSEN.
    schnitt = M.Manifold.intersection(basis, probe);
    if (!istLeer(schnitt) && volumen(schnitt) > 0.25 * volumen(probe)) {
      throw new Error('Die Öffnung würde das Modell beschädigen — wähle eine Fläche auf der Aussenseite.');
    }
    erg = M.Manifold.difference(basis, messer);
    if (istLeer(erg)) throw new Error('Das Ergebnis ist leer — Vorgang abgebrochen.');
    if (volumen(erg) >= volumen(basis)) {
      throw new Error('Die Öffnung würde das Modell beschädigen — wähle eine Fläche auf der Aussenseite.');
    }
    return manifoldZuMesh(erg);
  } finally {
    basis.delete();
    if (messer) messer.delete();
    if (probe) probe.delete();
    if (schnitt) schnitt.delete();
    if (erg) erg.delete();
  }
}

// Zerlegt eine Dreieck-Suppe (auch nicht-wasserdicht) in Zusammenhangs-
// komponenten. Eckpunkte mit exakt gleichen Koordinaten gelten als derselbe
// Punkt (STL dupliziert Eckpunkte pro Dreieck mit identischen Werten);
// Union-Find verbindet Dreiecke ueber geteilte Punkte.
export function trenneMesh(vertProperties, triVerts) {
  const anzahlVerts = vertProperties.length / 3;
  const schluessel = new Map();
  const punktId = new Int32Array(anzahlVerts);
  for (let v = 0; v < anzahlVerts; v++) {
    const k = vertProperties[3 * v] + ',' + vertProperties[3 * v + 1] + ',' + vertProperties[3 * v + 2];
    let id = schluessel.get(k);
    if (id === undefined) { id = schluessel.size; schluessel.set(k, id); }
    punktId[v] = id;
  }
  const eltern = new Int32Array(schluessel.size);
  for (let i = 0; i < eltern.length; i++) eltern[i] = i;
  function wurzel(a) {
    while (eltern[a] !== a) { eltern[a] = eltern[eltern[a]]; a = eltern[a]; }
    return a;
  }
  function verbinde(a, b) {
    a = wurzel(a); b = wurzel(b);
    if (a !== b) eltern[b] = a;
  }
  const anzahlTris = triVerts.length / 3;
  for (let t = 0; t < anzahlTris; t++) {
    verbinde(punktId[triVerts[3 * t]], punktId[triVerts[3 * t + 1]]);
    verbinde(punktId[triVerts[3 * t]], punktId[triVerts[3 * t + 2]]);
  }
  const gruppen = new Map();
  for (let t = 0; t < anzahlTris; t++) {
    const w = wurzel(punktId[triVerts[3 * t]]);
    let liste = gruppen.get(w);
    if (!liste) { liste = []; gruppen.set(w, liste); }
    liste.push(t);
  }
  const teile = [];
  for (const tris of gruppen.values()) {
    // Suppe pro Komponente neu aufbauen (Eckpunkte dupliziert wie im STL);
    // pruefeAsset/merge verschweisst spaeter bei Bedarf wieder.
    const vp = new Float32Array(tris.length * 9);
    const tv = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      for (let e = 0; e < 3; e++) {
        const v = triVerts[3 * tris[i] + e];
        vp[9 * i + 3 * e] = vertProperties[3 * v];
        vp[9 * i + 3 * e + 1] = vertProperties[3 * v + 1];
        vp[9 * i + 3 * e + 2] = vertProperties[3 * v + 2];
        tv[3 * i + e] = 3 * i + e;
      }
    }
    teile.push({ vertProperties: vp, triVerts: tv });
  }
  return teile;
}

// Wendet eine Mat4 (Spaltenkonvention wie matAusTransform) auf ein
// vertProperties-Array an. Nur fuer den Suppen-Zweig von trenneKnoten;
// die Manifold-Zweige transformieren ueber knotenZuManifold.
function transformiereSuppe(vp, m) {
  const out = new Float32Array(vp.length);
  for (let i = 0; i < vp.length; i += 3) {
    const x = vp[i], y = vp[i + 1], z = vp[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

// Trennt einen Knoten in seine unabhaengigen (nicht verbundenen) Teile,
// in Weltkoordinaten. Wasserdichte Knoten (Primitive, Gruppen, wasserdichte
// Importe) laufen ueber Manifold decompose(); nicht-wasserdichte Importe
// ueber trenneMesh, jedes Teil bekommt per pruefeAsset sein eigenes
// wasserdicht-Flag (intakte Shells in kaputten Dateien werden so einzeln
// verrechenbar). Weniger als 2 Teile heisst: nichts zu trennen.
export function trenneKnoten(M, knoten, assets) {
  if (knoten.typ === 'import') {
    const asset = assets && assets[knoten.params.assetId];
    if (!asset) throw new Error('Importiertes Modell nicht gefunden');
    if (!asset.wasserdicht) {
      const welt = transformiereSuppe(asset.vertProperties, matAusTransform(knoten.transform));
      return trenneMesh(welt, asset.triVerts).map((t) => {
        const p = pruefeAsset(M, t.vertProperties, t.triVerts);
        return { vertProperties: t.vertProperties, triVerts: t.triVerts, wasserdicht: p.wasserdicht };
      });
    }
  }
  const basis = knotenZuManifold(M, knoten, false, assets);
  if (!basis) throw new Error('Das Objekt ist leer.');
  const teile = [];
  for (const stueck of basis.decompose()) {
    if (istLeer(stueck)) { stueck.delete(); continue; }
    const mesh = manifoldZuMesh(stueck);
    stueck.delete();
    teile.push({ vertProperties: mesh.vertProperties, triVerts: mesh.triVerts, wasserdicht: true });
  }
  basis.delete();
  return teile;
}

export function manifoldZuMesh(m) {
  const mesh = m.getMesh();
  return { vertProperties: mesh.vertProperties, triVerts: mesh.triVerts };
}

#!/usr/bin/env node
/*
 * Headless-Test fuer die Bereichs-Auswahl (partielles Aufdicken/Abtragen).
 * Teil 1: erweitereDreiecke (Kanten-Adjazenz-Ring) in flaechen.js.
 * Teil 2: offsetBereich im CSG-Kern -- Volumen-Gegenproben am Wuerfel,
 * dessen Deckflaeche als Bereich dient.
 * Lauf:  node tests/klotzwerk.bereich.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

const DATA = path.join(__dirname, '../src');
const F = require(path.join(DATA, './flaechen.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}
function etwaProzent(a, b, p) { return Math.abs(a - b) <= Math.abs(b) * p; }

console.log('erweitereDreiecke (Ring ueber Kanten-Adjazenz):');
{
  // 2x2-Grid aus 4 Dreiecken: t0=(0,1,4) t1=(0,4,3) t2=(1,2,5) t3=(1,5,4)
  // Kanten: t0-t1 teilen 0-4, t0-t3 teilen 1-4, t2-t3 teilen 1-5
  const T = new Uint32Array([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  const r1 = F.erweitereDreiecke(T, [1]);
  check('ein Ring: Kanten-Nachbar kommt dazu', JSON.stringify(r1) === '[0,1]', JSON.stringify(r1));
  const r2 = F.erweitereDreiecke(T, r1);
  check('zweiter Ring', JSON.stringify(r2) === '[0,1,3]', JSON.stringify(r2));
  const r3 = F.erweitereDreiecke(T, r2);
  check('dritter Ring erreicht alle', JSON.stringify(r3) === '[0,1,2,3]', JSON.stringify(r3));
  const eingabe = [1];
  F.erweitereDreiecke(T, eingabe);
  check('Eingabe nicht mutiert', JSON.stringify(eingabe) === '[1]');
  check('leere Auswahl bleibt leer', F.erweitereDreiecke(T, []).length === 0);
}

(async () => {
  const kern = await import(pathToFileURL(path.join(DATA, './esm/csg-kern.js')));
  const mod = await import(pathToFileURL(path.join(__dirname, '../vendor/manifold-3d/manifold.js')));
  const M = await mod.default();
  M.setup();

  function knoten(typ, params) {
    return { id: 'k1', typ: typ, params: params,
             transform: { position: [0, 0, 0], rotation: [0, 0, 0], skalierung: [1, 1, 1] },
             istLoch: false };
  }
  function meshVolumen(t) {
    const mesh = new M.Mesh({ numProp: 3, vertProperties: t.vertProperties, triVerts: t.triVerts });
    mesh.merge();
    const m = new M.Manifold(mesh);
    const v = kern.volumen(m);
    m.delete();
    return v;
  }
  // Deckflaechen-Dreiecke des Wuerfels (alle drei Vertices auf z = zMax)
  function deckel(t, zMax) {
    const V = t.vertProperties, T = t.triVerts, erg = [];
    for (let i = 0; i < T.length / 3; i++) {
      let oben = true;
      for (let e = 0; e < 3; e++) {
        if (Math.abs(V[T[i * 3 + e] * 3 + 2] - zMax) > 1e-6) oben = false;
      }
      if (oben) erg.push(i);
    }
    return erg;
  }

  console.log('offsetBereich am Wuerfel 20 (Deckflaeche als Bereich):');
  {
    // Dieselbe Geometrie wie der 'mesh'-Befehl des Workers (Indizes muessen passen)
    const basisMesh = kern.manifoldZuMesh(kern.knotenZuManifold(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), true, {}));
    const oben = deckel(basisMesh, 20);   // Quader steht mit Boden auf z=0? BBox pruefen ueber beide Kandidaten
    const obenAlt = deckel(basisMesh, 10);
    const patch = oben.length ? oben : obenAlt;
    check('Deckflaeche gefunden (2 Dreiecke)', patch.length === 2, 'ist ' + patch.length);

    const dick = kern.offsetBereich(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), patch, 'aussen', 2, {});
    const vDick = meshVolumen(dick);
    check('Bereich aufgedickt: +20x20x2', etwaProzent(vDick, 8800, 0.03), vDick.toFixed(0) + ' soll ~8800');

    const duenn = kern.offsetBereich(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), patch, 'abtragen', 2, {});
    const vDuenn = meshVolumen(duenn);
    check('Bereich abgetragen: -20x20x2', etwaProzent(vDuenn, 7200, 0.03), vDuenn.toFixed(0) + ' soll ~7200');
  }

  console.log('offsetBereich am Import mit Transform (Browser-Kette):');
  {
    // Ein Objekt mit eigenem Transform: die Dreiecks-Indizes stammen aus der
    // Anzeige (Objektraum), das Ergebnis muss aber in WELT-Koordinaten kommen
    // (gleiche Konvention wie offsetKoerper -- ersetzeDurchErgebnis verlaesst
    // sich darauf). Nachgestellt wie im Browser: zentriertes Asset + Position.
    const IO = require(path.join(DATA, './io.js'));
    const D = require(path.join(DATA, './dokument.js'));
    const basisMesh = kern.manifoldZuMesh(kern.knotenZuManifold(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), true, {}));
    const patch0 = deckel(basisMesh, 20);
    const dick = kern.offsetBereich(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), patch0, 'aussen', 2, {});
    const mitte = IO.bboxMitte(dick.vertProperties);
    const zentriert = IO.transformiereVertices(dick.vertProperties, D.matAusTransform({
      position: [-mitte[0], -mitte[1], -mitte[2]], rotation: [0, 0, 0], skalierung: [1, 1, 1] }));
    const assets = { a1: { vertProperties: zentriert, triVerts: dick.triVerts, wasserdicht: true, name: 'x' } };
    const importKnoten = { id: 'k2', typ: 'import', params: { assetId: 'a1', wasserdicht: true },
      transform: { position: mitte, rotation: [0, 0, 0], skalierung: [1, 1, 1] }, istLoch: false };
    // Anzeige-Triangulierung (Objektraum): Deckflaeche liegt dort bei zMax
    const anzeige = kern.manifoldZuMesh(kern.knotenZuManifold(M, importKnoten, true, assets));
    let zMaxObj = -Infinity;
    for (let i = 2; i < anzeige.vertProperties.length; i += 3) zMaxObj = Math.max(zMaxObj, anzeige.vertProperties[i]);
    const deckImp = deckel(anzeige, zMaxObj);
    check('Deckflaeche am Import gefunden', deckImp.length === 2, 'ist ' + deckImp.length);
    const erg = kern.offsetBereich(M, importKnoten, deckImp, 'abtragen', 2, assets);
    let zMax = -Infinity, zMin = Infinity;
    for (let i = 2; i < erg.vertProperties.length; i += 3) {
      zMax = Math.max(zMax, erg.vertProperties[i]); zMin = Math.min(zMin, erg.vertProperties[i]);
    }
    check('Ergebnis in Weltkoordinaten: z 0..20', Math.abs(zMin) < 0.01 && Math.abs(zMax - 20) < 0.01,
      'z ' + zMin.toFixed(2) + '..' + zMax.toFixed(2));
    const v = meshVolumen(erg);
    check('Volumen: 22er-Turm minus Deck-Abtrag', etwaProzent(v, 8000, 0.03), v.toFixed(0) + ' soll ~8000');
  }

  console.log('offsetBereich Extrusions-Modus (normalen vs. gerade):');
  {
    // Patch ueber eine Kante: Deckflaeche + Seitenflaeche y=-10. Der Form
    // folgend (Normalen) erreicht der Deckel z=22; geradlinig zeigt die
    // gemeinsame Mittelrichtung (0,-1,1)/sqrt2 -- der Deckel endet bei
    // 20 + 2/sqrt2 und die Seite waechst um 2/sqrt2 nach -y.
    const basisMesh = kern.manifoldZuMesh(kern.knotenZuManifold(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), true, {}));
    const V = basisMesh.vertProperties, T = basisMesh.triVerts;
    const patch = [];
    for (let i = 0; i < T.length / 3; i++) {
      let deck = true, seite = true;
      for (let e = 0; e < 3; e++) {
        if (Math.abs(V[T[i * 3 + e] * 3 + 2] - 20) > 1e-6) deck = false;
        if (Math.abs(V[T[i * 3 + e] * 3 + 1] + 10) > 1e-6) seite = false;
      }
      if (deck || seite) patch.push(i);
    }
    check('Patch Deck+Seite = 4 Dreiecke', patch.length === 4, 'ist ' + patch.length);
    function bbox(t) {
      let zMax = -Infinity, yMin = Infinity, yMax = -Infinity, xMax = -Infinity;
      for (let i = 0; i < t.vertProperties.length; i += 3) {
        xMax = Math.max(xMax, t.vertProperties[i]);
        yMin = Math.min(yMin, t.vertProperties[i + 1]);
        yMax = Math.max(yMax, t.vertProperties[i + 1]);
        zMax = Math.max(zMax, t.vertProperties[i + 2]);
      }
      return { yMin, yMax, xMax, zMax };
    }
    const mitNormalen = kern.offsetBereich(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), patch, 'aussen', 2, {}, 'normalen');
    const bn = bbox(mitNormalen);
    check('normalen: Deckel erreicht z=22', Math.abs(bn.zMax - 22) < 0.01, 'zMax ' + bn.zMax.toFixed(2));
    const gerade = kern.offsetBereich(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), patch, 'aussen', 2, {}, 'gerade');
    const bg = bbox(gerade);
    const wurzel = 2 / Math.SQRT2;
    check('gerade: Deckel endet bei 20 + 2/sqrt2', Math.abs(bg.zMax - (20 + wurzel)) < 0.01, 'zMax ' + bg.zMax.toFixed(2));
    check('gerade: Seite waechst um 2/sqrt2 nach -y', Math.abs(bg.yMin - (-10 - wurzel)) < 0.01, 'yMin ' + bg.yMin.toFixed(2));
    // Kein eps-Grat auf den NICHT gewaehlten Seiten: der Ueberlapp-Boden
    // darf an den Patch-Raendern nicht aus der Basis ragen
    check('gerade: kein Grat an der Rueckseite (yMax bleibt 10)', bg.yMax < 10.01, 'yMax ' + bg.yMax.toFixed(3));
    check('gerade: kein Grat seitlich (xMax bleibt 10)', bg.xMax < 10.01, 'xMax ' + bg.xMax.toFixed(3));
  }

  console.log('offsetBereich Fehlerfaelle:');
  {
    try {
      kern.offsetBereich(M, knoten('quader', { breite: 20, tiefe: 20, hoehe: 20 }), [], 'aussen', 2, {});
      check('leerer Bereich wirft', false, 'kein Fehler');
    } catch (e) {
      check('leerer Bereich wirft', String(e.message).length > 0);
    }
  }

  console.log(failures === 0 ? 'Alle Bereich-Tests ok.' : failures + ' Test(s) fehlgeschlagen.');
  process.exit(failures === 0 ? 0 : 1);
})();

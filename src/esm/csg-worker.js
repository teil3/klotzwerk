/*
 * Modul-Worker: einzige Stelle, an der manifold-3d im Browser laeuft.
 * Buffers werden transferiert, nicht kopiert. Die Asset-Registry haelt
 * importierte STL-Geometrie fuer 'mesh'-Anfragen (Gruppen/Export).
 */
import ManifoldModule from '../../vendor/manifold-3d/manifold.js';
import { knotenZuManifold, manifoldZuMesh, pruefeAsset, schneideKnotenMehrfach, offsetKoerper, trenneKnoten, bohreKanal, oeffneFlaeche, streckeKnoten, streckenVorschau } from './csg-kern.js';

let M = null;
const assets = {};   // assetId -> {vertProperties, triVerts, wasserdicht, name}

self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.befehl === 'init') {
      try {
        M = await ManifoldModule({ locateFile: () => d.wasmUrl });
        M.setup();
        self.postMessage({ befehl: 'bereit' });
      } catch (err) {
        self.postMessage({ befehl: 'initFehler', meldung: String((err && err.message) || err) });
      }
      return;
    }
    if (d.befehl === 'asset') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const erg = pruefeAsset(M, d.vertProperties, d.triVerts);
      assets[d.assetId] = { vertProperties: d.vertProperties, triVerts: d.triVerts,
                            wasserdicht: erg.wasserdicht, name: d.name };
      self.postMessage({ befehl: 'assetErgebnis', anfrageId: d.anfrageId,
                         wasserdicht: erg.wasserdicht, dreiecke: erg.dreiecke });
      return;
    }
    if (d.befehl === 'assetsLoeschen') {
      Object.keys(assets).forEach((k) => { delete assets[k]; });
      return;
    }
    if (d.befehl === 'mesh') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const m = knotenZuManifold(M, d.knoten, true, assets);
      if (!m) {
        self.postMessage({ befehl: 'meshErgebnis', anfrageId: d.anfrageId, leer: true });
        return;
      }
      const mesh = manifoldZuMesh(m);
      m.delete();
      self.postMessage(
        { befehl: 'meshErgebnis', anfrageId: d.anfrageId, leer: false,
          vertProperties: mesh.vertProperties, triVerts: mesh.triVerts },
        [mesh.vertProperties.buffer, mesh.triVerts.buffer]
      );
      return;
    }
    if (d.befehl === 'schneiden') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const teile = schneideKnotenMehrfach(M, d.knoten, d.ebenen, assets);
      const transfer = [];
      teile.forEach((t) => { transfer.push(t.vertProperties.buffer, t.triVerts.buffer); });
      self.postMessage({ befehl: 'schnittErgebnis', anfrageId: d.anfrageId, teile: teile }, transfer);
      return;
    }
    if (d.befehl === 'offsetKoerper') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const t = offsetKoerper(M, d.knoten, d.richtung, d.wandstaerke, assets);
      self.postMessage(
        { befehl: 'offsetErgebnis', anfrageId: d.anfrageId,
          vertProperties: t.vertProperties, triVerts: t.triVerts },
        [t.vertProperties.buffer, t.triVerts.buffer]
      );
      return;
    }
    if (d.befehl === 'bohreKanal') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const t = bohreKanal(M, d.knoten, d.punkt, d.normale, d.tiefe, d.marge, d.durchmesser, assets);
      self.postMessage(
        { befehl: 'kanalErgebnis', anfrageId: d.anfrageId,
          vertProperties: t.vertProperties, triVerts: t.triVerts },
        [t.vertProperties.buffer, t.triVerts.buffer]);
      return;
    }
    if (d.befehl === 'oeffneFlaeche') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const t = oeffneFlaeche(M, d.knoten, d.dreiecke, d.normale, d.tiefe, d.marge, assets);
      // Antwortet wie bohreKanal ('kanalErgebnis') -- die UI behandelt beide
      // Oeffnungs-Formen identisch (Mesh ersetzt das Objekt).
      self.postMessage(
        { befehl: 'kanalErgebnis', anfrageId: d.anfrageId,
          vertProperties: t.vertProperties, triVerts: t.triVerts },
        [t.vertProperties.buffer, t.triVerts.buffer]);
      return;
    }
    if (d.befehl === 'strecken') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const t = streckeKnoten(M, d.knoten, d.normal, d.offset, d.breite, assets);
      // Antwortet wie bohreKanal ('kanalErgebnis') -- die UI ersetzt das
      // Objekt durch das Ergebnis-Mesh, gleicher Pfad.
      self.postMessage(
        { befehl: 'kanalErgebnis', anfrageId: d.anfrageId,
          vertProperties: t.vertProperties, triVerts: t.triVerts },
        [t.vertProperties.buffer, t.triVerts.buffer]);
      return;
    }
    if (d.befehl === 'streckenVorschau') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const v = streckenVorschau(M, d.knoten, d.normal, d.offset, assets);
      self.postMessage(
        { befehl: 'streckenVorschauErgebnis', anfrageId: d.anfrageId,
          teilA: v.teilA, teilB: v.teilB, mitte: v.mitte },
        [v.teilA.vertProperties.buffer, v.teilA.triVerts.buffer,
         v.teilB.vertProperties.buffer, v.teilB.triVerts.buffer,
         v.mitte.vertProperties.buffer, v.mitte.triVerts.buffer]);
      return;
    }
    if (d.befehl === 'auftrennen') {
      if (!M) throw new Error('Engine nicht initialisiert');
      const teile = trenneKnoten(M, d.knoten, assets);
      const transfer = [];
      teile.forEach((t) => { transfer.push(t.vertProperties.buffer, t.triVerts.buffer); });
      self.postMessage({ befehl: 'trennErgebnis', anfrageId: d.anfrageId, teile: teile }, transfer);
      return;
    }
  } catch (err) {
    self.postMessage({ befehl: 'fehler', anfrageId: d.anfrageId, meldung: String((err && err.message) || err) });
  }
};

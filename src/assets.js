/*
 * Asset-Store des 3D-Konstruktors: importierte STL-Geometrie liegt einmal
 * hier, das Dokument (und die Undo-Snapshots) referenzieren nur die assetId.
 * In-Memory-Teil laeuft auch in Node-Tests; IndexedDB nur im Browser
 * (localStorage-Limit ~5 MB reicht fuer STL-Daten nicht).
 */
(function () {
  'use strict';

  var DB_NAME = 't3-3dkonstruktor';
  var STORE = 'assets';

  var speicher = {};   // assetId -> {vertProperties, triVerts, wasserdicht, name}
  var naechste = 1;

  function neueAssetId() {
    while (speicher['a' + naechste]) naechste++;
    return 'a' + (naechste++);
  }
  function registriere(id, daten) { speicher[id] = daten; }
  function hole(id) { return speicher[id] || null; }
  function alleIds() { return Object.keys(speicher); }
  function loescheAlle() { speicher = {}; naechste = 1; }
  function loesche(id) { delete speicher[id]; }

  function oeffneDb() {
    return new Promise(function (resolve, reject) {
      var req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Speicher nicht verfügbar')); };
    });
  }

  function mitStore(modus, arbeit) {
    return oeffneDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, modus);
        var erg = arbeit(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(erg); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('Speicher voll')); };
      });
    });
  }

  function speichereInDb(id) {
    return mitStore('readwrite', function (store) { store.put(speicher[id], id); });
  }

  function ladeAlleAusDb() {
    return mitStore('readonly', function (store) {
      var req = store.openCursor();
      req.onsuccess = function () {
        var cursor = req.result;
        if (!cursor) return;
        registriere(String(cursor.key), cursor.value);
        cursor.continue();
      };
    });
  }

  function loescheDb() {
    return mitStore('readwrite', function (store) { store.clear(); });
  }

  function loescheInDb(id) {
    return mitStore('readwrite', function (store) { store.delete(id); });
  }

  var api = {
    neueAssetId: neueAssetId, registriere: registriere, hole: hole,
    alleIds: alleIds, loescheAlle: loescheAlle, loesche: loesche,
    speichereInDb: speichereInDb, ladeAlleAusDb: ladeAlleAusDb, loescheDb: loescheDb,
    loescheInDb: loescheInDb
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.T3KAssets = api; }
})();

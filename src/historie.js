/*
 * Undo/Redo ueber tiefe JSON-Snapshots des Dokuments (reine Daten).
 * Browser: window.KlotzwerkHistorie, Node: require().
 */
(function () {
  'use strict';

  var LIMIT = 50;

  function kopie(dok) { return JSON.parse(JSON.stringify(dok)); }

  function neueHistorie(dok) {
    return { vergangenheit: [], aktuell: kopie(dok), zukunft: [] };
  }

  function merke(h, dok) {
    h.vergangenheit.push(h.aktuell);
    if (h.vergangenheit.length > LIMIT) h.vergangenheit.shift();
    h.aktuell = kopie(dok);
    h.zukunft = [];
  }

  function rueckgaengig(h) {
    if (h.vergangenheit.length === 0) return null;
    h.zukunft.push(h.aktuell);
    h.aktuell = h.vergangenheit.pop();
    return kopie(h.aktuell);
  }

  function wiederholen(h) {
    if (h.zukunft.length === 0) return null;
    h.vergangenheit.push(h.aktuell);
    h.aktuell = h.zukunft.pop();
    return kopie(h.aktuell);
  }

  function kannRueckgaengig(h) { return h.vergangenheit.length > 0; }
  function kannWiederholen(h) { return h.zukunft.length > 0; }

  var api = {
    neueHistorie: neueHistorie, merke: merke,
    rueckgaengig: rueckgaengig, wiederholen: wiederholen,
    kannRueckgaengig: kannRueckgaengig, kannWiederholen: kannWiederholen
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.KlotzwerkHistorie = api; }
})();

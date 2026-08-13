# Klotzwerk

Browser-based 3D CAD tool for combining solid primitives into printable models — no install, no build step.

## Features

- Primitives: box, cylinder, sphere, cone, pyramid, torus, pipe
- Move, rotate, and scale with a gizmo and snapping grid
- Boolean operations: union, subtract, intersection, drill holes
- Grouping/ungrouping, hollowing, thickening and its inverse ("Abtragen": shrink by offset), face-to-face alignment ("Anlegen")
- Measure & scale to size ("Massstab"): pick two vertices, read the distance, enter a target length — the object scales proportionally
- Configurable build plate: size, grid spacing, and colors in a settings popover; visibility toggle below the home button
- Box select: drag a 2D frame to select everything fully inside it; shift-drag adds another frame
- Drag & drop import onto the import button
- Undo/redo
- Autosave to IndexedDB — nothing is uploaded, the project stays in the browser
- Import: STL, OBJ, 3MF
- Export: STL, OBJ, 3MF

Computation runs in a module worker on top of [manifold-3d](https://github.com/elalish/manifold) (WebAssembly); rendering uses three.js r124. No framework, no bundler — plain script tags.

## Live Demo

https://teil3.github.io/klotzwerk/

Klotzwerk in production, integrated with a print-ordering workflow (the
`KLOTZWERK_AKTIONEN` hook described below):
[teil3.ch — 3D-Modelle online erstellen](https://www.teil3.ch/3d-modelle-online-erstellen.html)

## Quickstart

```bash
git clone https://github.com/teil3/klotzwerk.git
cd klotzwerk
python3 serve.py
```

Then open `http://localhost:8000/`.

`serve.py` is a plain `http.server` that adds `Cache-Control: no-store` — without it, Chrome's heuristic caching can keep serving a stale CSG worker (ES modules are not reliably refreshed even by a hard reload).

## Embedding

Klotzwerk has no build step. To embed it in another page, copy the script-tag sequence and markup scaffold from `index.html` — the load order matters (three.js and its controls first, then the `src/*.js` modules). All script tags need `defer`: `src/ui.js` wires up the DOM (`document.currentScript`, button listeners) and relies on `defer` preserving load order while letting the page parse first.

```html
<script src="vendor/three.js-r124/three.min.js" defer></script>
<script src="vendor/three.js-r124/controls/OrbitControls.js" defer></script>
<script src="vendor/three.js-r124/controls/TransformControls.js" defer></script>
<script src="src/dokument.js" defer></script>
<script src="src/flaechen.js" defer></script>
<script src="src/schnitt.js" defer></script>
<script src="src/messen.js" defer></script>
<script src="src/auswahl.js" defer></script>
<script src="src/gitter.js" defer></script>
<script src="src/historie.js" defer></script>
<script src="src/assets.js" defer></script>
<script src="src/io.js" defer></script>
<script src="src/navwuerfel.js" defer></script>
<script src="src/viewport.js" defer></script>
<script src="src/ui.js" defer></script>
```

### Public API

`window.Klotzwerk.exportiereSTL(callback)` computes the current model and hands the result back as an `ArrayBuffer`:

```js
window.Klotzwerk.exportiereSTL(function (stlArrayBuffer) {
  // stlArrayBuffer is ready to upload, save, or hand off
});
```

### Custom actions (`KLOTZWERK_AKTIONEN`)

Define `window.KLOTZWERK_AKTIONEN` *before* `src/ui.js` runs to add buttons next to the built-in download button — this is how teil3.ch wires Klotzwerk into its shopping basket:

```js
window.KLOTZWERK_AKTIONEN = [
  {
    label: 'In den Warenkorb',
    ausfuehren: function (stlArrayBuffer, fertig) {
      fetch('/basket/add', { method: 'POST', body: stlArrayBuffer })
        .then(function () { fertig(null); })
        .catch(function (err) { fertig(err.message); });
    }
  }
];
```

Each action's `ausfuehren(stlArrayBuffer, fertig)` is called with the exported STL. Call `fertig(null)` on success, or `fertig('error message')` to show the message in Klotzwerk's status bar.

## Language

Code identifiers and the UI are in German — this is a deliberate choice by the maintainers (Teil3 GmbH, a Zurich-based 3D printing shop), not an oversight. Function and variable names, comments, and all user-facing text follow German naming throughout the codebase.

## Development

```bash
npm test
```

Runs the Node test suites under `tests/` (`for f in tests/*.test.js; do node "$f"; done`) — no test framework dependency, each file is a self-contained script.

## License

Klotzwerk's own code is licensed under [Apache-2.0](LICENSE), © 2026 Teil3 GmbH.

Bundled third-party components (three.js, manifold-3d) keep their own licenses — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

## Über Klotzwerk (Deutsch)

Klotzwerk ist ein browserbasiertes 3D-CAD-Werkzeug von Teil3 GmbH (3D-Druckerei in Zürich): Grundkörper wie Quader, Zylinder oder Kugel werden platziert, verschoben, rotiert, skaliert und über boolesche Operationen (vereinigen, abziehen, Löcher bohren) zu druckbaren Modellen kombiniert. Es läuft vollständig im Browser, ohne Build-Schritt und ohne Server — der Rechenkern basiert auf manifold-3d (WebAssembly) in einem Worker, die Darstellung auf three.js. Der Code und die Bedienoberfläche sind bewusst auf Deutsch gehalten. Über den `KLOTZWERK_AKTIONEN`-Hook lässt sich das exportierte STL in eigene Abläufe einbinden, etwa in einen Warenkorb.

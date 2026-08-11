#!/usr/bin/env node
/*
 * Headless-Test der Scrollrad-Zoom-Mathematik (Zoom zum Mauszeiger wie
 * Onshape/Tinkercad) gegen das vendorierte three.js r124. viewport.js ist
 * in Node nicht ladbar (DOM/WebGL) -- der Test rechnet dieselben Formeln
 * wie zoomZumZeiger nach und prueft die Invariante: der Weltpunkt unter
 * dem Zeiger bleibt nach dem Zoom auf demselben Bildschirmpunkt.
 * Lauf:  node tests/generators/3d-konstruktor.zoom.test.js
 */
const path = require('path');
const THREE = require(path.join(__dirname,
  '../vendor/three.js-r124/three.min.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}

function ndcVon(kamera, punkt) {
  return punkt.clone().project(kamera);
}

console.log('Perspektive: Skalierung um P haelt den Cursor-Punkt fest:');
{
  [[0.4, 0.3], [-0.7, 0.55], [0, 0]].forEach(function (m) {
    const kamera = new THREE.PerspectiveCamera(45, 1.3, 0.1, 5000);
    kamera.up.set(0, 0, 1);
    kamera.position.set(140, -160, 120);
    const target = new THREE.Vector3(10, 5, 20);
    kamera.lookAt(target);
    kamera.updateMatrixWorld(true);
    // P = Treffpunkt des Maus-Strahls (hier: beliebiger Punkt darauf)
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(m[0], m[1]), kamera);
    const P = ray.ray.at(180, new THREE.Vector3());
    const vorher = ndcVon(kamera, P);
    // 5 Zoom-Schritte rein, dann 3 raus (Formel aus zoomZumZeiger)
    [0.9, 0.9, 0.9, 0.9, 0.9, 1 / 0.9, 1 / 0.9, 1 / 0.9].forEach(function (s) {
      kamera.position.sub(P).multiplyScalar(s).add(P);
      target.sub(P).multiplyScalar(s).add(P);
      kamera.lookAt(target);
      kamera.updateMatrixWorld(true);
    });
    const nachher = ndcVon(kamera, P);
    check('NDC stabil bei Maus (' + m.join(',') + ')',
      Math.abs(nachher.x - vorher.x) < 1e-6 && Math.abs(nachher.y - vorher.y) < 1e-6,
      'vorher ' + vorher.x.toFixed(5) + ',' + vorher.y.toFixed(5) +
      ' nachher ' + nachher.x.toFixed(5) + ',' + nachher.y.toFixed(5));
  });
}

console.log('Parallel: Zoom-Faktor + Lateral-Shift haelt den Cursor-Punkt fest:');
{
  [[0.4, 0.3], [-0.7, 0.55]].forEach(function (m) {
    const kamera = new THREE.OrthographicCamera(-130, 130, 100, -100, 0.1, 5000);
    kamera.up.set(0, 0, 1);
    kamera.zoom = 1.4;
    kamera.updateProjectionMatrix();
    const target = new THREE.Vector3(10, 5, 20);
    kamera.position.copy(target).add(new THREE.Vector3(0.5, -0.6, 0.4).normalize().multiplyScalar(2000));
    kamera.lookAt(target);
    kamera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(m[0], m[1]), kamera);
    const P = ray.ray.at(1900, new THREE.Vector3());
    const vorher = ndcVon(kamera, P);
    [0.9, 0.9, 1 / 0.9].forEach(function (s) {
      kamera.zoom = kamera.zoom / s;
      kamera.updateProjectionMatrix();
      // Lateraler Anteil von (P - Kameraposition), Shift um (1 - s)
      const dir = target.clone().sub(kamera.position).normalize();
      const v = P.clone().sub(kamera.position);
      const l = v.sub(dir.multiplyScalar(v.dot(dir)));
      const shift = l.multiplyScalar(1 - s);
      kamera.position.add(shift);
      target.add(shift);
      kamera.lookAt(target);
      kamera.updateMatrixWorld(true);
    });
    const nachher = ndcVon(kamera, P);
    check('NDC stabil bei Maus (' + m.join(',') + ')',
      Math.abs(nachher.x - vorher.x) < 1e-6 && Math.abs(nachher.y - vorher.y) < 1e-6,
      'vorher ' + vorher.x.toFixed(5) + ',' + vorher.y.toFixed(5) +
      ' nachher ' + nachher.x.toFixed(5) + ',' + nachher.y.toFixed(5));
  });
}

console.log('Perspektive: Blickrichtung bleibt erhalten (Orbit-Stabilitaet):');
{
  const kamera = new THREE.PerspectiveCamera(45, 1.3, 0.1, 5000);
  kamera.up.set(0, 0, 1);
  kamera.position.set(140, -160, 120);
  const target = new THREE.Vector3(10, 5, 20);
  const dirVorher = target.clone().sub(kamera.position).normalize();
  const P = new THREE.Vector3(30, 40, 10);
  const s = 0.9;
  kamera.position.sub(P).multiplyScalar(s).add(P);
  target.sub(P).multiplyScalar(s).add(P);
  const dirNachher = target.clone().sub(kamera.position).normalize();
  check('Richtung unveraendert', dirNachher.distanceTo(dirVorher) < 1e-9);
}

// --- Heim-Ansicht (Fit-to-View): gleiche Formeln wie heimAnsicht ----------

function eckenNdc(kamera, box) {
  const ecken = [];
  [box.min.x, box.max.x].forEach(function (x) {
    [box.min.y, box.max.y].forEach(function (y) {
      [box.min.z, box.max.z].forEach(function (z) {
        ecken.push(new THREE.Vector3(x, y, z).project(kamera));
      });
    });
  });
  return ecken;
}

console.log('Heim-Ansicht Perspektive: BBox passt komplett ins Bild:');
{
  const FOV_HALB_TAN = Math.tan(45 * Math.PI / 360);
  [[1.3, new THREE.Box3(new THREE.Vector3(-30, -10, 0), new THREE.Vector3(50, 40, 25))],
   [0.6, new THREE.Box3(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 90))]].forEach(function (fall) {
    const aspect = fall[0], box = fall[1];
    const kamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 5000);
    kamera.up.set(0, 0, 1);
    const richtung = new THREE.Vector3(120, -160, 110).normalize();
    const zentrum = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const dist = (radius * 1.2) / Math.min(FOV_HALB_TAN, FOV_HALB_TAN * aspect);
    kamera.position.copy(zentrum).addScaledVector(richtung, dist);
    kamera.lookAt(zentrum);
    kamera.updateMatrixWorld(true);
    const ndc = eckenNdc(kamera, box);
    const maxAbw = Math.max.apply(null, ndc.map(function (p) { return Math.max(Math.abs(p.x), Math.abs(p.y)); }));
    check('aspect ' + aspect + ': alles sichtbar, formatfuellend', maxAbw <= 1 && maxAbw > 0.35,
      'max |ndc| = ' + maxAbw.toFixed(3));
  });
}

console.log('Heim-Ansicht Parallel: BBox passt komplett ins Bild:');
{
  const orthoHoehe = 200, aspect = 1.3;
  const box = new THREE.Box3(new THREE.Vector3(-30, -10, 0), new THREE.Vector3(50, 40, 25));
  const zentrum = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const kamera = new THREE.OrthographicCamera(
    -orthoHoehe * aspect / 2, orthoHoehe * aspect / 2, orthoHoehe / 2, -orthoHoehe / 2, 0.1, 5000);
  kamera.up.set(0, 0, 1);
  const richtung = new THREE.Vector3(120, -160, 110).normalize();
  kamera.position.copy(zentrum).addScaledVector(richtung, 2000);
  const zielHoehe = 2 * radius * 1.2;
  kamera.zoom = Math.min(orthoHoehe / zielHoehe, orthoHoehe * aspect / zielHoehe);
  kamera.updateProjectionMatrix();
  kamera.lookAt(zentrum);
  kamera.updateMatrixWorld(true);
  const ndc = eckenNdc(kamera, box);
  const maxAbw = Math.max.apply(null, ndc.map(function (p) { return Math.max(Math.abs(p.x), Math.abs(p.y)); }));
  check('alles sichtbar, formatfuellend', maxAbw <= 1 && maxAbw > 0.35, 'max |ndc| = ' + maxAbw.toFixed(3));
  check('vor der near-Plane', ndc.every(function (p) { return p.z > -1 && p.z < 1; }));
}

console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
process.exit(failures === 0 ? 0 : 1);

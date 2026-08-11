/*
 * Navigationswuerfel (ViewCube) im Tinkercad-Stil fuer den 3D-Konstruktor.
 * Eigene kleine three.js-Szene mit eigenem Renderer, oben links im Viewport.
 * Z ist oben (gleiche Konvention wie viewport.js): OBEN zeigt in +Z, VORNE
 * in -Y (Kamera-Startposition (120,-160,120) schaut von schraeg vorne).
 * Der Wuerfel steht fest und unrotiert im Ursprung -- die NavWuerfel-Kamera
 * schaut aus DERSELBEN Richtung wie die Hauptkamera (gleiche Blickrichtung
 * und Verrollung, nur auf festen Abstand skaliert). So zeigt eine Draufsicht
 * der Hauptkamera automatisch die OBEN-Flaeche, und Drehrichtung/Wuerfel
 * stimmen ueberein (kein Spiegel-/Gegenrichtungs-Effekt wie bei einer
 * Inverse-Quaternion-Konstruktion).
 */
(function () {
  'use strict';

  var GROESSE = 90;
  var GRUND_FARBE = '#f7f7f7';
  var GRUND_FARBE_HOVER = '#e6e6e6';
  var TEXT_FARBE = '#8a8a8a';
  var KANTEN_FARBE = 0xcccccc;

  // Reihenfolge der BoxGeometry-Materialien: +X, -X, +Y, -Y, +Z, -Z
  var RICHTUNGEN = ['rechts', 'links', 'hinten', 'vorne', 'oben', 'unten'];
  var LABELS = {
    rechts: 'RECHTS', links: 'LINKS', hinten: 'HINTEN', vorne: 'VORNE',
    oben: 'OBEN', unten: 'UNTEN'
  };

  // BoxGeometry-Flaechen haben unterschiedliche UV-Rotationen; damit jedes
  // Label in der Face-on-Ansicht aufrecht und von links nach rechts lesbar
  // erscheint, muss der Text pro Flaeche gegen diese Rotation vorgedreht
  // werden. Empirisch im Browser verifiziert (Klick auf jede Flaeche,
  // Face-on-Screenshot geprueft): oben/vorne unrotiert; rechts +90 Grad;
  // links -90 Grad; hinten/unten 180 Grad. Vorzeichen: ctx.rotate() ist im
  // Uhrzeigersinn, wir drehen den Text also GEGEN die beobachtete
  // Flaechenrotation.
  var TEXT_ROTATION = {
    oben: 0, vorne: 0,
    rechts: -Math.PI / 2,
    links: Math.PI / 2,
    hinten: Math.PI, unten: Math.PI
  };

  function texturFuer(richtung, hervorgehoben) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    var ctx = c.getContext('2d');
    ctx.fillStyle = hervorgehoben ? GRUND_FARBE_HOVER : GRUND_FARBE;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.fillStyle = TEXT_FARBE;
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(64, 64);
    ctx.rotate(TEXT_ROTATION[richtung]);
    ctx.fillText(LABELS[richtung], 0, 0);
    var tex = new THREE.CanvasTexture(c);
    return tex;
  }

  function materialFuer(richtung, hervorgehoben) {
    return new THREE.MeshBasicMaterial({ map: texturFuer(richtung, hervorgehoben) });
  }

  function initNavWuerfel(containerElement, hauptKamera, callbacks) {
    var overlay = document.createElement('div');
    overlay.className = 'k3d-navwuerfel';
    containerElement.appendChild(overlay);

    var cnvWrap = document.createElement('div');
    cnvWrap.className = 'k3d-navwuerfel-canvas';
    overlay.appendChild(cnvWrap);

    var szene = new THREE.Scene();
    var nwKamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    nwKamera.up.set(0, 0, 1);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(GROESSE, GROESSE);
    cnvWrap.appendChild(renderer.domElement);

    var licht = new THREE.HemisphereLight(0xffffff, 0x888888, 1.0);
    szene.add(licht);

    var materialien = RICHTUNGEN.map(function (r) { return materialFuer(r, false); });
    var geo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    var wuerfel = new THREE.Mesh(geo, materialien);
    szene.add(wuerfel);

    // Dezente Kanten
    var kantenGeo = new THREE.EdgesGeometry(geo);
    var kanten = new THREE.LineSegments(kantenGeo, new THREE.LineBasicMaterial({ color: KANTEN_FARBE }));
    wuerfel.add(kanten);

    // Kamera-Abstand so waehlen, dass der Wuerfel das Feld gut fuellt
    nwKamera.position.set(0, -3.2, 2.4);
    nwKamera.lookAt(0, 0, 0);
    var abstand = nwKamera.position.length();

    // Hover-Hervorhebung per Raycast
    var ray = new THREE.Raycaster();
    var zeigt = new THREE.Vector2();
    var hoverIdx = -1;

    function setzeHover(idx) {
      if (idx === hoverIdx) return;
      if (hoverIdx >= 0) {
        materialien[hoverIdx].map.dispose();
        materialien[hoverIdx].map = texturFuer(RICHTUNGEN[hoverIdx], false);
      }
      if (idx >= 0) {
        materialien[idx].map.dispose();
        materialien[idx].map = texturFuer(RICHTUNGEN[idx], true);
      }
      hoverIdx = idx;
      cnvWrap.style.cursor = idx >= 0 ? 'pointer' : 'default';
    }

    function trefferAufWuerfel(e) {
      var r = renderer.domElement.getBoundingClientRect();
      zeigt.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      zeigt.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(zeigt, nwKamera);
      var treffer = ray.intersectObject(wuerfel, false);
      return treffer.length ? treffer[0] : null;
    }

    // Klick-Zone aus dem Trefferpunkt: nahe einer Kante oder Ecke werden
    // die angrenzenden Achsen mitgenommen -- der Vektor hat dann 2 (Kante)
    // oder 3 (Ecke) Komponenten und die Ansicht kommt aus dieser Richtung.
    // Der Wuerfel steht unrotiert im Ursprung, Weltkoordinaten = lokal.
    var ZONEN_SCHWELLE = 0.6;   // Anteil der Halbkante, ab dem die Nachbar-Achse zaehlt
    function ansichtsVektor(treffer) {
      var halb = 0.8;
      var p = [treffer.point.x, treffer.point.y, treffer.point.z];
      var v = [0, 0, 0];
      for (var k = 0; k < 3; k++) {
        var u = p[k] / halb;
        if (u > ZONEN_SCHWELLE) v[k] = 1;
        else if (u < -ZONEN_SCHWELLE) v[k] = -1;
      }
      return v;
    }

    // Rollover fuer Kanten- und Ecken-Zonen: 20 normal unsichtbare, minimal
    // ueberstehende Boxen (12 Kanten, 8 Ecken). Beim Hover wird genau die
    // getroffene Zone eingeblendet; die Deckkraft ist so gewaehlt, dass der
    // Grauton dem Flaechen-Hover entspricht (0.08 Schwarz auf #f7f7f7 = ~#e6).
    var zonen = {};
    (function () {
      var innen = ZONEN_SCHWELLE * 0.8;   // Innenkante der Zone (0.48)
      var mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 });
      for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++) {
        if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 2) continue;
        var vz = [x, y, z];
        var groesse = vz.map(function (a) { return a ? (0.82 - innen) : 2 * innen; });
        var mitte = vz.map(function (a) { return a * (innen + 0.82) / 2; });
        var mesh = new THREE.Mesh(new THREE.BoxGeometry(groesse[0], groesse[1], groesse[2]), mat);
        mesh.position.set(mitte[0], mitte[1], mitte[2]);
        mesh.visible = false;
        wuerfel.add(mesh);
        zonen[vz.join(',')] = mesh;
      }
    })();
    var zoneAktiv = null;
    function setzeZone(v) {
      var mesh = (v && zonen[v.join(',')]) || null;
      if (zoneAktiv === mesh) return;
      if (zoneAktiv) zoneAktiv.visible = false;
      if (mesh) mesh.visible = true;
      zoneAktiv = mesh;
    }

    // Drag auf dem Wuerfel dreht die Hauptansicht (wie ein Orbit-Drag);
    // kurzer Klick (< 4px Bewegung) snapt weiterhin auf eine Flaeche.
    var EMPFINDLICHKEIT = 0.01; // rad pro Pixel, aehnlich OrbitControls
    var startXY = null;
    var letztXY = null;
    var amZiehen = false;

    renderer.domElement.addEventListener('pointermove', function (e) {
      if (!startXY) {
        var t = trefferAufWuerfel(e);
        var v = t ? ansichtsVektor(t) : null;
        if (v && Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) > 1) {
          setzeHover(-1);            // Kanten-/Ecken-Zone statt Flaeche
          setzeZone(v);
          cnvWrap.style.cursor = 'pointer';
        } else {
          setzeZone(null);
          setzeHover(t ? t.face.materialIndex : -1);
        }
        return;
      }
      if (!amZiehen && (Math.abs(e.clientX - startXY[0]) > 4 || Math.abs(e.clientY - startXY[1]) > 4)) {
        amZiehen = true;
        setzeHover(-1);
        setzeZone(null);
      }
      if (amZiehen) {
        var dx = e.clientX - letztXY[0];
        var dy = e.clientY - letztXY[1];
        letztXY = [e.clientX, e.clientY];
        if (callbacks && callbacks.beiDrehen) callbacks.beiDrehen(dx * EMPFINDLICHKEIT, dy * EMPFINDLICHKEIT);
      }
    });
    renderer.domElement.addEventListener('pointerleave', function () {
      if (!amZiehen) { setzeHover(-1); setzeZone(null); }
    });

    renderer.domElement.addEventListener('pointerdown', function (e) {
      startXY = [e.clientX, e.clientY];
      letztXY = [e.clientX, e.clientY];
      amZiehen = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    });
    renderer.domElement.addEventListener('pointerup', function (e) {
      renderer.domElement.releasePointerCapture(e.pointerId);
      var warAmZiehen = amZiehen;
      startXY = null;
      letztXY = null;
      amZiehen = false;
      if (warAmZiehen) return; // Drag nicht als Klick werten
      var treffer = trefferAufWuerfel(e);
      if (!treffer) return;
      var v = ansichtsVektor(treffer);
      var komponenten = Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);
      if (komponenten > 1 && callbacks && callbacks.beiAnsichtVektor) {
        callbacks.beiAnsichtVektor(v);   // Kante oder Ecke
      } else if (callbacks && callbacks.beiAnsicht) {
        callbacks.beiAnsicht(RICHTUNGEN[treffer.face.materialIndex]);
      }
    });

    // Wuerfel bleibt unrotiert im Ursprung: die NavWuerfel-Kamera schaut aus
    // DERSELBEN Richtung wie die Hauptkamera (gleiche Blickrichtung + gleiche
    // Verrollung), nur auf festen Abstand versetzt. tmpRichtung wird
    // wiederverwendet, keine Allokation pro Frame.
    var tmpRichtung = new THREE.Vector3();
    function sync() {
      hauptKamera.getWorldDirection(tmpRichtung);
      nwKamera.position.copy(tmpRichtung).multiplyScalar(-abstand);
      nwKamera.quaternion.copy(hauptKamera.quaternion);
      renderer.render(szene, nwKamera);
    }

    // Hauptkamera austauschbar: der Viewport wechselt beim Umschalten der
    // Projektion zwischen Perspective- und Orthographic-Kamera.
    function setzeKamera(k) { if (k) hauptKamera = k; }

    return { sync: sync, setzeKamera: setzeKamera };
  }

  window.T3KNavWuerfel = { initNavWuerfel: initNavWuerfel };
})();

/*
 * Ein-/Ausgabe des 3D-Konstruktors: binaerer STL-Writer, Datei-Download
 * und Autosave in localStorage.
 * Browser: window.KlotzwerkIO, Node (nur STL-Writer): require().
 */
(function () {
  'use strict';

  var AUTOSAVE_SCHLUESSEL = 'klotzwerk.autosave';
  var AUTOSAVE_SCHLUESSEL_ALT = 't3.3dkonstruktor.autosave'; // teil3.ch-Altbestand

  function baueBinaerSTL(vertProperties, triVerts) {
    var n = triVerts.length / 3;
    var buf = new ArrayBuffer(84 + 50 * n);
    var dv = new DataView(buf);
    dv.setUint32(80, n, true);
    var o = 84;
    for (var t = 0; t < n; t++) {
      var i0 = triVerts[3 * t] * 3, i1 = triVerts[3 * t + 1] * 3, i2 = triVerts[3 * t + 2] * 3;
      var ax = vertProperties[i0], ay = vertProperties[i0 + 1], az = vertProperties[i0 + 2];
      var bx = vertProperties[i1], by = vertProperties[i1 + 1], bz = vertProperties[i1 + 2];
      var cx = vertProperties[i2], cy = vertProperties[i2 + 1], cz = vertProperties[i2 + 2];
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      dv.setFloat32(o, nx / len, true); dv.setFloat32(o + 4, ny / len, true); dv.setFloat32(o + 8, nz / len, true);
      dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
      dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true);
      dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true);
      // Attribut-Bytes (2) bleiben 0
      o += 50;
    }
    return buf;
  }

  // --- Farbige Exporter: OBJ (+MTL) und 3MF -------------------------------
  // 'teile' ist eine Liste { name, farbe (#rrggbb), vertProperties, triVerts }
  // in Weltkoordinaten -- ein Teil pro Objekt, damit die Farben erhalten
  // bleiben (STL kennt keine Farben, dort wird weiterhin alles verschmolzen).

  function rund6(x) { return Math.round(x * 1e6) / 1e6; }

  function farbeAlsRgb(farbe) {
    var m = /^#([0-9a-f]{6})$/i.exec(farbe || '');
    var hex = m ? m[1] : '5a8dc8';   // Standard-Blau wie materialFuer
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }

  function baueOBJ(teile, mtlName) {
    var obj = ['# teil3.ch 3D-Konstruktor', 'mtllib ' + mtlName];
    var mtl = ['# teil3.ch 3D-Konstruktor'];
    var versatz = 1;   // OBJ-Indizes sind 1-basiert und global
    teile.forEach(function (teil, ti) {
      var rgb = farbeAlsRgb(teil.farbe);
      mtl.push('newmtl m' + ti);
      mtl.push('Kd ' + (rgb[0] / 255).toFixed(3) + ' ' + (rgb[1] / 255).toFixed(3) + ' ' + (rgb[2] / 255).toFixed(3));
      obj.push('o ' + String(teil.name || 'Objekt_' + (ti + 1)).replace(/\s+/g, '_'));
      var V = teil.vertProperties, T = teil.triVerts, i;
      for (i = 0; i < V.length; i += 3) {
        obj.push('v ' + rund6(V[i]) + ' ' + rund6(V[i + 1]) + ' ' + rund6(V[i + 2]));
      }
      obj.push('usemtl m' + ti);
      for (i = 0; i < T.length; i += 3) {
        obj.push('f ' + (versatz + T[i]) + ' ' + (versatz + T[i + 1]) + ' ' + (versatz + T[i + 2]));
      }
      versatz += V.length / 3;
    });
    return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n') + '\n' };
  }

  // CRC32 (Standard-Polynom, wie ZIP es verlangt)
  var CRC_TABELLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABELLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Minimaler ZIP-Writer (Stored, keine Kompression): 3MF ist ein
  // OPC-Container, mehr braucht es nicht.
  function baueZip(dateien) {
    var enc = new TextEncoder();
    var eintraege = dateien.map(function (d) {
      var nameBytes = enc.encode(d.name);
      var daten = (typeof d.inhalt === 'string') ? enc.encode(d.inhalt) : d.inhalt;
      return { nameBytes: nameBytes, daten: daten, crc: crc32(daten), offset: 0 };
    });
    var groesse = 0;
    eintraege.forEach(function (e) { groesse += 30 + e.nameBytes.length + e.daten.length; });
    var zentralGroesse = 0;
    eintraege.forEach(function (e) { zentralGroesse += 46 + e.nameBytes.length; });
    var buf = new ArrayBuffer(groesse + zentralGroesse + 22);
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    var o = 0;
    eintraege.forEach(function (e) {
      e.offset = o;
      dv.setUint32(o, 0x04034b50, true);
      dv.setUint16(o + 4, 20, true);          // Version
      dv.setUint32(o + 14, e.crc, true);
      dv.setUint32(o + 18, e.daten.length, true);
      dv.setUint32(o + 22, e.daten.length, true);
      dv.setUint16(o + 26, e.nameBytes.length, true);
      u8.set(e.nameBytes, o + 30);
      u8.set(e.daten, o + 30 + e.nameBytes.length);
      o += 30 + e.nameBytes.length + e.daten.length;
    });
    var zentralStart = o;
    eintraege.forEach(function (e) {
      dv.setUint32(o, 0x02014b50, true);
      dv.setUint16(o + 4, 20, true);
      dv.setUint16(o + 6, 20, true);
      dv.setUint32(o + 16, e.crc, true);
      dv.setUint32(o + 20, e.daten.length, true);
      dv.setUint32(o + 24, e.daten.length, true);
      dv.setUint16(o + 28, e.nameBytes.length, true);
      dv.setUint32(o + 42, e.offset, true);
      u8.set(e.nameBytes, o + 46);
      o += 46 + e.nameBytes.length;
    });
    dv.setUint32(o, 0x06054b50, true);
    dv.setUint16(o + 8, eintraege.length, true);
    dv.setUint16(o + 10, eintraege.length, true);
    dv.setUint32(o + 12, o - zentralStart, true);
    dv.setUint32(o + 16, zentralStart, true);
    return buf;
  }

  function xmlText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function baue3MF(teile) {
    // Farben als Materials-Extension-Colorgroup (m:color), NICHT als Core-
    // basematerials: Orca/Bambu parsen beim Drag-and-Drop nur Colorgroups
    // als Filament-Farben ("Standard 3MF Color Parsing"), basematerials
    // laden sie als reine Geometrie.
    var modell = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<model unit="millimeter" xml:lang="und"' +
      ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"' +
      ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">',
      ' <resources>', '  <m:colorgroup id="1">'];
    teile.forEach(function (teil) {
      var rgb = farbeAlsRgb(teil.farbe);
      var hex = '#' + rgb.map(function (x) { return (x < 16 ? '0' : '') + x.toString(16).toUpperCase(); }).join('');
      modell.push('   <m:color color="' + hex + '" />');
    });
    modell.push('  </m:colorgroup>');
    teile.forEach(function (teil, ti) {
      modell.push('  <object id="' + (ti + 2) + '" type="model" name="' +
        xmlText(teil.name || 'Objekt ' + (ti + 1)) + '" pid="1" pindex="' + ti + '">');
      modell.push('   <mesh>');
      modell.push('    <vertices>');
      var V = teil.vertProperties, T = teil.triVerts, i;
      for (i = 0; i < V.length; i += 3) {
        modell.push('     <vertex x="' + rund6(V[i]) + '" y="' + rund6(V[i + 1]) + '" z="' + rund6(V[i + 2]) + '" />');
      }
      modell.push('    </vertices>');
      modell.push('    <triangles>');
      for (i = 0; i < T.length; i += 3) {
        modell.push('     <triangle v1="' + T[i] + '" v2="' + T[i + 1] + '" v3="' + T[i + 2] + '" />');
      }
      modell.push('    </triangles>');
      modell.push('   </mesh>');
      modell.push('  </object>');
    });
    modell.push(' </resources>');
    modell.push(' <build>');
    teile.forEach(function (teil, ti) { modell.push('  <item objectid="' + (ti + 2) + '" />'); });
    modell.push(' </build>');
    modell.push('</model>');
    return baueZip([
      { name: '[Content_Types].xml', inhalt:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />' +
        '</Types>' },
      { name: '_rels/.rels', inhalt:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" ' +
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />' +
        '</Relationships>' },
      { name: '3D/3dmodel.model', inhalt: modell.join('\n') }
    ]);
  }

  // --- 3MF-Import: ZIP lesen, Modell parsen, Farben aufloesen --------------

  function entpackeZipDaten(methode, bytes) {
    if (methode === 0) return Promise.resolve(bytes);
    if (methode !== 8) return Promise.reject(new Error('Nicht unterstützte ZIP-Kompression (' + methode + ').'));
    var strom = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(strom).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  // ZIP ueber das Central Directory lesen (EOCD in den letzten 64 KB).
  // Datenoffset kommt aus dem LOKALEN Header, dessen Namens-/Extra-Laengen
  // vom zentralen Eintrag abweichen koennen.
  function leseZipEintraege(arrayBuffer) {
    var dv = new DataView(arrayBuffer);
    var u8 = new Uint8Array(arrayBuffer);
    var eocd = -1;
    for (var i = arrayBuffer.byteLength - 22; i >= Math.max(0, arrayBuffer.byteLength - 65558); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Das ist keine 3MF-Datei (ZIP-Ende fehlt).');
    var anzahl = dv.getUint16(eocd + 10, true);
    var dec = new TextDecoder();
    var eintraege = [];
    var o = dv.getUint32(eocd + 16, true);
    for (var n = 0; n < anzahl; n++) {
      if (dv.getUint32(o, true) !== 0x02014b50) break;
      var methode = dv.getUint16(o + 10, true);
      var gepackt = dv.getUint32(o + 20, true);
      var nameLen = dv.getUint16(o + 28, true);
      var extraLen = dv.getUint16(o + 30, true);
      var kommLen = dv.getUint16(o + 32, true);
      var lokal = dv.getUint32(o + 42, true);
      var name = dec.decode(u8.subarray(o + 46, o + 46 + nameLen));
      var start = lokal + 30 + dv.getUint16(lokal + 26, true) + dv.getUint16(lokal + 28, true);
      eintraege.push({ name: name, methode: methode, daten: u8.subarray(start, start + gepackt) });
      o += 46 + nameLen + extraLen + kommLen;
    }
    return Promise.all(eintraege.map(function (e) {
      return entpackeZipDaten(e.methode, e.daten).then(function (roh) { return { name: e.name, roh: roh }; });
    })).then(function (liste) {
      var map = {};
      liste.forEach(function (e) { map[e.name] = e.roh; });
      return map;
    });
  }

  // Toleranter XML-Zugriff: Regex statt DOMParser (laeuft so auch in Node-
  // Tests), Attributreihenfolge egal, Namespace-Praefixe beliebig.
  function xmlAttrs(s) {
    var o = {};
    s.replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, function (ganz, k, v) {
      o[k] = v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return ganz;
    });
    return o;
  }
  function attrOhnePraefix(attrs, name) {
    if (attrs[name] !== undefined) return attrs[name];
    for (var k in attrs) {
      var p = k.indexOf(':');
      if (p >= 0 && k.slice(p + 1) === name) return attrs[k];
    }
    return undefined;
  }
  function normFarbe(s) {
    var m = /^#([0-9a-f]{6})/i.exec(s || '');
    return m ? '#' + m[1].toLowerCase() : null;   // evtl. Alpha-Anteil kappen
  }
  // 3MF-Transform: 12 Zahlen (Zeilen der 4x3-Matrix) -> column-major 16er
  function parseZeilenTransform(s) {
    if (!s) return null;
    var z = s.trim().split(/\s+/).map(parseFloat);
    if (z.length !== 12 || z.some(isNaN)) return null;
    return [z[0], z[1], z[2], 0, z[3], z[4], z[5], 0, z[6], z[7], z[8], 0, z[9], z[10], z[11], 1];
  }
  var MAT_EINHEIT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function matMul16(a, b) {
    var r = new Array(16);
    for (var sp = 0; sp < 4; sp++) {
      for (var ze = 0; ze < 4; ze++) {
        r[sp * 4 + ze] = a[ze] * b[sp * 4] + a[4 + ze] * b[sp * 4 + 1] +
                         a[8 + ze] * b[sp * 4 + 2] + a[12 + ze] * b[sp * 4 + 3];
      }
    }
    return r;
  }

  // Eine .model-Datei: Farbgruppen (m:colorgroup UND Core-basematerials),
  // Objekte (Mesh oder Komponenten), Build-Items.
  function parseModellXml(text) {
    var props = {};   // Property-Gruppen-Id -> [#rrggbb|null, ...]
    text.replace(/<(?:[\w.-]+:)?colorgroup\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?colorgroup>/g, function (ganz, at, innen) {
      var farben = [];
      innen.replace(/<(?:[\w.-]+:)?color\b([^>]*)\/?>/g, function (g2, cat) {
        farben.push(normFarbe(xmlAttrs(cat).color));
        return g2;
      });
      props[xmlAttrs(at).id] = farben;
      return ganz;
    });
    text.replace(/<basematerials\b([^>]*)>([\s\S]*?)<\/basematerials>/g, function (ganz, at, innen) {
      var farben = [];
      innen.replace(/<base\b([^>]*)\/?>/g, function (g2, bat) {
        farben.push(normFarbe(xmlAttrs(bat).displaycolor));
        return g2;
      });
      props[xmlAttrs(at).id] = farben;
      return ganz;
    });
    var objekte = {};
    text.replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/g, function (ganz, at, innen) {
      var a = xmlAttrs(at);
      var farbe = null;
      if (a.pid !== undefined && props[a.pid] && a.pindex !== undefined) {
        farbe = props[a.pid][parseInt(a.pindex, 10)] || null;
      }
      var eintrag = { name: a.name || null, farbe: farbe, mesh: null, komponenten: null };
      if (/<(?:[\w.-]+:)?components\b/.test(innen)) {
        eintrag.komponenten = [];
        innen.replace(/<(?:[\w.-]+:)?component\b([^>]*)\/?>/g, function (g2, cat) {
          var ca = xmlAttrs(cat);
          eintrag.komponenten.push({ objectid: ca.objectid, pfad: attrOhnePraefix(ca, 'path') || null,
                                     mat: parseZeilenTransform(ca.transform) });
          return g2;
        });
      } else if (innen.indexOf('<mesh') >= 0) {
        var V = [], T = [], P = [], bemalt = false;
        innen.replace(/<vertex\b([^>]*)\/?>/g, function (g2, vat) {
          var va = xmlAttrs(vat);
          V.push(parseFloat(va.x) || 0, parseFloat(va.y) || 0, parseFloat(va.z) || 0);
          return g2;
        });
        innen.replace(/<triangle\b([^>]*)\/?>/g, function (g2, tat) {
          var ta = xmlAttrs(tat);
          T.push(parseInt(ta.v1, 10), parseInt(ta.v2, 10), parseInt(ta.v3, 10));
          P.push(ta.paint_color || null);
          if (ta.paint_color) bemalt = true;
          return g2;
        });
        eintrag.mesh = { V: V, T: T, P: bemalt ? P : null };
      }
      objekte[a.id] = eintrag;
      return ganz;
    });
    var build = [];
    var buildBlock = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(text);
    if (buildBlock) {
      buildBlock[1].replace(/<item\b([^>]*)\/?>/g, function (ganz, iat) {
        var ia = xmlAttrs(iat);
        build.push({ objectid: ia.objectid, pfad: attrOhnePraefix(ia, 'path') || null,
                     mat: parseZeilenTransform(ia.transform) });
        return ganz;
      });
    }
    return { objekte: objekte, build: build };
  }

  // Bambu-/Orca-Projektdateien tragen ihre Farben NICHT im Modell, sondern
  // in Metadata/project_settings.config (filament_colour-Array) plus
  // Metadata/model_settings.config (extruder pro Objekt, optional pro Part;
  // die Part-Id entspricht der objectid der Komponente). Dreiecks-Painting
  // (paint_color) wird nicht gelesen.
  function parseModelSettings(text) {
    var objekte = {};
    text.replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/g, function (ganz, at, innen) {
      var eintrag = { extruder: null, name: null, parts: {} };
      var rest = innen.replace(/<part\b([^>]*)>([\s\S]*?)<\/part>/g, function (g2, pat, pinnen) {
        var pid = xmlAttrs(pat).id;
        var pex = metaWert(pinnen, 'extruder');
        if (pid !== undefined && pex) eintrag.parts[pid] = parseInt(pex, 10);
        return '';
      });
      var ex = metaWert(rest, 'extruder');
      if (ex) eintrag.extruder = parseInt(ex, 10);
      eintrag.name = metaWert(rest, 'name');
      objekte[xmlAttrs(at).id] = eintrag;
      return ganz;
    });
    return objekte;
  }
  function metaWert(text, schluessel) {
    var wert = null;
    text.replace(/<metadata\b([^>]*)\/?>/g, function (ganz, at) {
      var a = xmlAttrs(at);
      if (a.key === schluessel && wert === null) wert = a.value;
      return ganz;
    });
    return wert;
  }

  // Bambu-Dreiecks-Painting (paint_color) fuer UNGETEILTE Dreiecke:
  // Hex-String rueckwaerts, Nibbles LSB-first; 2 Bits Split (0 = ganzes
  // Dreieck), 2 Bits Zustand, Zustand 3 -> 4 Zusatzbits (+3). Liefert die
  // Filament-Nummer (1-basiert), 0 = unbemalt, -1 = unterteiltes Dreieck
  // (Sub-Dreieck-Painting wird nicht aufgeloest -> zaehlt als unbemalt).
  // Codierung empirisch an einer echten Bambu-Datei gegen deren
  // filament_colour-Liste verifiziert.
  function paintExtruder(code) {
    if (!code) return 0;
    var bits = [];
    for (var i = code.length - 1; i >= 0; i--) {
      var n = parseInt(code.charAt(i), 16);
      if (isNaN(n)) return -1;
      bits.push(n & 1, (n >> 1) & 1, (n >> 2) & 1, (n >> 3) & 1);
    }
    var pos = 0;
    function lese(anz) {
      var w = 0;
      for (var b = 0; b < anz; b++) w |= (bits[pos++] || 0) << b;
      return w;
    }
    if (lese(2) !== 0) return -1;
    var zustand = lese(2);
    if (zustand === 3) zustand = lese(4) + 3;
    return zustand;
  }

  // Teil-Mesh aus ausgewaehlten Dreiecken, Vertices kompaktiert (keine
  // verwaisten Vertices in die Assets verschleppen)
  function teilMesh(V, T, dreiecke) {
    var map = {}, neuV = [], neuT = new Uint32Array(dreiecke.length * 3);
    for (var i = 0; i < dreiecke.length; i++) {
      for (var e = 0; e < 3; e++) {
        var alt = T[dreiecke[i] * 3 + e];
        var neu = map[alt];
        if (neu === undefined) {
          neu = neuV.length / 3;
          map[alt] = neu;
          neuV.push(V[alt * 3], V[alt * 3 + 1], V[alt * 3 + 2]);
        }
        neuT[i * 3 + e] = neu;
      }
    }
    return { V: neuV, T: neuT };
  }

  // 3MF-Datei -> Teile-Liste { name, farbe|null, vertProperties, triVerts }
  // in Weltkoordinaten (Build- und Komponenten-Transforms eingebacken).
  // Unterstuetzt Komponenten inkl. Verweisen auf andere .model-Dateien im
  // Container (Production-Extension p:path, z.B. Bambu-Projektdateien).
  function parse3MF(arrayBuffer) {
    return Promise.resolve().then(function () {
      return leseZipEintraege(arrayBuffer);
    }).then(function (dateien) {
      var dec = new TextDecoder();
      var hauptPfad = '3D/3dmodel.model';
      if (dateien['_rels/.rels']) {
        var rels = dec.decode(dateien['_rels/.rels']);
        rels.replace(/<Relationship\b([^>]*)\/?>/g, function (ganz, rat) {
          var ra = xmlAttrs(rat);
          if (/3dmodel/i.test(ra.Type || '') && ra.Target) hauptPfad = ra.Target.replace(/^\//, '');
          return ganz;
        });
      }
      if (!dateien[hauptPfad]) {
        var kandidaten = Object.keys(dateien).filter(function (n) { return /\.model$/i.test(n); });
        if (!kandidaten.length) throw new Error('Kein 3D-Modell in der 3MF-Datei gefunden.');
        hauptPfad = kandidaten[0];
      }
      var modelle = {};
      function modell(pfad) {
        pfad = pfad.replace(/^\//, '');
        if (!modelle[pfad]) {
          if (!dateien[pfad]) throw new Error('Modell-Datei «' + pfad + '» fehlt im 3MF.');
          modelle[pfad] = parseModellXml(dec.decode(dateien[pfad]));
        }
        return modelle[pfad];
      }
      var haupt = modell(hauptPfad);
      // Bambu-/Orca-Farben aus den Metadata-Configs (falls vorhanden)
      var bambu = null;
      if (dateien['Metadata/project_settings.config'] && dateien['Metadata/model_settings.config']) {
        try {
          var ps = JSON.parse(dec.decode(dateien['Metadata/project_settings.config']));
          bambu = {
            farben: (ps.filament_colour || []).map(normFarbe),
            objekte: parseModelSettings(dec.decode(dateien['Metadata/model_settings.config']))
          };
        } catch (e) { bambu = null; }   // defekte Configs: still ignorieren
      }
      function bambuEintrag(buildId) {
        return (bambu && bambu.objekte[buildId]) || null;
      }
      function bambuFarbe(buildId, objectid) {
        var o = bambuEintrag(buildId);
        if (!o) return null;
        var ex = o.parts[objectid] !== undefined ? o.parts[objectid] : o.extruder;
        return (ex && bambu.farben[ex - 1]) || null;
      }
      var teile = [];
      function sammle(pfad, objectid, mat, erbe, tiefe, buildId) {
        if (tiefe > 32) return;   // Schutz gegen zyklische Komponenten
        var obj = modell(pfad).objekte[objectid];
        if (!obj) return;
        var name = obj.name || (erbe && erbe.name) || null;
        var farbe = obj.farbe || (erbe && erbe.farbe) || null;
        if (obj.mesh && obj.mesh.T.length) {
          var be = bambuEintrag(buildId);
          var basisName = name || (be && be.name) || null;
          var basisFarbe = farbe || bambuFarbe(buildId, objectid);
          if (obj.mesh.P && bambu && bambu.farben.length) {
            // Bambu-Painting: Mesh nach Filament-Farbe in Teile splitten.
            // Unterteilte Dreiecke (-1) und unbemalte (0) fallen auf die
            // Basis-Farbe des Objekts zurueck.
            var gruppen = {}, reihenfolge = [];
            for (var t = 0; t < obj.mesh.P.length; t++) {
              var ex = paintExtruder(obj.mesh.P[t]);
              if (ex < 0) ex = 0;
              if (!gruppen[ex]) { gruppen[ex] = []; reihenfolge.push(ex); }
              gruppen[ex].push(t);
            }
            reihenfolge.forEach(function (ex, gi) {
              var tm = teilMesh(obj.mesh.V, obj.mesh.T, gruppen[ex]);
              teile.push({
                name: basisName && reihenfolge.length > 1 ? basisName + ' (' + (gi + 1) + ')' : basisName,
                farbe: (ex > 0 && bambu.farben[ex - 1]) || basisFarbe,
                vertProperties: transformiereVertices(new Float32Array(tm.V), mat || MAT_EINHEIT),
                triVerts: tm.T
              });
            });
          } else {
            teile.push({
              name: basisName, farbe: basisFarbe,
              vertProperties: transformiereVertices(new Float32Array(obj.mesh.V), mat || MAT_EINHEIT),
              triVerts: new Uint32Array(obj.mesh.T)
            });
          }
        }
        if (obj.komponenten) {
          obj.komponenten.forEach(function (k) {
            var m2 = mat ? (k.mat ? matMul16(mat, k.mat) : mat) : k.mat;
            sammle(k.pfad || pfad, k.objectid, m2, { name: name, farbe: farbe }, tiefe + 1, buildId);
          });
        }
      }
      // Ohne <build> (defensiv): alle Objekte der Hauptdatei direkt nehmen
      var items = haupt.build.length ? haupt.build
        : Object.keys(haupt.objekte).map(function (id) { return { objectid: id, pfad: null, mat: null }; });
      items.forEach(function (it) { sammle(it.pfad || hauptPfad, it.objectid, it.mat, null, 0, it.objectid); });
      if (!teile.length) throw new Error('Die 3MF-Datei enthält keine Geometrie.');
      return teile;
    });
  }

  // --- OBJ-Import (+MTL-Farben) --------------------------------------------
  // Faces nach (o/g-Name, usemtl) gruppiert -> ein Teil pro Material-Gruppe,
  // Vertices pro Teil kompaktiert. vt/vn werden ignoriert, Polygone fan-
  // trianguliert, negative Indizes (relativ zum Zeilen-Zeitpunkt) aufgeloest.
  function parseOBJ(text) {
    var V = [];
    var gruppen = {}, reihenfolge = [];
    var oName = null, material = null;
    function gruppe() {
      var key = (oName || '') + ' ' + (material || '');
      if (!gruppen[key]) {
        gruppen[key] = { name: oName, material: material, map: {}, V: [], T: [] };
        reihenfolge.push(gruppen[key]);
      }
      return gruppen[key];
    }
    text.split('\n').forEach(function (zeile) {
      zeile = zeile.trim();
      if (!zeile || zeile.charAt(0) === '#') return;
      var t = zeile.split(/\s+/);
      if (t[0] === 'v') {
        V.push(parseFloat(t[1]) || 0, parseFloat(t[2]) || 0, parseFloat(t[3]) || 0);
        return;
      }
      if (t[0] === 'o' || t[0] === 'g') { oName = t.slice(1).join(' ') || null; return; }
      if (t[0] === 'usemtl') { material = t.slice(1).join(' ') || null; return; }
      if (t[0] !== 'f') return;
      var g = gruppe();
      var idx = [];
      for (var i = 1; i < t.length; i++) {
        var n = parseInt(t[i].split('/')[0], 10);
        if (isNaN(n)) return;   // kaputte Face-Zeile: ueberspringen
        var vi = n > 0 ? n - 1 : V.length / 3 + n;
        if (vi < 0 || vi * 3 >= V.length) return;   // Verweis ins Leere
        var lok = g.map[vi];
        if (lok === undefined) {
          lok = g.V.length / 3;
          g.map[vi] = lok;
          g.V.push(V[vi * 3], V[vi * 3 + 1], V[vi * 3 + 2]);
        }
        idx.push(lok);
      }
      for (var f = 1; f + 1 < idx.length; f++) g.T.push(idx[0], idx[f], idx[f + 1]);
    });
    var teile = reihenfolge.filter(function (g) { return g.T.length > 0; }).map(function (g) {
      return { name: g.name, material: g.material,
               vertProperties: new Float32Array(g.V), triVerts: new Uint32Array(g.T) };
    });
    if (!teile.length) throw new Error('Die OBJ-Datei enthält keine Flächen.');
    return teile;
  }

  // MTL: Materialname -> #rrggbb (aus Kd, 0..1 pro Kanal)
  function parseMTL(text) {
    var farben = {}, aktuell = null;
    function hex2(x) {
      var v = Math.max(0, Math.min(255, Math.round((parseFloat(x) || 0) * 255)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }
    text.split('\n').forEach(function (zeile) {
      var t = zeile.trim().split(/\s+/);
      if (t[0] === 'newmtl') { aktuell = t.slice(1).join(' ') || null; return; }
      if (t[0] === 'Kd' && aktuell && t.length >= 4) {
        farben[aktuell] = '#' + hex2(t[1]) + hex2(t[2]) + hex2(t[3]);
      }
    });
    return farben;
  }

  // STL lesen: binaer (Groessenformel 84 + 50*n) oder ASCII. Liefert die
  // Dreiecke als Soup (jeder Eckpunkt einzeln) -- verschweisst wird erst
  // in der Manifold-Pruefung (Mesh.merge()).
  function parseSTL(arrayBuffer) {
    if (arrayBuffer.byteLength >= 84) {
      var dv = new DataView(arrayBuffer);
      var n = dv.getUint32(80, true);
      // Groessenformel statt "solid"-Praefix: auch binaere Dateien
      // beginnen manchmal mit "solid"
      if (84 + 50 * n === arrayBuffer.byteLength && n > 0) {
        var verts = new Float32Array(n * 9);
        var tris = new Uint32Array(n * 3);
        for (var t = 0; t < n; t++) {
          var o = 84 + 50 * t + 12; // Normale (12 Bytes) ueberspringen
          for (var j = 0; j < 9; j++) verts[t * 9 + j] = dv.getFloat32(o + 4 * j, true);
          tris[3 * t] = 3 * t; tris[3 * t + 1] = 3 * t + 1; tris[3 * t + 2] = 3 * t + 2;
        }
        return { vertProperties: verts, triVerts: tris };
      }
    }
    return parseAsciiSTL(arrayBuffer);
  }

  function parseAsciiSTL(arrayBuffer) {
    var text;
    try { text = new TextDecoder().decode(arrayBuffer); } catch (e) { text = ''; }
    if (!/^\s*solid/.test(text)) throw new Error('Das ist keine STL-Datei.');
    var re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    var koords = [], m;
    while ((m = re.exec(text)) !== null) {
      koords.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    }
    if (koords.length === 0 || koords.length % 9 !== 0) {
      throw new Error('Diese STL-Datei ist unvollständig oder beschädigt.');
    }
    var verts = new Float32Array(koords);
    var tris = new Uint32Array(koords.length / 3);
    for (var i = 0; i < tris.length; i++) tris[i] = i;
    return { vertProperties: verts, triVerts: tris };
  }

  function downloadBlob(blob, dateiname) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = dateiname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadDatei(arrayBuffer, dateiname, mime) {
    downloadBlob(new Blob([arrayBuffer], { type: mime || 'model/stl' }), dateiname);
  }

  function downloadText(text, dateiname) {
    downloadBlob(new Blob([text], { type: 'application/json' }), dateiname);
  }

  function speichereAutosave(dokumentString) {
    try { window.localStorage.setItem(AUTOSAVE_SCHLUESSEL, dokumentString); return true; }
    catch (e) { return false; }
  }

  function ladeAutosave() {
    try {
      var wert = window.localStorage.getItem(AUTOSAVE_SCHLUESSEL);
      if (wert === null) {
        wert = window.localStorage.getItem(AUTOSAVE_SCHLUESSEL_ALT);
        if (wert !== null) {
          try { window.localStorage.setItem(AUTOSAVE_SCHLUESSEL, wert); window.localStorage.removeItem(AUTOSAVE_SCHLUESSEL_ALT); } catch (e) { }
        }
      }
      return wert;
    }
    catch (e) { return null; }
  }

  function loescheAutosave() {
    try { window.localStorage.removeItem(AUTOSAVE_SCHLUESSEL); } catch (e) { }
  }

  // --- Mesh-Transformation und -Verbindung (Roh-Export) --------------------

  function transformiereVertices(vertProperties, m) {
    var out = new Float32Array(vertProperties.length);
    for (var i = 0; i < vertProperties.length; i += 3) {
      var x = vertProperties[i], y = vertProperties[i + 1], z = vertProperties[i + 2];
      out[i]     = m[0] * x + m[4] * y + m[8]  * z + m[12];
      out[i + 1] = m[1] * x + m[5] * y + m[9]  * z + m[13];
      out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    return out;
  }

  function bboxMinMax(vertProperties) {
    var minX = Infinity, minY = Infinity, minZ = Infinity;
    var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (var i = 0; i < vertProperties.length; i += 3) {
      if (vertProperties[i] < minX) minX = vertProperties[i];
      if (vertProperties[i] > maxX) maxX = vertProperties[i];
      if (vertProperties[i + 1] < minY) minY = vertProperties[i + 1];
      if (vertProperties[i + 1] > maxY) maxY = vertProperties[i + 1];
      if (vertProperties[i + 2] < minZ) minZ = vertProperties[i + 2];
      if (vertProperties[i + 2] > maxZ) maxZ = vertProperties[i + 2];
    }
    return [minX, minY, minZ, maxX, maxY, maxZ];
  }

  // BBox-Mitte einer Vertex-Liste (x,y,z-Tripel). Fuer das Cut-Tool:
  // Teile werden um diese Mitte zentriert, damit sie um sich selbst drehen.
  function bboxMitte(vertProperties) {
    var b = bboxMinMax(vertProperties);
    return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  }

  // BBox-Abmessungen [dx, dy, dz] in mm fuer die Groessen-Anzeige
  // importierter Modelle im Eigenschaften-Panel.
  function bboxGroesse(vertProperties) {
    var b = bboxMinMax(vertProperties);
    return [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
  }

  function verbindeMeshes(liste) {
    var nv = 0, nt = 0;
    liste.forEach(function (t) { nv += t.vertProperties.length; nt += t.triVerts.length; });
    var v = new Float32Array(nv), tri = new Uint32Array(nt);
    var ov = 0, ot = 0;
    liste.forEach(function (t) {
      v.set(t.vertProperties, ov);
      for (var i = 0; i < t.triVerts.length; i++) tri[ot + i] = t.triVerts[i] + ov / 3;
      ov += t.vertProperties.length; ot += t.triVerts.length;
    });
    return { vertProperties: v, triVerts: tri };
  }

  // --- Projektdatei: JSON mit Base64-eingebetteten Assets ----------------

  function abZuBase64(typedArray) {
    var bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    if (typeof btoa !== 'function') return Buffer.from(bytes).toString('base64');
    var s = '';
    for (var i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return btoa(s);
  }

  function base64ZuBytes(s) {
    if (typeof atob !== 'function') {
      var b = Buffer.from(s, 'base64');
      return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    }
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function sammleAssetIds(dok) {
    var ids = {};
    (function geh(liste) {
      liste.forEach(function (k) {
        if (k.typ === 'import') ids[k.params.assetId] = true;
        if (k.typ === 'gruppe') geh(k.kinder);
      });
    })(dok.objekte);
    return Object.keys(ids);
  }

  function exportiereProjekt(dok, holeAsset) {
    var assets = {};
    sammleAssetIds(dok).forEach(function (id) {
      var a = holeAsset(id);
      if (!a) return;
      assets[id] = { name: a.name || '', wasserdicht: !!a.wasserdicht,
        vertProperties: abZuBase64(a.vertProperties), triVerts: abZuBase64(a.triVerts) };
    });
    return JSON.stringify({ format: 't3-konstruktor-projekt', version: 1, dok: dok, assets: assets });
  }

  // --- Einzelteile-Export: eindeutige Teile gruppieren ---------------------
  // Wie Onshape «export unique parts as individual files»: Eindeutigkeit =
  // gleiche Geometrie im Objektraum (Typ + Params bzw. Import-Asset bzw.
  // Gruppen-Kinder samt relativer Lage) + Skalierung. Position und Drehung
  // des Teils selbst unterscheiden nicht. Sind Negative im Umfang, schneiden
  // die positionsabhaengig ins Ergebnis -- dann zaehlt die Lage mit und
  // praktisch jedes Teil ist eindeutig.

  function geometrieSchluessel(k, mitLage) {
    var kern;
    if (k.typ === 'import') kern = { asset: k.params.assetId };
    else if (k.typ === 'gruppe') {
      kern = { modus: k.modus || '', kinder: k.kinder.map(function (kind) {
        return geometrieSchluessel(kind, true);   // in der Gruppe zaehlt die relative Lage
      }) };
    } else kern = { typ: k.typ, params: k.params };
    var s = { kern: kern, skalierung: k.transform.skalierung };
    if (mitLage) {
      s.position = k.transform.position;
      s.rotation = k.transform.rotation;
      s.istLoch = !!k.istLoch;
    }
    return s;
  }

  function bereinigeDateiname(name) {
    var n = String(name || 'Teil').replace(/\.(stl|obj|3mf)$/i, '');
    n = n.replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
    return n || 'Teil';
  }

  function gruppiereEindeutigeTeile(objekte) {
    var hatLoecher = objekte.some(function (k) { return k.istLoch; });
    var gruppen = [], nachSchluessel = {};
    objekte.forEach(function (k) {
      if (k.istLoch) return;   // Negative sind keine eigenen Teile
      var s = JSON.stringify(geometrieSchluessel(k, hatLoecher));
      if (nachSchluessel[s]) { nachSchluessel[s].anzahl++; return; }
      var g = { objekt: k, anzahl: 1 };
      nachSchluessel[s] = g;
      gruppen.push(g);
    });
    var vergeben = {};
    gruppen.forEach(function (g) {
      var basis = bereinigeDateiname(g.objekt.name) + (g.anzahl > 1 ? '-' + g.anzahl + 'x' : '');
      var name = basis, i = 2;
      while (vergeben[name]) { name = basis + '-' + i; i++; }
      vergeben[name] = true;
      g.dateiname = name + '.stl';
    });
    return { teile: gruppen, hatLoecher: hatLoecher };
  }

  function importiereProjekt(text) {
    var p;
    try { p = JSON.parse(text); } catch (e) { p = null; }
    if (!p || p.format !== 't3-konstruktor-projekt') throw new Error('Das ist keine Konstruktor-Projektdatei.');
    if (p.version !== 1 || !p.dok || p.dok.version !== 1) {
      throw new Error('Diese Projektdatei stammt aus einer neueren Version dieser Seite.');
    }
    var assets = {};
    Object.keys(p.assets || {}).forEach(function (id) {
      assets[id] = {
        name: p.assets[id].name, wasserdicht: !!p.assets[id].wasserdicht,
        vertProperties: new Float32Array(base64ZuBytes(p.assets[id].vertProperties).buffer),
        triVerts: new Uint32Array(base64ZuBytes(p.assets[id].triVerts).buffer)
      };
    });
    return { dok: p.dok, assets: assets };
  }

  var api = {
    baueBinaerSTL: baueBinaerSTL,
    baueOBJ: baueOBJ,
    baue3MF: baue3MF,
    baueZip: baueZip,
    gruppiereEindeutigeTeile: gruppiereEindeutigeTeile,
    parse3MF: parse3MF,
    parseOBJ: parseOBJ,
    parseMTL: parseMTL,
    parseSTL: parseSTL,
    downloadDatei: downloadDatei,
    downloadText: downloadText,
    speichereAutosave: speichereAutosave,
    ladeAutosave: ladeAutosave,
    loescheAutosave: loescheAutosave,
    exportiereProjekt: exportiereProjekt,
    importiereProjekt: importiereProjekt,
    transformiereVertices: transformiereVertices,
    bboxMitte: bboxMitte,
    bboxGroesse: bboxGroesse,
    verbindeMeshes: verbindeMeshes,
    sammleAssetIds: sammleAssetIds
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { window.KlotzwerkIO = api; }
})();

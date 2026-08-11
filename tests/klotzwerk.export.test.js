#!/usr/bin/env node
/*
 * Headless-Test der farbigen Exporter in io.js: OBJ (+MTL) und 3MF.
 * Das 3MF wird als ZIP von Hand geparst (Stored-Eintraege) und die CRCs
 * gegen zlib.crc32 geprueft.
 * Lauf:  node tests/generators/3d-konstruktor.export.test.js
 */
const path = require('path');
const zlib = require('zlib');
const IO = require(path.join(__dirname,
  '../src/./io.js'));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); failures++; }
}

// Zwei Teile: je ein Dreieck, klar unterscheidbare Farben
const teile = [
  { name: 'Roter Keil', farbe: '#ff0000',
    vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    triVerts: new Uint32Array([0, 1, 2]) },
  { name: 'Blauer Keil', farbe: '#0000ff',
    vertProperties: new Float32Array([0, 0, 5, 10, 0, 5, 0, 10, 5]),
    triVerts: new Uint32Array([0, 1, 2]) }
];

console.log('baueOBJ:');
{
  const erg = IO.baueOBJ(teile, 'teil3-konstruktion.mtl');
  check('mtllib-Verweis', erg.obj.indexOf('mtllib teil3-konstruktion.mtl') >= 0);
  check('Objektnamen', erg.obj.indexOf('o Roter_Keil') >= 0 && erg.obj.indexOf('o Blauer_Keil') >= 0);
  const vZeilen = erg.obj.split('\n').filter(function (z) { return z.slice(0, 2) === 'v '; });
  check('6 Vertices', vZeilen.length === 6, 'gefunden: ' + vZeilen.length);
  const fZeilen = erg.obj.split('\n').filter(function (z) { return z.slice(0, 2) === 'f '; });
  check('Face-Indizes global versetzt', fZeilen.length === 2 &&
    fZeilen[0] === 'f 1 2 3' && fZeilen[1] === 'f 4 5 6', fZeilen.join(' | '));
  check('usemtl pro Teil', erg.obj.indexOf('usemtl m0') >= 0 && erg.obj.indexOf('usemtl m1') >= 0);
  check('MTL: rote Farbe', erg.mtl.indexOf('newmtl m0') >= 0 && erg.mtl.indexOf('Kd 1.000 0.000 0.000') >= 0);
  check('MTL: blaue Farbe', erg.mtl.indexOf('newmtl m1') >= 0 && erg.mtl.indexOf('Kd 0.000 0.000 1.000') >= 0);
}

// Minimaler ZIP-Leser fuer Stored-Eintraege
function leseZip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const eintraege = {};
  let o = 0;
  while (o + 4 <= buf.byteLength && dv.getUint32(o, true) === 0x04034b50) {
    const methode = dv.getUint16(o + 8, true);
    const crc = dv.getUint32(o + 14, true);
    const groesse = dv.getUint32(o + 18, true);
    const nameLen = dv.getUint16(o + 26, true);
    const extraLen = dv.getUint16(o + 28, true);
    const name = Buffer.from(u8.subarray(o + 30, o + 30 + nameLen)).toString('utf8');
    const daten = u8.subarray(o + 30 + nameLen + extraLen, o + 30 + nameLen + extraLen + groesse);
    eintraege[name] = { methode, crc, daten };
    o = o + 30 + nameLen + extraLen + groesse;
  }
  return eintraege;
}

console.log('baue3MF:');
{
  const buf = IO.baue3MF(teile);
  const zip = leseZip(buf);
  const namen = Object.keys(zip);
  check('3 ZIP-Eintraege', namen.length === 3, namen.join(','));
  check('Content-Types vorhanden', !!zip['[Content_Types].xml']);
  check('Beziehungen vorhanden', !!zip['_rels/.rels']);
  const modell = zip['3D/3dmodel.model'];
  check('Modell vorhanden', !!modell);
  check('alle Eintraege stored', namen.every(function (n) { return zip[n].methode === 0; }));
  check('CRC32 stimmen', namen.every(function (n) {
    return (zlib.crc32(zip[n].daten) >>> 0) === zip[n].crc;
  }));
  const xml = Buffer.from(modell.daten).toString('utf8');
  check('Millimeter-Einheit', xml.indexOf('unit="millimeter"') >= 0);
  // Farben als Materials-Extension-Colorgroup: nur die parsen Orca/Bambu
  // beim Drag-and-Drop als Filament-Farben (Core-basematerials = nur Geometrie)
  check('Materials-Extension-Namespace', xml.indexOf('xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"') >= 0);
  check('Farben als m:colorgroup', xml.indexOf('<m:colorgroup id="1">') >= 0 &&
    xml.indexOf('<m:color color="#FF0000"') >= 0 && xml.indexOf('<m:color color="#0000FF"') >= 0);
  check('zwei Objekte mit pid/pindex', (xml.match(/<object /g) || []).length === 2 &&
    xml.indexOf('pindex="0"') >= 0 && xml.indexOf('pindex="1"') >= 0);
  check('Objektnamen am object-Tag', xml.indexOf('name="Roter Keil"') >= 0 &&
    xml.indexOf('name="Blauer Keil"') >= 0);
  check('Build-Items', (xml.match(/<item /g) || []).length === 2);
  check('Dreiecke drin', (xml.match(/<triangle /g) || []).length === 2 &&
    (xml.match(/<vertex /g) || []).length === 6);
}

// --- parse3MF: Import mit Farben -----------------------------------------

(async () => {
  console.log('parse3MF: Roundtrip mit eigenem Export (m:colorgroup):');
  {
    const geladen = await IO.parse3MF(IO.baue3MF(teile));
    check('2 Teile', geladen.length === 2, 'gefunden: ' + geladen.length);
    check('Namen', geladen[0].name === 'Roter Keil' && geladen[1].name === 'Blauer Keil');
    check('Farben', geladen[0].farbe === '#ff0000' && geladen[1].farbe === '#0000ff',
      geladen.map(function (t) { return t.farbe; }).join(','));
    check('Geometrie', geladen[0].triVerts.length === 3 &&
      Math.abs(geladen[0].vertProperties[3] - 10) < 1e-4);
  }

  // Fremd-3MF von Hand: basematerials, Build-Transform, Komponente,
  // Deflate-komprimierter Eintrag
  function zipMitDeflate(dateien) {
    // Minimaler ZIP-Writer mit Methode 8 (deflate-raw), nur fuer den Test
    const teileBin = dateien.map(function (d) {
      const roh = Buffer.from(d.inhalt, 'utf8');
      return { name: Buffer.from(d.name), roh: roh, gepackt: zlib.deflateRawSync(roh),
               crc: zlib.crc32(roh) >>> 0 };
    });
    let groesse = 0;
    teileBin.forEach(function (e) { groesse += 30 + e.name.length + e.gepackt.length; });
    let zentral = 0;
    teileBin.forEach(function (e) { zentral += 46 + e.name.length; });
    const buf = Buffer.alloc(groesse + zentral + 22);
    let o = 0;
    teileBin.forEach(function (e) {
      e.offset = o;
      buf.writeUInt32LE(0x04034b50, o);
      buf.writeUInt16LE(20, o + 4);
      buf.writeUInt16LE(8, o + 8);                    // deflate
      buf.writeUInt32LE(e.crc, o + 14);
      buf.writeUInt32LE(e.gepackt.length, o + 18);
      buf.writeUInt32LE(e.roh.length, o + 22);
      buf.writeUInt16LE(e.name.length, o + 26);
      e.name.copy(buf, o + 30);
      e.gepackt.copy(buf, o + 30 + e.name.length);
      o += 30 + e.name.length + e.gepackt.length;
    });
    const zentralStart = o;
    teileBin.forEach(function (e) {
      buf.writeUInt32LE(0x02014b50, o);
      buf.writeUInt16LE(20, o + 4); buf.writeUInt16LE(20, o + 6);
      buf.writeUInt16LE(8, o + 10);
      buf.writeUInt32LE(e.crc, o + 16);
      buf.writeUInt32LE(e.gepackt.length, o + 20);
      buf.writeUInt32LE(e.roh.length, o + 24);
      buf.writeUInt16LE(e.name.length, o + 28);
      buf.writeUInt32LE(e.offset, o + 42);
      e.name.copy(buf, o + 46);
      o += 46 + e.name.length;
    });
    buf.writeUInt32LE(0x06054b50, o);
    buf.writeUInt16LE(teileBin.length, o + 8);
    buf.writeUInt16LE(teileBin.length, o + 10);
    buf.writeUInt32LE(o - zentralStart, o + 12);
    buf.writeUInt32LE(zentralStart, o + 16);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  console.log('parse3MF: Fremddatei (basematerials, Komponente, Build-Transform, deflate):');
  {
    const modell = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<resources>' +
      '<basematerials id="5"><base name="Gruen" displaycolor="#00FF00FF" /></basematerials>' +
      '<object id="1" type="model" name="Keil" pid="5" pindex="0"><mesh>' +
      '<vertices><vertex x="0" y="0" z="0" /><vertex z="0" x="10" y="0" /><vertex x="0" y="10" z="0" /></vertices>' +
      '<triangles><triangle v1="0" v2="1" v3="2" /></triangles>' +
      '</mesh></object>' +
      '<object id="2" type="model"><components>' +
      '<component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0" />' +
      '</components></object>' +
      '</resources>' +
      '<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 100" /></build>' +
      '</model>';
    const zipBuf = zipMitDeflate([
      { name: '_rels/.rels', inhalt: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>' },
      { name: '3D/3dmodel.model', inhalt: modell }
    ]);
    const geladen = await IO.parse3MF(zipBuf);
    check('1 Teil (nur Build-Item)', geladen.length === 1, 'gefunden: ' + geladen.length);
    const t = geladen[0] || {};
    check('Farbe aus basematerials (Alpha gekappt)', t.farbe === '#00ff00', 'farbe: ' + t.farbe);
    check('Name vom Mesh-Objekt', t.name === 'Keil', 'name: ' + t.name);
    // Komponente verschiebt +5 in X, Build-Item +100 in Z; Attributreihenfolge
    // im zweiten Vertex ist absichtlich vertauscht
    check('Transform-Kette gebacken', t.vertProperties &&
      Math.abs(t.vertProperties[0] - 5) < 1e-4 && Math.abs(t.vertProperties[2] - 100) < 1e-4 &&
      Math.abs(t.vertProperties[3] - 15) < 1e-4,
      t.vertProperties && Array.prototype.slice.call(t.vertProperties, 0, 9).join(','));
  }

  console.log('parse3MF: Bambu-Projektdatei (filament_colour + extruder-Zuordnung):');
  {
    // Nachbau der echten Struktur (2X_KEYBOARED_CLICKER): Hauptmodell mit
    // Komponenten-Verweisen auf Objects/*.model, Farben NUR ueber
    // Metadata-Configs. Objekt 2: Objekt-Extruder 3; Objekt 4: Part-
    // Extruder 2 uebersteuert Objekt-Extruder 1.
    const haupt = '<?xml version="1.0"?>' +
      '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"' +
      ' xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">' +
      '<resources>' +
      '<object id="2" type="model"><components>' +
      '<component p:path="/3D/Objects/object_2.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" />' +
      '</components></object>' +
      '<object id="4" type="model"><components>' +
      '<component p:path="/3D/Objects/object_3.model" objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 0" />' +
      '</components></object>' +
      '</resources>' +
      '<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0" /><item objectid="4" /></build>' +
      '</model>';
    function objDatei(id) {
      return '<?xml version="1.0"?>' +
        '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>' +
        '<object id="' + id + '" type="model"><mesh>' +
        '<vertices><vertex x="0" y="0" z="0" /><vertex x="1" y="0" z="0" /><vertex x="0" y="1" z="0" /></vertices>' +
        '<triangles><triangle v1="0" v2="1" v3="2" /></triangles>' +
        '</mesh></object></resources><build /></model>';
    }
    const modelSettings = '<?xml version="1.0" encoding="UTF-8"?><config>' +
      '<object id="2"><metadata key="name" value="Deckel"/><metadata key="extruder" value="3"/>' +
      '<part id="1" subtype="normal_part"><metadata key="name" value="Deckel"/></part></object>' +
      '<object id="4"><metadata key="name" value="Boden"/><metadata key="extruder" value="1"/>' +
      '<part id="3" subtype="normal_part"><metadata key="extruder" value="2"/></part></object>' +
      '</config>';
    const projectSettings = JSON.stringify({ filament_colour: ['#FFFFFF', '#010101', '#F4EE2A'] });
    const zipBuf = zipMitDeflate([
      { name: '_rels/.rels', inhalt: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>' },
      { name: '3D/3dmodel.model', inhalt: haupt },
      { name: '3D/Objects/object_2.model', inhalt: objDatei(1) },
      { name: '3D/Objects/object_3.model', inhalt: objDatei(3) },
      { name: 'Metadata/model_settings.config', inhalt: modelSettings },
      { name: 'Metadata/project_settings.config', inhalt: projectSettings }
    ]);
    const geladen = await IO.parse3MF(zipBuf);
    check('2 Teile', geladen.length === 2, 'gefunden: ' + geladen.length);
    const deckel = geladen.find(function (t) { return t.name === 'Deckel'; });
    const boden = geladen.find(function (t) { return t.name === 'Boden'; });
    check('Namen aus model_settings', !!deckel && !!boden,
      geladen.map(function (t) { return t.name; }).join(','));
    check('Objekt-Extruder 3 -> gelb', deckel && deckel.farbe === '#f4ee2a', deckel && deckel.farbe);
    check('Part-Extruder 2 uebersteuert Objekt-Extruder', boden && boden.farbe === '#010101', boden && boden.farbe);
    check('Build-Transform angewandt', deckel && Math.abs(deckel.vertProperties[0] - 10) < 1e-4);
  }

  console.log('parse3MF: Bambu-Painting (paint_color) splittet nach Farbe:');
  {
    // paint_color-Codes aus einer ECHTEN Bambu-Datei (teil3-konstruktion_ex_bamb):
    // '0C' -> Zustand 3 (Filament 3), '6C' -> 9, '8C' -> 11. Zwei Dreiecke
    // Filament 3, eins Filament 9, eins unbemalt (faellt auf Objekt-Extruder 1).
    const haupt = '<?xml version="1.0"?>' +
      '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<resources><object id="2" type="model"><mesh>' +
      '<vertices>' +
      '<vertex x="0" y="0" z="0" /><vertex x="1" y="0" z="0" /><vertex x="0" y="1" z="0" />' +
      '<vertex x="2" y="0" z="0" /><vertex x="3" y="0" z="0" /><vertex x="2" y="1" z="0" />' +
      '</vertices>' +
      '<triangles>' +
      '<triangle v1="0" v2="1" v3="2" paint_color="0C" />' +
      '<triangle v1="3" v2="4" v3="5" paint_color="0C" />' +
      '<triangle v1="0" v2="2" v3="1" paint_color="6C" />' +
      '<triangle v1="3" v2="5" v3="4" />' +
      '</triangles>' +
      '</mesh></object></resources><build><item objectid="2" /></build></model>';
    const modelSettings = '<?xml version="1.0"?><config><object id="2">' +
      '<metadata key="name" value="Bemalt"/><metadata key="extruder" value="1"/></object></config>';
    const farben = [];
    for (let i = 0; i < 9; i++) farben.push('#111111');
    farben[0] = '#26a69a'; farben[2] = '#1a1a1a'; farben[8] = '#5a8dc8';
    const zipBuf = zipMitDeflate([
      { name: '3D/3dmodel.model', inhalt: haupt },
      { name: 'Metadata/model_settings.config', inhalt: modelSettings },
      { name: 'Metadata/project_settings.config', inhalt: JSON.stringify({ filament_colour: farben }) }
    ]);
    const geladen = await IO.parse3MF(zipBuf);
    check('3 Teile (Filament 3, 9 und unbemalt)', geladen.length === 3, 'gefunden: ' + geladen.length);
    const proFarbe = {};
    geladen.forEach(function (t) { proFarbe[t.farbe] = t.triVerts.length / 3; });
    check('Filament 3 -> schwarz, 2 Dreiecke', proFarbe['#1a1a1a'] === 2, JSON.stringify(proFarbe));
    check('Filament 9 -> blau, 1 Dreieck', proFarbe['#5a8dc8'] === 1);
    check('unbemalt -> Objekt-Extruder 1 (tuerkis), 1 Dreieck', proFarbe['#26a69a'] === 1);
    // Kompaktierte Teil-Meshes: keine verwaisten Vertices verschleppen
    check('Vertices pro Teil kompaktiert', geladen.every(function (t) {
      return t.vertProperties.length <= t.triVerts.length * 3 * 3;
    }));
  }

  console.log('parseOBJ/parseMTL: Roundtrip mit eigenem Export:');
  {
    const exp = IO.baueOBJ(teile, 'teil3-konstruktion.mtl');
    const farben = IO.parseMTL(exp.mtl);
    const geladen = IO.parseOBJ(exp.obj);
    check('2 Teile', geladen.length === 2, 'gefunden: ' + geladen.length);
    check('Namen', geladen[0].name === 'Roter_Keil' && geladen[1].name === 'Blauer_Keil',
      geladen.map(function (t) { return t.name; }).join(','));
    check('Material -> Farbe', farben[geladen[0].material] === '#ff0000' &&
      farben[geladen[1].material] === '#0000ff');
    check('Geometrie', geladen[0].triVerts.length === 3 &&
      Math.abs(geladen[0].vertProperties[3] - 10) < 1e-4);
  }

  console.log('parseOBJ: Fremddatei (Quad, negative Indizes, f a/b/c, g statt o):');
  {
    const obj = '# fremd\n' +
      'g Deckel\n' +
      'usemtl blau\n' +
      'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\n' +
      'f 1/1/1 2/2/2 3/3/3 4/4/4\n' +       // Quad mit vt/vn -> 2 Dreiecke
      'v 0 0 5\nv 10 0 5\nv 0 10 5\n' +
      'f -3 -2 -1\n';                        // negative Indizes: letzte 3 Vertices
    const geladen = IO.parseOBJ(obj);
    // Quad und Dreieck teilen Material+Gruppe -> EIN Teil
    check('1 Teil (gleiche Gruppe+Material)', geladen.length === 1, 'gefunden: ' + geladen.length);
    check('Quad trianguliert + Dreieck', geladen[0].triVerts.length === 9,
      'Indizes: ' + geladen[0].triVerts.length);
    check('negative Indizes aufgeloest', Math.abs(geladen[0].vertProperties[geladen[0].triVerts[6] * 3 + 2] - 5) < 1e-4);
    check('Gruppenname von g', geladen[0].name === 'Deckel');
  }

  console.log(failures === 0 ? 'ALLE CHECKS GRUEN' : failures + ' CHECK(S) ROT');
  process.exit(failures === 0 ? 0 : 1);
})();

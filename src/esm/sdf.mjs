/*
 * Signierte Distanz zu einem wasserdichten Dreiecksnetz.
 * Voraussetzung: Manifold-Ausgabe (verschweisste Eckpunkte, konsistente
 * Aussen-Windung) -- fuer beliebige STL-Soups ist das Vorzeichen undefiniert.
 * Vorzeichen ueber winkelgewichtete Pseudo-Normalen (Baerentzen/Aanaes):
 * POSITIV innen, negativ aussen -- die levelSet-Konvention von manifold-3d
 * (Koerper = Region sdf > level); der sdf-Test verifiziert das an der Kugel.
 */

const BLATT_MAX = 8;

export function baueSdf(vertProperties, triVerts) {
  const V = vertProperties, T = triVerts;
  const nT = (T.length / 3) | 0;

  // --- Pseudo-Normalen: Flaeche, Kante (Summe beider Flaechen), Ecke ------
  const fN = new Float64Array(nT * 3);
  const vN = new Float64Array(V.length);
  const kN = new Map();

  function kKey(a, b) { return a < b ? a * 4294967296 + b : b * 4294967296 + a; }
  function addKante(a, b, nx, ny, nz) {
    const key = kKey(a, b);
    const e = kN.get(key);
    if (e) { e[0] += nx; e[1] += ny; e[2] += nz; }
    else kN.set(key, [nx, ny, nz]);
  }
  function winkel(ux, uy, uz, vx, vy, vz) {
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
    if (lu < 1e-30 || lv < 1e-30) return 0;
    let c = (ux * vx + uy * vy + uz * vz) / (lu * lv);
    if (c > 1) c = 1; else if (c < -1) c = -1;
    return Math.acos(c);
  }

  for (let t = 0; t < nT; t++) {
    const ia = T[3 * t], ib = T[3 * t + 1], ic = T[3 * t + 2];
    const ax = V[3 * ia], ay = V[3 * ia + 1], az = V[3 * ia + 2];
    const bx = V[3 * ib], by = V[3 * ib + 1], bz = V[3 * ib + 2];
    const cx = V[3 * ic], cy = V[3 * ic + 1], cz = V[3 * ic + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-30) continue;   // degeneriertes Dreieck traegt keine Normale
    nx /= len; ny /= len; nz /= len;
    fN[3 * t] = nx; fN[3 * t + 1] = ny; fN[3 * t + 2] = nz;
    addKante(ia, ib, nx, ny, nz);
    addKante(ib, ic, nx, ny, nz);
    addKante(ic, ia, nx, ny, nz);
    const wa = winkel(e1x, e1y, e1z, e2x, e2y, e2z);
    const wb = winkel(ax - bx, ay - by, az - bz, cx - bx, cy - by, cz - bz);
    const wc = winkel(ax - cx, ay - cy, az - cz, bx - cx, by - cy, bz - cz);
    vN[3 * ia] += nx * wa; vN[3 * ia + 1] += ny * wa; vN[3 * ia + 2] += nz * wa;
    vN[3 * ib] += nx * wb; vN[3 * ib + 1] += ny * wb; vN[3 * ib + 2] += nz * wb;
    vN[3 * ic] += nx * wc; vN[3 * ic + 1] += ny * wc; vN[3 * ic + 2] += nz * wc;
  }

  // --- BVH ueber Dreieck-AABBs (Median-Split auf laengster Zentroid-Achse) --
  const idx = new Uint32Array(nT);
  const tMin = new Float64Array(nT * 3), tMax = new Float64Array(nT * 3);
  const mitte = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    idx[t] = t;
    for (let k = 0; k < 3; k++) {
      const a = V[3 * T[3 * t] + k], b = V[3 * T[3 * t + 1] + k], c = V[3 * T[3 * t + 2] + k];
      const mn = Math.min(a, b, c), mx = Math.max(a, b, c);
      tMin[3 * t + k] = mn; tMax[3 * t + k] = mx; mitte[3 * t + k] = (mn + mx) / 2;
    }
  }

  function baueKnoten(von, bis) {
    const kn = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
                 kinder: null, von: von, bis: bis };
    for (let i = von; i < bis; i++) {
      const t = idx[i];
      for (let k = 0; k < 3; k++) {
        if (tMin[3 * t + k] < kn.min[k]) kn.min[k] = tMin[3 * t + k];
        if (tMax[3 * t + k] > kn.max[k]) kn.max[k] = tMax[3 * t + k];
      }
    }
    if (bis - von <= BLATT_MAX) return kn;
    let achse = 0, spann = -1;
    for (let k = 0; k < 3; k++) {
      let mn = Infinity, mx = -Infinity;
      for (let i = von; i < bis; i++) {
        const z = mitte[3 * idx[i] + k];
        if (z < mn) mn = z;
        if (z > mx) mx = z;
      }
      if (mx - mn > spann) { spann = mx - mn; achse = k; }
    }
    idx.subarray(von, bis).sort((p, q) => mitte[3 * p + achse] - mitte[3 * q + achse]);
    const m = (von + bis) >> 1;
    kn.kinder = [baueKnoten(von, m), baueKnoten(m, bis)];
    return kn;
  }
  const wurzel = nT > 0 ? baueKnoten(0, nT) : null;

  // --- Naechster Punkt auf Dreieck (Ericson 5.1.5), mit Struktur-Kennung ---
  // feature: 0 Flaeche, 1..3 Ecke A/B/C, 4 Kante AB, 5 BC, 6 CA
  const np = { x: 0, y: 0, z: 0, feature: 0 };
  function naechsterPunkt(t, px, py, pz) {
    const ia = T[3 * t], ib = T[3 * t + 1], ic = T[3 * t + 2];
    const ax = V[3 * ia], ay = V[3 * ia + 1], az = V[3 * ia + 2];
    const bx = V[3 * ib], by = V[3 * ib + 1], bz = V[3 * ib + 2];
    const cx = V[3 * ic], cy = V[3 * ic + 1], cz = V[3 * ic + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { np.x = ax; np.y = ay; np.z = az; np.feature = 1; return; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { np.x = bx; np.y = by; np.z = bz; np.feature = 2; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      np.x = ax + v * abx; np.y = ay + v * aby; np.z = az + v * abz; np.feature = 4; return;
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { np.x = cx; np.y = cy; np.z = cz; np.feature = 3; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      np.x = ax + w * acx; np.y = ay + w * acy; np.z = az + w * acz; np.feature = 6; return;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      np.x = bx + w * (cx - bx); np.y = by + w * (cy - by); np.z = bz + w * (cz - bz); np.feature = 5; return;
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    np.x = ax + abx * v + acx * w; np.y = ay + aby * v + acy * w; np.z = az + abz * v + acz * w;
    np.feature = 0;
  }

  function abstand2Aabb(kn, px, py, pz) {
    let d2 = 0, d;
    d = kn.min[0] - px; if (d > 0) d2 += d * d; d = px - kn.max[0]; if (d > 0) d2 += d * d;
    d = kn.min[1] - py; if (d > 0) d2 += d * d; d = py - kn.max[1]; if (d > 0) d2 += d * d;
    d = kn.min[2] - pz; if (d > 0) d2 += d * d; d = pz - kn.max[2]; if (d > 0) d2 += d * d;
    return d2;
  }

  const stapel = [];
  return function sdf(p) {
    if (!wurzel) return -Infinity;
    const px = p[0], py = p[1], pz = p[2];
    let best2 = Infinity, qx = 0, qy = 0, qz = 0, qt = -1, qf = 0;
    stapel.length = 0;
    stapel.push(wurzel);
    while (stapel.length) {
      const kn = stapel.pop();
      if (abstand2Aabb(kn, px, py, pz) >= best2) continue;
      if (kn.kinder) { stapel.push(kn.kinder[0], kn.kinder[1]); continue; }
      for (let i = kn.von; i < kn.bis; i++) {
        const t = idx[i];
        naechsterPunkt(t, px, py, pz);
        const dx = px - np.x, dy = py - np.y, dz = pz - np.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best2) { best2 = d2; qx = np.x; qy = np.y; qz = np.z; qt = t; qf = np.feature; }
      }
    }
    let nx, ny, nz;
    if (qf === 0) { nx = fN[3 * qt]; ny = fN[3 * qt + 1]; nz = fN[3 * qt + 2]; }
    else if (qf <= 3) {
      const iv = T[3 * qt + (qf - 1)];
      nx = vN[3 * iv]; ny = vN[3 * iv + 1]; nz = vN[3 * iv + 2];
    } else {
      const i1 = T[3 * qt + (qf - 4)], i2 = T[3 * qt + ((qf - 3) % 3)];
      const e = kN.get(kKey(i1, i2)) || [0, 0, 0];
      nx = e[0]; ny = e[1]; nz = e[2];
    }
    const dist = Math.sqrt(best2);
    // Pseudo-Normale zeigt nach aussen: positives Skalarprodukt = aussen
    const skalar = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz;
    return skalar > 0 ? -dist : dist;
  };
}

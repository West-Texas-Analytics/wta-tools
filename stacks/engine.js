/* Parcel Stacks engine: read a parcel file in the browser, find stacks, and build the viewer data.
   A port of wta-stacks (wta-shell plugins/stacks). Keep the rules in step with the Python:
   - shapes are compared in a Texas State Plane zone in US feet (EPSG:2277 by default),
     every vertex rounded to 0.01 ft, repeated points dropped, exterior rings counter-clockwise,
     holes clockwise, each ring starting at its lowest vertex, parts sorted;
   - a stack is "exact" when the stored geometry bytes are identical on every row.
   Nothing here touches the network: the file is read from the visitor's own disk. */
(function (root) {
'use strict';

const deps = {};
const dep = n => deps[n] || root[n];

// ---------------------------------------------------------------- coordinate systems
const LCC = (l1, l2, l0, lon0, x0, y0) =>
  `+proj=lcc +lat_1=${l1} +lat_2=${l2} +lat_0=${l0} +lon_0=${lon0} +x_0=${x0} +y_0=${y0} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs`;
const UTM = (z, nad) => `+proj=utm +zone=${z} ${nad ? '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0' : '+datum=WGS84'} +units=m +no_defs`;
const KNOWN = {
  'EPSG:4326': { name: 'WGS 84 (latitude/longitude)', def: '+proj=longlat +datum=WGS84 +no_defs' },
  'EPSG:4269': { name: 'NAD83 (latitude/longitude)', def: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs' },
  'EPSG:2275': { name: 'NAD83 / Texas North (US ft)', def: LCC(36.18333333333333, 34.65, 34, -101.5, 200000, 1000000), zone: true },
  'EPSG:2276': { name: 'NAD83 / Texas North Central (US ft)', def: LCC(33.96666666666667, 32.13333333333333, 31.66666666666667, -98.5, 600000, 2000000), zone: true },
  'EPSG:2277': { name: 'NAD83 / Texas Central (US ft)', def: LCC(31.88333333333333, 30.11666666666667, 29.66666666666667, -100.3333333333333, 700000, 3000000), zone: true },
  'EPSG:2278': { name: 'NAD83 / Texas South Central (US ft)', def: LCC(30.28333333333333, 28.38333333333333, 27.83333333333333, -99, 600000, 4000000), zone: true },
  'EPSG:2279': { name: 'NAD83 / Texas South (US ft)', def: LCC(27.83333333333333, 26.16666666666667, 25.66666666666667, -98.5, 300000, 5000000), zone: true },
  'EPSG:26913': { name: 'NAD83 / UTM zone 13N', def: UTM(13, true) },
  'EPSG:26914': { name: 'NAD83 / UTM zone 14N', def: UTM(14, true) },
  'EPSG:26915': { name: 'NAD83 / UTM zone 15N', def: UTM(15, true) },
  'EPSG:32613': { name: 'WGS 84 / UTM zone 13N', def: UTM(13, false) },
  'EPSG:32614': { name: 'WGS 84 / UTM zone 14N', def: UTM(14, false) },
  'EPSG:32615': { name: 'WGS 84 / UTM zone 15N', def: UTM(15, false) },
  'EPSG:3081': { name: 'NAD83 / Texas State Mapping System', def: '+proj=lcc +lat_1=27.41666666666667 +lat_2=34.91666666666666 +lat_0=31.16666666666667 +lon_0=-100 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
  'EPSG:3083': { name: 'NAD83 / Texas Centric Albers Equal Area', def: '+proj=aea +lat_1=27.5 +lat_2=35 +lat_0=18 +lon_0=-100 +x_0=1500000 +y_0=6000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
  'EPSG:3857': { name: 'Web Mercator', def: null },   // proj4 ships this one
};
const ZONES = Object.keys(KNOWN).filter(k => KNOWN[k].zone);
const DEFAULT_DETECT = 'EPSG:2277';

/** Turn what a file says about its coordinates into {code, name, def}. Returns null when it says nothing. */
function resolveCrs(info) {
  if (!info) return null;
  const proj4 = dep('proj4');
  if (info.code && KNOWN[info.code]) {
    const k = KNOWN[info.code];
    return { code: info.code, name: k.name, def: k.def || proj4.defs(info.code) };
  }
  if (info.wkt) {
    const name = (/^\s*\w+\s*\[\s*"([^"]+)"/.exec(info.wkt) || [])[1] || 'from the file';
    try { proj4.Proj(info.wkt); } catch (e) { throw new Error(`This file's coordinate system (${name}) isn't one this page can read. Export it as latitude/longitude (EPSG:4326) or Texas State Plane and try again.`); }
    return { code: info.code || null, name, def: info.wkt };
  }
  if (info.code) throw new Error(`This file uses ${info.code}, which this page doesn't know. Export it as latitude/longitude (EPSG:4326) or Texas State Plane and try again.`);
  return null;
}

// ---------------------------------------------------------------- small helpers
const td = enc => { try { return new TextDecoder(enc); } catch (e) { return new TextDecoder('windows-1252'); } };
const ascii = u8 => { let s = ''; for (let i = 0; i < u8.length && u8[i]; i++) s += String.fromCharCode(u8[i]); return s; };
const plainStr = v => { const s = String(v).trim(); return s || null; };
function signedArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function inRing(pt, r) {
  let c = false; const x = pt[0], y = pt[1];
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** Drop the closing point a ring repeats; keep rings of 3+ points. */
function openRing(pts) {
  if (pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (a[0] === b[0] && a[1] === b[1]) pts.pop(); }
  return pts;
}
/** Shapefile rings → polygons: clockwise rings are outer rings, counter-clockwise ones are holes in the outer ring around them. */
function organize(rings) {
  const outer = [], holes = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    const a = signedArea(r);
    if (a < 0) outer.push({ r, a: -a }); else if (a > 0) holes.push(r);
  }
  if (!outer.length) return holes.map(h => [h]);
  const polys = outer.map(o => ({ rings: [o.r], a: o.a, ring: o.r }));
  for (const h of holes) {
    let best = null;
    for (const p of polys) if ((!best || p.a < best.a) && inRing(h[0], p.ring)) best = p;
    if (best) best.rings.push(h); else polys.push({ rings: [h], a: Math.abs(signedArea(h)), ring: h });
  }
  return polys.map(p => p.rings);
}
const yieldUI = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------- shapefile
function parseShp(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 100 || dv.getInt32(0, false) !== 9994) throw new Error('The .shp file is damaged (bad header).');
  const type = dv.getInt32(32, true), out = [];
  for (let o = 100; o + 8 <= u8.length;) {
    const len = dv.getInt32(o + 4, false) * 2, s = o + 8, e = Math.min(u8.length, s + len);
    o = s + len;
    if (len < 4) { out.push(null); continue; }
    const t = dv.getInt32(s, true);
    if (t !== 5 && t !== 15 && t !== 25) { out.push(null); continue; }
    const nParts = dv.getInt32(s + 36, true), nPts = dv.getInt32(s + 40, true);
    const pStart = s + 44, ptStart = pStart + nParts * 4;
    if (ptStart + nPts * 16 > e) { out.push(null); continue; }
    const rings = [];
    for (let k = 0; k < nParts; k++) {
      const a = dv.getInt32(pStart + k * 4, true), b = k + 1 < nParts ? dv.getInt32(pStart + (k + 1) * 4, true) : nPts;
      const r = [];
      for (let i = a; i < b; i++) r.push([dv.getFloat64(ptStart + i * 16, true), dv.getFloat64(ptStart + i * 16 + 8, true)]);
      rings.push(openRing(r));
    }
    const polys = organize(rings);
    out.push(polys.length ? { polys, raw: u8.subarray(s, ptStart + nPts * 16) } : null);
  }
  return { type, shapes: out };
}

function cpgEncoding(cpg, ldid) {
  const c = (cpg || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c === 'UTF8') return 'utf-8';
  if (/^(CP)?1252$|^WINDOWS1252$|^ANSI1252$/.test(c)) return 'windows-1252';
  if (/^(ISO)?88591$/.test(c)) return 'iso-8859-1';
  if (/^(CP)?(437|850)$/.test(c)) return 'windows-1252';
  if (ldid === 0x57 || ldid === 0x03) return 'windows-1252';
  return 'iso-8859-1';
}

function parseDbf(u8, cpg) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true);
  const dec = td(cpgEncoding(cpg, u8[29]));
  const fields = []; let off = 1;
  for (let o = 32; o + 32 <= hlen && u8[o] !== 0x0D; o += 32) {
    const f = { name: ascii(u8.subarray(o, o + 11)).trim(), type: String.fromCharCode(u8[o + 11]), len: u8[o + 16], dec: u8[o + 17], off };
    off += f.len; fields.push(f);
  }
  const records = [], deleted = [];
  for (let i = 0; i < n; i++) {
    const base = hlen + i * rlen;
    if (base + rlen > u8.length) break;
    deleted.push(u8[base] === 0x2A);
    const rec = {};
    for (const f of fields) {
      const b = u8.subarray(base + f.off, base + f.off + f.len);
      let v;
      if (f.type === 'N' || f.type === 'F') { const s = ascii(b).trim(); v = s && !/^\*+$/.test(s) && isFinite(+s) ? +s : null; }
      else if (f.type === 'D') { const s = ascii(b).trim(); v = /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; }
      else if (f.type === 'L') { const s = ascii(b).trim().toUpperCase(); v = 'TY'.includes(s) && s ? 'True' : 'FN'.includes(s) && s ? 'False' : null; }
      else v = plainStr(dec.decode(b).replace(/\0+$/, ''));
      rec[f.name] = v;
    }
    records.push(rec);
  }
  return { columns: fields.map(f => f.name), records, deleted };
}

function shapefileLayer(name, files) {
  return {
    name, kind: 'Shapefile',
    open() {
      if (!files.dbf) throw new Error(`${name}.shp has no .dbf beside it. Include the .dbf (and .prj) with the .shp.`);
      const shp = parseShp(files.shp), dbf = parseDbf(files.dbf, files.cpg ? td('utf-8').decode(files.cpg) : '');
      const geoms = [], raw = [], records = [];
      for (let i = 0; i < dbf.records.length; i++) {
        if (dbf.deleted[i]) continue;
        const s = shp.shapes[i] || null;
        geoms.push(s ? s.polys : null); raw.push(s ? s.raw : null); records.push(dbf.records[i]);
      }
      const wkt = files.prj ? td('utf-8').decode(files.prj).trim() : '';
      return { name, columns: dbf.columns, geoms, raw, records, crsInfo: wkt ? { wkt } : null };
    },
  };
}
const SHP_POLY = new Set([5, 15, 25]);

// ---------------------------------------------------------------- WKB (GeoPackage)
function parseWkb(u8, o0) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = o0;
  function geom() {
    const le = u8[o] === 1; o += 1;
    const t = dv.getUint32(o, le); o += 4;
    let base = t & 0xffff, hasZ = !!(t & 0x80000000), hasM = !!(t & 0x40000000);
    if (t & 0x20000000) o += 4;   // EWKB SRID
    const th = Math.floor(base / 1000); base %= 1000;
    if (th === 1 || th === 3) hasZ = true;
    if (th === 2 || th === 3) hasM = true;
    const dim = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
    const rd = () => { const v = dv.getUint32(o, le); o += 4; return v; };
    const ring = () => { const n = rd(), r = new Array(n); for (let i = 0; i < n; i++) { r[i] = [dv.getFloat64(o, le), dv.getFloat64(o + 8, le)]; o += 8 * dim; } return openRing(r); };
    if (base === 3) { const n = rd(), rs = []; for (let i = 0; i < n; i++) rs.push(ring()); return { kind: 'poly', polys: rs.length && rs[0].length >= 3 ? [rs.filter(r => r.length >= 3)] : [] }; }
    if (base === 6) { const n = rd(), ps = []; for (let i = 0; i < n; i++) { const g = geom(); if (g.kind === 'poly') ps.push(...g.polys); } return { kind: 'poly', polys: ps }; }
    return { kind: 'other' };
  }
  const g = geom();
  return g.kind === 'poly' && g.polys.length ? g.polys : null;
}
function gpkgGeom(blob) {
  if (!blob || blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) return null;
  const flags = blob[3];
  if (flags & 0x10) return null;   // empty
  const env = [0, 32, 48, 48, 64][(flags >> 1) & 7] || 0;
  const start = 8 + env, polys = parseWkb(blob, start);
  return polys ? { polys, raw: blob.subarray(start) } : null;
}

async function geopackageLayers(u8) {
  const init = dep('initSqlJs');
  if (!init) throw new Error('The GeoPackage reader did not load.');
  const SQL = await init({ locateFile: f => (deps.vendorBase || 'vendor/') + f });
  const db = new SQL.Database(u8);
  const q = (sql, p) => { const st = db.prepare(sql); if (p) st.bind(p); const rows = []; while (st.step()) rows.push(st.get()); st.free(); return rows; };
  let tables;
  try {
    tables = q(`SELECT c.table_name, g.column_name, g.geometry_type_name, c.srs_id FROM gpkg_contents c
                JOIN gpkg_geometry_columns g ON g.table_name = c.table_name WHERE c.data_type = 'features'`);
  } catch (e) { throw new Error('This .gpkg file has no GeoPackage feature tables.'); }
  return tables.filter(t => /POLYGON/i.test(String(t[2]))).map(([table, gcol, , srsId]) => ({
    name: table, kind: 'GeoPackage',
    open() {
      const info = q('PRAGMA table_info("' + table.replace(/"/g, '""') + '")');
      const pk = info.filter(c => c[5] && /^INT/i.test(c[2])).map(c => c[1]);
      const cols = info.map(c => ({ name: c[1], type: String(c[2]).toUpperCase() })).filter(c => c.name !== gcol && !(pk.length === 1 && c.name === pk[0]));
      const srs = q('SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys WHERE srs_id = ?', [srsId])[0];
      let crsInfo = null;
      if (srs && srsId > 0) {
        const code = String(srs[0]).toUpperCase() === 'EPSG' ? 'EPSG:' + srs[1] : null;
        crsInfo = code && KNOWN[code] ? { code } : (srs[2] && srs[2] !== 'undefined' ? { wkt: srs[2], code } : { code });
      }
      const st = db.prepare(`SELECT "${gcol.replace(/"/g, '""')}", ${cols.map(c => '"' + c.name.replace(/"/g, '""') + '"').join(', ') || 'NULL'} FROM "${table.replace(/"/g, '""')}"`);
      const geoms = [], raw = [], records = [];
      while (st.step()) {
        const r = st.get(), g = gpkgGeom(r[0]);
        geoms.push(g ? g.polys : null); raw.push(g ? g.raw : null);
        const rec = {};
        cols.forEach((c, k) => {
          let v = r[k + 1];
          if (v instanceof Uint8Array) v = null;
          else if (typeof v === 'string') { v = plainStr(v); if (v && /^DATE/.test(c.type)) v = v.slice(0, 10); }
          rec[c.name] = v ?? null;
        });
        records.push(rec);
      }
      st.free();
      return { name: table, columns: cols.map(c => c.name), geoms, raw, records, crsInfo };
    },
  }));
}

// ---------------------------------------------------------------- GeoJSON
function geojsonLayer(name, text) {
  return {
    name, kind: 'GeoJSON',
    open() {
      let gj;
      try { gj = JSON.parse(text); } catch (e) { throw new Error(`${name} isn't valid GeoJSON (${e.message}).`); }
      const feats = gj.type === 'FeatureCollection' ? gj.features || [] : gj.type === 'Feature' ? [gj] : [];
      const columns = [], seen = new Set();
      for (const f of feats) for (const k of Object.keys(f.properties || {})) if (!seen.has(k)) { seen.add(k); columns.push(k); }
      const geoms = [], raw = [], records = [];
      const poly = c => (c || []).map(r => openRing((r || []).map(p => [+p[0], +p[1]]))).filter(r => r.length >= 3);
      for (const f of feats) {
        const g = f.geometry; let polys = null;
        if (g && g.type === 'Polygon') { const p = poly(g.coordinates); polys = p.length ? [p] : null; }
        else if (g && g.type === 'MultiPolygon') { const p = (g.coordinates || []).map(poly).filter(p => p.length); polys = p.length ? p : null; }
        geoms.push(polys); raw.push(polys ? JSON.stringify(g.coordinates) : null);
        const rec = {}, pr = f.properties || {};
        for (const c of columns) {
          let v = pr[c];
          if (v == null) v = null;
          else if (typeof v === 'string') v = plainStr(v);
          else if (typeof v === 'boolean') v = v ? 'True' : 'False';
          else if (typeof v === 'object') v = JSON.stringify(v);
          rec[c] = v;
        }
        records.push(rec);
      }
      const nm = gj.crs && gj.crs.properties && gj.crs.properties.name;
      let crsInfo = { code: 'EPSG:4326' };
      if (nm) { const m = /EPSG:{1,2}(\d+)/i.exec(nm) || /CRS84/i.exec(nm) && [0, '4326']; if (m) crsInfo = { code: 'EPSG:' + m[1] }; }
      return { name, columns, geoms, raw, records, crsInfo };
    },
  };
}

// ---------------------------------------------------------------- open whatever was picked or dropped
const ext = n => (/\.([^.\/\\]+)$/.exec(n) || [])[1]?.toLowerCase() || '';
const stem = n => n.replace(/^.*[\/\\]/, '').replace(/\.[^.]+$/, '');

/** files: [{name, bytes: Uint8Array}] → {layers: [{name, kind, open()}]} */
async function openFiles(files) {
  let entries = [];
  for (const f of files) {
    if (ext(f.name) === 'zip') {
      const fflate = dep('fflate');
      let un;
      try { un = fflate.unzipSync(f.bytes, { filter: z => !/(^|\/)__MACOSX\//.test(z.name) && /\.(shp|dbf|prj|cpg|gpkg|geojson|json)$/i.test(z.name) }); }
      catch (e) { throw new Error(`${f.name} couldn't be unzipped (${e.message}).`); }
      for (const [n, b] of Object.entries(un)) entries.push({ name: n, bytes: b });
      if (!Object.keys(un).length) {
        const names = []; fflate.unzipSync(f.bytes, { filter: z => { names.push(z.name); return false; } });
        if (names.some(n => /\.gdb\//i.test(n))) throw new Error(`${f.name} holds a file geodatabase (.gdb). This page can't read those yet: in ArcGIS Pro, export the parcel layer to a shapefile or GeoPackage, or use the desktop tool.`);
        throw new Error(`${f.name} has no shapefile, GeoPackage or GeoJSON inside.`);
      }
    } else entries.push(f);
  }
  const layers = [], shp = {};
  for (const e of entries) {
    const x = ext(e.name);
    if (['shp', 'dbf', 'prj', 'cpg'].includes(x)) { const k = e.name.replace(/\.[^.]+$/, '').toLowerCase(); (shp[k] = shp[k] || { name: stem(e.name) })[x] = e.bytes; }
    else if (x === 'gpkg') layers.push(...await geopackageLayers(e.bytes));
    else if (x === 'geojson' || x === 'json') layers.push(geojsonLayer(stem(e.name), td('utf-8').decode(e.bytes)));
    else if (x === 'gdb' || x === 'gdbtable') throw new Error('File geodatabases (.gdb) can\'t be read here yet. In ArcGIS Pro, export the parcel layer to a shapefile or GeoPackage, or use the desktop tool.');
  }
  for (const s of Object.values(shp)) {
    if (!s.shp) continue;
    const dv = new DataView(s.shp.buffer, s.shp.byteOffset, s.shp.byteLength);
    if (s.shp.length >= 36 && SHP_POLY.has(dv.getInt32(32, true))) layers.push(shapefileLayer(s.name, s));
  }
  const loose = Object.values(shp).filter(s => !s.shp && s.dbf);
  if (!layers.length) {
    if (loose.length) throw new Error('Only the .dbf came through. Pick the .shp, .dbf and .prj together, or the whole zipped shapefile.');
    throw new Error('No polygon layer was found. Use a zipped shapefile, a GeoPackage (.gpkg) or GeoJSON with parcel polygons.');
  }
  return { layers };
}

// ---------------------------------------------------------------- fields
const CANDIDATES = {
  account: ['PROP_ID', 'PROPID', 'PROP_ID_TEXT', 'ACCOUNT', 'ACCOUNT_NUM', 'ACCT', 'ACCT_NUM', 'PID', 'PARCEL_ID', 'PARCELID'],
  geo_id: ['GEO_ID', 'GEOID', 'QUICKREF', 'QUICK_REF', 'MAP_ID', 'MAPID'],
  owner: ['OWNER_NAME', 'OWNERNAME', 'OWNER', 'FILE_AS_NAME', 'OWNER1', 'NAME'],
  legal: ['LEGAL_DESC', 'LEGALDESC', 'LEGAL_DESCRIPTION', 'LEGAL', 'LGL_DESC'],
  legal_acres: ['LEGAL_AREA', 'LEGAL_ACRE', 'LEGAL_ACRES', 'LGL_ACRES', 'ACRES', 'LAND_ACRES', 'DEED_ACRES'],
  land_use: ['STAT_LAND_USE', 'STAT_LAND_', 'STATE_CD', 'STATE_CODE', 'PTD_CODE', 'SPTB_CODE', 'LAND_USE', 'PROP_TYPE'],
  market_value: ['MKT_VALUE', 'MARKET_VALUE', 'MARKET', 'MKT_VAL', 'APPRAISED_VALUE', 'APPR_VALUE'],
  situs: ['SITUS_ADDR', 'SITUS', 'SITUS_ADDRESS', 'SITUS_FULL'],
};
const LABELS = { account: 'Account', geo_id: 'Geo ID', owner: 'Owner', legal: 'Legal', legal_acres: 'Legal acres', land_use: 'Land use', market_value: 'Market value', situs: 'Situs' };
const NUMERIC_ROLES = new Set(['legal_acres', 'market_value']);

function guessRoles(columns) {
  const byUpper = {}; columns.forEach(c => { byUpper[c.toUpperCase()] = byUpper[c.toUpperCase()] || c; });
  const found = {};
  for (const [role, names] of Object.entries(CANDIDATES)) for (const n of names) if (byUpper[n]) { found[role] = byUpper[n]; break; }
  return found;
}

// ---------------------------------------------------------------- likely cause
const CAUSES = {
  blank: { label: 'Blank owner and legal', kind: 'bad', color: '#7A5C99' },
  dump: { label: 'Catch-all shape (20+ rows)', kind: 'bad', color: '#8E2F22' },
  dup: { label: 'Duplicate account', kind: 'bad', color: '#C8553D' },
  split: { label: 'Different legals on one shape', kind: 'bad', color: '#D98A3D' },
  mineral: { label: 'Mineral interests', kind: 'ok', color: '#2E6F8E' },
  bpp: { label: 'Business personal property', kind: 'ok', color: '#5B7F3A' },
  mh: { label: 'Mobile home on land', kind: 'ok', color: '#6E8B3D' },
  utility: { label: 'Utility or pipeline', kind: 'ok', color: '#5D6B78' },
  undiv: { label: 'Same legal, different owners', kind: 'ok', color: '#4F7A8C' },
};
const DUMP_ROWS = 20, STATE_CODE = { G: 'mineral', L: 'bpp', M: 'mh', J: 'utility' };
const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function likelyCause(rows) {
  if (rows.some(r => !r.owner && !r.legal)) return 'blank';
  if (rows.length >= DUMP_ROWS) return 'dump';
  for (const r of rows) { const c = norm(r.land_use).slice(0, 1); if (STATE_CODE[c]) return STATE_CODE[c]; }
  const owners = new Set(rows.map(r => norm(r.owner))), legals = new Set(rows.map(r => norm(r.legal)));
  if (legals.size === 1) return owners.size === 1 ? 'dup' : 'undiv';
  return 'split';
}

// ---------------------------------------------------------------- shape comparison
/** numpy's round(x, 2): half to even on x*100. Returns hundredths of a foot as an integer. */
function hundredths(v) { const y = v * 100, f = Math.floor(y), d = y - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); }
function keyRing(r, ccw) {
  const out = [];
  for (const p of r) { const q = [hundredths(p[0]), hundredths(p[1])]; const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); }
  while (out.length > 1 && out[out.length - 1][0] === out[0][0] && out[out.length - 1][1] === out[0][1]) out.pop();
  if (out.length < 3) return out.join(';');
  if ((signedArea(out) > 0) !== ccw) out.reverse();
  let k = 0; for (let i = 1; i < out.length; i++) if (out[i][0] < out[k][0] || (out[i][0] === out[k][0] && out[i][1] < out[k][1])) k = i;
  return out.slice(k).concat(out.slice(0, k)).join(';');
}
function shapeKey(polys) {
  return polys.map(p => keyRing(p[0], true) + '|' + p.slice(1).map(h => keyRing(h, false)).sort().join('|')).sort().join('#');
}
function sameRaw(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function findStacks(geomsFt, raw) {
  const groups = new Map();
  geomsFt.forEach((g, i) => { if (!g) return; const k = shapeKey(g); const l = groups.get(k); if (l) l.push(i); else groups.set(k, [i]); });
  const stacks = [];
  for (const rows of groups.values()) if (rows.length >= 2) stacks.push({ rows, exact: !!raw && rows.every(i => sameRaw(raw[i], raw[rows[0]])) });
  stacks.sort((a, b) => b.rows.length - a.rows.length || a.rows[0] - b.rows[0]);
  return stacks;
}

// ---------------------------------------------------------------- geometry in feet
function makeProjector(src, detect) {
  const proj4 = dep('proj4'), dst = KNOWN[detect];
  if (!dst || !dst.zone) throw new Error(`${detect} isn't one of the Texas State Plane zones this page compares shapes in.`);
  const tr = proj4(src.def, dst.def);
  return p => tr.forward([p[0], p[1]]);
}
function polysArea(polys) { let a = 0; for (const p of polys) { a += Math.abs(signedArea(p[0])); for (const h of p.slice(1)) a -= Math.abs(signedArea(h)); } return a; }
function centroid(polys) {
  let A = 0, X = 0, Y = 0;
  for (const p of polys) p.forEach((r, k) => {
    let a = 0, x = 0, y = 0; const sgn = (signedArea(r) > 0) === (k === 0) ? 1 : -1;
    for (let i = 0, n = r.length; i < n; i++) { const P = r[i], Q = r[(i + 1) % n], c = P[0] * Q[1] - Q[0] * P[1]; a += c; x += (P[0] + Q[0]) * c; y += (P[1] + Q[1]) * c; }
    A += sgn * a / 2; X += sgn * x / 6; Y += sgn * y / 6;
  });
  if (!A) { const r = polys[0][0]; return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; }
  return [X / A, Y / A];
}
function simplifyRing(r, tol) {
  if (r.length <= 4) return r;
  const keep = new Uint8Array(r.length); keep[0] = keep[r.length - 1] = 1;
  const stack = [[0, r.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const ax = r[a][0], ay = r[a][1], dx = r[b][0] - ax, dy = r[b][1] - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = L ? ((r[i][0] - ax) * dx + (r[i][1] - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - r[i][0], ey = ay + t * dy - r[i][1], d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i; }
    }
    if (md > t2 && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = r.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : r;
}
const SCENE_FT = 10, GROUND_SIMPLIFY_FT = 4, MAX_CATEGORIES = 10;
const r1 = v => Math.round(v * 10) / 10;
function sceneRings(polys, cx, cy, simplify) {
  return polys.map(p => p.map((r, k) => {
    let q = simplify ? simplifyRing(r, simplify) : r;
    if ((signedArea(q) > 0) !== (k === 0)) q = q.slice().reverse();   // outer ring counter-clockwise, holes clockwise
    return q.map(([x, y]) => [r1((x - cx) / SCENE_FT), r1((y - cy) / SCENE_FT)]);
  }));
}

// ---------------------------------------------------------------- roads and towns (OpenStreetMap)
/** [south, west, north, east] in degrees around the parcels, from their extent in the detection CRS. */
function llBox(detect, minx, miny, maxx, maxy) {
  const proj4 = dep('proj4'), tr = proj4(KNOWN[detect].def, KNOWN['EPSG:4326'].def);
  const c = [[minx, miny], [minx, maxy], [maxx, miny], [maxx, maxy]].map(p => tr.forward(p));
  const r = v => Math.round(v * 1e4) / 1e4, pad = 0.01;
  return [r(Math.min(...c.map(p => p[1])) - pad), r(Math.min(...c.map(p => p[0])) - pad), r(Math.max(...c.map(p => p[1])) + pad), r(Math.max(...c.map(p => p[0])) + pad)];
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const ROAD_CLASS = { motorway: 'major', trunk: 'major', primary: 'major', motorway_link: 'major', trunk_link: 'major', primary_link: 'major',
  secondary: 'fm', secondary_link: 'fm', tertiary: 'fm', unclassified: 'local', residential: 'local' };
function overpassQuery(b) {
  const box = b.join(',');
  return `[out:json][timeout:90];(way["highway"~"^(${Object.keys(ROAD_CLASS).join('|')})$"](${box});node["place"~"^(city|town|village|hamlet)$"](${box}););out geom;`;
}
/** Ask OpenStreetMap (Overpass API) for roads and place names in the box. Only the box is sent. */
async function fetchOsm(bbox, fetchFn) {
  const f = fetchFn || dep('fetch').bind(root), q = overpassQuery(bbox);
  let last;
  for (const url of OVERPASS) {
    try {
      const r = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.elements)) throw new Error('unexpected answer');
      return j;
    } catch (e) { last = e; }
  }
  throw last || new Error('no answer');
}
/** OpenStreetMap JSON → {roads:[{cls, label, pts}], towns:[{name, kind, x, y}]} in the viewer's scene units. */
function contextFromOsm(osm, view) {
  const proj4 = dep('proj4'), tr = proj4(KNOWN['EPSG:4326'].def, KNOWN[view.detect_crs].def), [ox, oy] = view.origin_ft;
  const sc = (lon, lat) => { const q = tr.forward([lon, lat]); return [r1((q[0] - ox) / SCENE_FT), r1((q[1] - oy) / SCENE_FT)]; };
  const roads = [], towns = [];
  for (const el of osm.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way' && Array.isArray(el.geometry) && ROAD_CLASS[t.highway]) {
      const pts = el.geometry.filter(g => g && isFinite(g.lat) && isFinite(g.lon)).map(g => sc(g.lon, g.lat));
      if (pts.length >= 2) roads.push({ cls: ROAD_CLASS[t.highway], label: (t.ref || t.name || '').split(';')[0].trim(), pts });
    } else if (el.type === 'node' && t.name && isFinite(el.lat)) {
      const [x, y] = sc(el.lon, el.lat);
      towns.push({ name: t.name, kind: t.place, x, y });
    }
  }
  return { roads, towns, source: 'OpenStreetMap' };
}

// ---------------------------------------------------------------- build
function naturalCmp(a, b) {
  const ta = String(a).split(/(\d+)/).filter(Boolean), tb = String(b).split(/(\d+)/).filter(Boolean);
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const da = /^\d+$/.test(ta[i]), db = /^\d+$/.test(tb[i]);
    if (da && db) { const d = (+ta[i]) - (+tb[i]); if (d) return d; }
    else if (da !== db) return da ? -1 : 1;
    else if (ta[i] !== tb[i]) return ta[i] < tb[i] ? -1 : 1;
  }
  return ta.length - tb.length;
}
function colorFields(stacked, roles, extra) {
  const specs = [];
  const wanted = ['land_use', 'market_value', 'legal_acres'].filter(r => roles[r]).map(r => [LABELS[r], NUMERIC_ROLES.has(r)]).concat(extra.map(c => [c, null]));
  for (let [label, numeric] of wanted) {
    const vals = stacked.map(r => r[label]).filter(v => v != null && v !== '');
    if (!vals.length) continue;
    if (numeric === null) numeric = vals.every(v => typeof v === 'number');
    if (numeric) {
      const pos = vals.filter(v => typeof v === 'number' && v > 0);
      if (pos.length) specs.push({ key: label, type: 'num', min: Math.min(...pos), max: Math.max(...pos) });
    } else {
      const counts = new Map(); vals.forEach(v => counts.set(String(v), (counts.get(String(v)) || 0) + 1));
      const top = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, MAX_CATEGORIES);
      specs.push({ key: label, type: 'cat', values: top, other: counts.size > top.length });
    }
  }
  return specs;
}

/** layer: what a reader's open() returned. opts: {title, source, roles, extra, detect, crs, onProgress}. */
async function build(layer, opts) {
  const roles = opts.roles || guessRoles(layer.columns), extra = (opts.extra || []).filter(c => !Object.values(roles).includes(c));
  const detect = opts.detect || DEFAULT_DETECT, progress = opts.onProgress || (() => {});
  const src = opts.crs || resolveCrs(layer.crsInfo);
  if (!src) throw new Error('This file has no coordinate system (a shapefile without its .prj?). Pick the right one and build again.');
  const fwd = makeProjector(src, detect);
  progress(`Projecting ${layer.geoms.length.toLocaleString('en-US')} parcels to ${KNOWN[detect].name}…`); await yieldUI();
  const geomsFt = new Array(layer.geoms.length);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, bad = 0;
  for (let i = 0; i < layer.geoms.length; i++) {
    const g = layer.geoms[i];
    if (!g) { geomsFt[i] = null; continue; }
    geomsFt[i] = g.map(p => p.map(r => r.map(pt => {
      const q = fwd(pt);
      if (!isFinite(q[0]) || !isFinite(q[1])) bad++;
      else { if (q[0] < minx) minx = q[0]; if (q[0] > maxx) maxx = q[0]; if (q[1] < miny) miny = q[1]; if (q[1] > maxy) maxy = q[1]; }
      return q;
    })));
    if (i % 4000 === 3999) await yieldUI();
  }
  if (bad) throw new Error(`${bad.toLocaleString('en-US')} points couldn't be placed. The file's coordinate system (${src.name}) probably doesn't match its coordinates; pick the right one and build again.`);
  if (!isFinite(minx)) throw new Error('The layer has no usable polygons.');
  if (maxx - minx > 5280 * 600 || maxy - miny > 5280 * 600) throw new Error(`The parcels spread over ${Math.round((maxx - minx) / 5280).toLocaleString('en-US')} miles, which is more than a county. The coordinate system (${src.name}) probably doesn't match the coordinates; pick the right one and build again.`);
  progress('Comparing shapes…'); await yieldUI();
  const stacks = findStacks(geomsFt, layer.raw);
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;

  const tableRow = i => {
    const rec = layer.records[i], row = {};
    for (const [role, col] of Object.entries(roles)) row[LABELS[role]] = rec[col] ?? null;
    for (const c of extra) row[c] = rec[c] ?? null;
    if (row.Account == null) row.Account = `(row ${i + 1})`;
    return row;
  };
  const outStacks = [], stackRows = [];
  stacks.forEach((st, n) => {
    const g = geomsFt[st.rows[0]];
    const roleRows = st.rows.map(i => { const o = {}; for (const [role, col] of Object.entries(roles)) o[role] = layer.records[i][col] ?? null; return o; });
    const cause = likelyCause(roleRows);
    const order = st.rows.map(i => [i, tableRow(i)]).sort((a, b) => naturalCmp(a[1].Account, b[1].Account));
    const rows = order.map(o => o[1]), recs = order.map(o => layer.records[o[0]]);
    const [ccx, ccy] = centroid(g), acres = Math.round(polysArea(g) / 43560 * 100) / 100;
    outStacks.push({ polys: sceneRings(g, cx, cy, 0), acres, exact: st.exact, cause, cx: r1((ccx - cx) / SCENE_FT), cy: r1((ccy - cy) / SCENE_FT), rows, recs });
    for (const r of rows) stackRows.push({ stack: n + 1, rows_in_stack: rows.length, exact_match: st.exact ? 'yes' : 'no', shape_acres: acres, ...r });
  });
  progress('Drawing the ground layer…'); await yieldUI();
  const ground = geomsFt.filter(Boolean).map(g => sceneRings(g, cx, cy, GROUND_SIMPLIFY_FT));
  const stacked = outStacks.flatMap(s => s.rows);
  const fields = Object.keys(LABELS).filter(r => roles[r]).map(r => LABELS[r]).concat(extra);
  if (!fields.includes('Account')) fields.unshift('Account');
  const d = new Date();
  const view = {
    title: opts.title || `${layer.name} parcel stacks`,
    source: opts.source || `layer ${layer.name}`,
    built: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    parcels: layer.geoms.length,
    skipped: layer.geoms.filter(g => !g).length,
    detect_crs: detect,
    missing_roles: Object.keys(LABELS).filter(r => !roles[r]).map(r => LABELS[r]),
    empty_roles: Object.entries(roles).filter(([, col]) => layer.records.every(rec => rec[col] == null || rec[col] === '' || rec[col] === 0)).map(([r]) => LABELS[r]),
    fields, columns: layer.columns, causes: CAUSES,
    color_fields: colorFields(stacked, roles, extra),
    extent_ft: [Math.round(maxx - minx), Math.round(maxy - miny)],
    origin_ft: [cx, cy],
    bbox_ll: llBox(detect, minx, miny, maxx, maxy),
    ground, stacks: outStacks,
  };
  return { view, stackRows };
}

function stacksCsv(stackRows) {
  if (!stackRows.length) return 'stack,rows_in_stack,exact_match,shape_acres\n';
  const cols = []; for (const r of stackRows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const cell = v => { if (v == null) return ''; const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...stackRows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n';
}

const api = { deps, KNOWN, ZONES, DEFAULT_DETECT, CANDIDATES, LABELS, CAUSES, openFiles, resolveCrs, guessRoles, fetchOsm, contextFromOsm, overpassQuery, likelyCause, shapeKey, findStacks, build, stacksCsv };
root.WTAStacks = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

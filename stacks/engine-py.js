/* Parcel Stacks engine, Python edition: runs wta-stacks (wta-shell plugins/stacks), the same
   Python the desktop tool uses, inside the visitor's browser with Pyodide.
   It offers the same window.WTAStacks API as engine.js, so index.html and viewer.js don't change.
   Everything is served from this site (py/): the file is read in the browser and never uploaded.
   The one network call is fetchOsm, which asks OpenStreetMap for roads in the map area's corners. */
(function (root) {
'use strict';

const here = (document.currentScript && document.currentScript.src) || location.href;
const PY = new URL('py/', here).href;
const WHEEL = PY + 'wta_stacks-0.2.0-py3-none-any.whl';

const api = {
  engine: 'python', deps: {},
  KNOWN: {}, ZONES: [], DEFAULT_DETECT: 'EPSG:2277', LABELS: {}, CANDIDATES: {},
};
let web = null, overpassUrls = [];

/** Python's {error: "..."} answers become thrown Errors with the same wording the page shows. */
function answer(text) {
  const v = JSON.parse(text);
  if (v && !Array.isArray(v) && typeof v.error === 'string') throw new Error(v.error);
  return v;
}
/** An unexpected Python exception: keep its last line, not the traceback. */
function plainError(e) {
  if (e && e.constructor && e.constructor.name === 'PythonError') {
    const last = String(e.message).trim().split('\n').pop();
    return new Error(last.replace(/^\w+Error: /, ''));
  }
  return e;
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------------------------------------------------------------- start Python (begins as the page loads)
api.ready = (async () => {
  if (typeof root.loadPyodide !== 'function') {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PY + 'pyodide/pyodide.js'; s.onload = res;
      s.onerror = () => rej(new Error('The Python engine could not load. Check the internet connection and reload the page.'));
      document.head.append(s);
    });
  }
  const py = await root.loadPyodide({ indexURL: PY + 'pyodide/', stdout: () => {}, stderr: () => {} });
  await py.loadPackage(['numpy', 'shapely', 'pyproj', 'sqlite3', WHEEL], { messageCallback: () => {} });
  web = py.pyimport('wta_stacks.web');
  const info = JSON.parse(web.boot_info());
  Object.assign(api.KNOWN, info.KNOWN); api.ZONES.push(...info.ZONES); api.DEFAULT_DETECT = info.DEFAULT_DETECT;
  Object.assign(api.LABELS, info.LABELS); Object.assign(api.CANDIDATES, info.CANDIDATES);
  overpassUrls = info.OVERPASS;
  return api;
})();
api.ready.catch(() => {});   // reported by whichever call needs Python first

// ---------------------------------------------------------------- open files
/** files: [{name, bytes: Uint8Array}] → {layers: [{name, kind, open()}]} */
async function openFiles(files) {
  await api.ready;
  let found;
  try { found = answer(web.open_files(files.map(f => f.name), files.map(f => f.bytes))); }
  catch (e) { throw plainError(e); }
  return {
    layers: found.map((l, i) => ({
      name: l.name, kind: l.kind,
      open() {
        let L;
        try { L = answer(web.open_layer(i)); } catch (e) { throw plainError(e); }
        return { name: L.name, columns: L.columns, records: L.records, _i: i,
          geoms: L.shapes.map(s => (s ? 1 : null)),     // the page only counts these
          crsInfo: L.crs_text ? { text: L.crs_text } : null };
      },
    })),
  };
}

function resolveCrs(info) {
  if (!info) return null;
  const text = info.text || info.wkt || info.code;
  if (!text) return null;
  try { return answer(web.resolve(text)).crs; } catch (e) { throw plainError(e); }
}
function guessRoles(columns) { return answer(web.guess(JSON.stringify(columns))); }

// ---------------------------------------------------------------- build
/** layer: what open() returned. opts: {title, source, roles, extra, detect, crs, onProgress}. */
async function build(layer, opts) {
  await api.ready;
  const progress = opts.onProgress || (() => {});
  const o = { title: opts.title, source: opts.source, roles: opts.roles || guessRoles(layer.columns),
    extra: opts.extra || [], detect: opts.detect || api.DEFAULT_DETECT, crs: opts.crs ? opts.crs.def : null };
  let gen;
  try {
    gen = web.build_json(layer._i, JSON.stringify(o));
    for (;;) {
      const step = gen.next();
      if (step.done) return answer(step.value);
      progress(step.value); await nextFrame();
    }
  } catch (e) { throw plainError(e); }
  finally { if (gen && gen.destroy) gen.destroy(); }
}
function stacksCsv(stackRows) { return web.csv_text(JSON.stringify(stackRows)); }

// ---------------------------------------------------------------- roads and towns (OpenStreetMap)
function overpassQuery(bbox) { return web.overpass(JSON.stringify(bbox)); }
/** Ask OpenStreetMap (Overpass API) for roads and place names in the box. Only the box is sent. */
async function fetchOsm(bbox, fetchFn) {
  await api.ready;
  const f = fetchFn || root.fetch.bind(root), q = overpassQuery(bbox);
  let last;
  for (const url of overpassUrls) {
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
function contextFromOsm(osm, view) {
  return answer(web.context(JSON.stringify(osm), JSON.stringify({ detect_crs: view.detect_crs, origin_ft: view.origin_ft })));
}

Object.assign(api, { openFiles, resolveCrs, guessRoles, build, stacksCsv, overpassQuery, fetchOsm, contextFromOsm });
root.WTAStacks = api;
})(window);

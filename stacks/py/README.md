# Parcel Stacks: the Python engine

`engine-py.js` runs the **wta-stacks** Python package (wta-shell, `plugins/stacks`)
in the visitor's browser with [Pyodide](https://pyodide.org). It's the same code
the desktop `wta-stacks` command runs, so the website and the desktop tool can't
drift apart. Everything is served from this folder, and the parcel file never
leaves the browser.

Open the page with `?engine=py` to use it (`/stacks/?engine=py`, or
`/stacks/?c=r&engine=py` for a county page). Without the switch the page uses
`engine.js`, the older JavaScript port.

| File | What it is | License |
|---|---|---|
| `wta_stacks-0.2.0-py3-none-any.whl` | the wta-stacks package, built in wta-shell | WTA |
| `pyodide/` | Pyodide 0.27.7 (Python 3.12 in WebAssembly) with numpy, shapely, pyproj, sqlite3 and certifi | MPL-2.0 (`pyodide/LICENSE-pyodide.txt`); numpy BSD-3, shapely BSD-3, pyproj MIT, certifi MPL-2.0 |

## Updating

- **wta-stacks changed:** build the wheel in wta-shell and copy it here
  (see "Publishing to the tools website" in `plugins/stacks/README.md`). If the
  version number changed, update `WHEEL` in `../engine-py.js`.
- **New Pyodide version:** change `pyodide/VERSION` and push. The "Vendor
  Pyodide" workflow (`.github/workflows/vendor-pyodide.yml`) downloads that
  version and the packages above, checks each against Pyodide's own sha256 list,
  and commits them to the same branch.

Then run the browser tests: `python tests/run_all.py`.

## Size and speed

About 26 MB on the first visit (the browser keeps it after that). Starting
Python takes about 5 seconds; it starts as the page loads, while the visitor
picks a file. Runnels County (13,506 parcels) then takes about 5 seconds to
read and build, against about 1.5 seconds for `engine.js`.

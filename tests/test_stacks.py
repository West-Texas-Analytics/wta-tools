import threading, functools, http.server, sys, subprocess, json, re, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright
# Usage: python test_stacks.py SITE_DIR OUT_DIR   (run_all.py passes both)
# Uses made-up "Caprock CAD" parcels from make_test_parcels.py: 64 rows, 6 planted stacks, 32 stacked rows.
site=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2]).resolve()
d=str(out)+"/"; fx=out/"parcels"
subprocess.run([sys.executable,str(Path(__file__).with_name("make_test_parcels.py")),str(fx)],check=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
H=functools.partial(Quiet, directory=str(site))
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),H); threading.Thread(target=srv.serve_forever,daemon=True).start()
origin=f"http://127.0.0.1:{srv.server_address[1]}"; u=origin+"/stacks/"
ok=True
def check(l,c,x=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+l+(f"  [{x}]" if x else ""))
ROAD=[(31.27,-100.05),(31.27,-100.0)]; TOWN=(31.275,-100.03)   # near the made-up parcels (Texas Central, x 2.3M ft)
CAUSES=["Catch-all shape","Duplicate account","Same legal, different owners","Different legals on one shape","Mineral interests","Blank owner and legal"]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-gl=swiftshader","--enable-unsafe-swiftshader"])
    ctx=b.new_context(viewport={"width":1440,"height":950},accept_downloads=True)
    pg=ctx.new_page(); errs=[]; other=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.on("request",lambda r:None if r.url.startswith(origin) or "fonts.g" in r.url or "overpass" in r.url else other.append(r.url))
    # Roads and towns: answer the OpenStreetMap (Overpass) request with a stand-in road and town near the made-up parcels.
    osm_asks=[]
    def overpass(route):
        osm_asks.append(route.request.post_data or "")
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"elements":[
            {"type":"way","id":1,"tags":{"highway":"secondary","ref":"FM 9999"},"geometry":[{"lat":lat,"lon":lon} for lat,lon in ROAD]},
            {"type":"node","id":2,"lat":TOWN[0],"lon":TOWN[1],"tags":{"place":"town","name":"Caprock"}}]}))
    ctx.route(re.compile("overpass"), overpass)
    def open_file(name):
        pg.goto(u); pg.wait_for_timeout(300); pg.set_input_files("#file",str(fx/name))
        pg.wait_for_selector("#setup:not([hidden]), #err:not(:empty)",timeout=20000)
    def build():
        pg.click("#build"); pg.wait_for_selector("#viewerSec:not([hidden]), #err2:not(:empty)",timeout=30000); pg.wait_for_timeout(1200)
    def stats(): return " ".join(pg.inner_text("#stats").split())
    pg.goto(u); pg.wait_for_timeout(400); pg.screenshot(path=d+"stacks-pick.png")
    check("not listed for search engines", pg.get_attribute('meta[name="robots"]',"content")=="noindex")
    for name,kind in [("caprock.zip","Shapefile"),("caprock.geojson","GeoJSON"),("caprock.gpkg","GeoPackage")]:
        open_file(name)
        check(f"{name}: opens as {kind}", pg.is_visible("#setup") and kind in pg.text_content("#sFacts"), pg.text_content("#sFacts") or pg.text_content("#err"))
        check(f"{name}: coordinates from the file", "(from the file)" in pg.eval_on_selector("#sCrs","s=>s.options[s.selectedIndex].text"))
        picks={r:pg.input_value(f"#r_{r}") for r in ["account","owner","legal","land_use","market_value"]}
        check(f"{name}: columns recognised", picks=={"account":"PROP_ID","owner":"OWNER_NAME","legal":"LEGAL_DESC","land_use":"STATE_CD","market_value":"MKT_VALUE"}, picks)
        if name=="caprock.zip": pg.screenshot(path=d+"stacks-setup.png",full_page=True)
        build()
        check(f"{name}: 6 stacks, 32 rows, 64 parcels", stats().startswith("6 stacks 32 rows in stacks") and "64 parcels" in stats(), stats())
        leg=pg.text_content("#legend")
        check(f"{name}: every planted cause found", all(c in leg for c in CAUSES), leg)
    check("one-layer pick hidden for a GeoPackage with a point layer too", pg.locator("#sLayer").is_hidden())
    pg.click("#list button >> nth=0"); pg.wait_for_timeout(1500)
    check("roads and towns drawn", "1 roads, 1 places" in pg.text_content("#ctxNote"), pg.text_content("#ctxNote"))
    check("clicking the tallest stack shows its 22 rows", "22 rows on one footprint" in pg.text_content("#insp"))
    check("the rows box sits over the 3D view (no right-hand panel)", pg.locator("#view #insp").is_visible() and pg.locator(".panel.right").count()==0)
    pg.screenshot(path=d+"stacks-view.png")
    cv=pg.locator("#view canvas").bounding_box()
    for dy in (-400,300,-300,500):
        pg.mouse.move(cv["x"]+cv["width"]*0.9,cv["y"]+cv["height"]*0.85); pg.mouse.wheel(0,dy); pg.wait_for_timeout(150)
    pg.wait_for_timeout(600)
    off=pg.evaluate("window.__wtaStacks.orbitOffset()")
    check("zooming with a stack open keeps it the center of orbit", off is not None and off<1, off)
    pg.click("#insp tbody tr >> nth=0"); pg.wait_for_timeout(900)
    box=pg.text_content("#insp")
    check("clicking a row opens that slab's data", "Slab 1 of 22" in box and "All 22 rows" in box and "filled columns in the file" in box, box[:160])
    pg.click("#iUp"); pg.wait_for_timeout(500)
    check("slab above steps to the next slab", "Slab 2 of 22" in pg.text_content("#insp"))
    pg.screenshot(path=d+"stacks-slab.png")
    pg.click("#iBack"); pg.wait_for_timeout(300)
    check("back returns to the rows table", pg.locator("#insp tbody tr").count()==22)
    pg.click("#insp tbody tr >> nth=0"); pg.wait_for_timeout(300); pg.focus("#view canvas"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    check("Esc steps back from a slab to the rows", pg.locator("#insp tbody tr").count()==22)
    pg.locator("#minN").fill("5"); pg.dispatch_event("#minN","input"); pg.wait_for_timeout(200)
    pg.click("#bFit"); pg.wait_for_timeout(1500)
    check("Reset view closes the box and shows every stack again", pg.locator("#insp").is_hidden() and stats().startswith("6 stacks") and pg.input_value("#minN")=="2", stats())
    pg.click("#list button >> nth=0"); pg.wait_for_timeout(1500)
    with pg.expect_download() as dl: pg.click("#csv")
    csv=Path(dl.value.path()).read_text().strip().splitlines()
    check("CSV has a header and 32 rows", len(csv)==33 and csv[0].startswith("stack,rows_in_stack,likely_cause"), len(csv))
    open_file("caprock_noprj.zip")
    check("shapefile without .prj asks for coordinates", "Not in the file" in pg.eval_on_selector("#sCrs","s=>s.options[s.selectedIndex].text"))
    build(); check("building without coordinates explains why", "Pick the coordinate system" in pg.text_content("#err2"))
    pg.select_option("#sCrs","EPSG:2277"); build()
    check("…and builds once Texas Central is picked", stats().startswith("6 stacks 32 rows"), stats())
    open_file("fgdb.zip")
    check("file geodatabase gets a clear message", "file geodatabase" in pg.text_content("#err"), pg.text_content("#err"))
    open_file("caprock.zip"); pg.check("#remember"); build()
    pg.goto(u); pg.wait_for_timeout(500)
    check("remembered file offered after reload", pg.is_visible("#last") and pg.text_content("#lastName")=="caprock.zip")
    pg.click("#lastOpen"); pg.wait_for_selector("#setup:not([hidden])",timeout=20000); build()
    check("remembered file reopens", stats().startswith("6 stacks"), stats())
    pg.goto(u); pg.wait_for_timeout(400); pg.click("#lastForget"); pg.wait_for_timeout(300); pg.reload(); pg.wait_for_timeout(500)
    check("forget clears it", not pg.is_visible("#last"))
    check("file never leaves the page (only fonts and the OpenStreetMap map-area request)", not other, other[:3])
    sent=urllib.parse.unquote_plus(" ".join(osm_asks))
    check("OpenStreetMap is asked only for a map area", osm_asks and "out:json" in sent and not any(w in sent for w in ["SMITH","PROP_ID","BLK"]), sent[:120])
    m=ctx.new_page(); m.set_viewport_size({"width":390,"height":844}); m.goto(u); m.wait_for_timeout(500)
    check("phone: pick page fits", m.evaluate("document.documentElement.scrollWidth<=390"))
    m.set_input_files("#file",str(fx/"caprock.zip")); m.wait_for_selector("#setup:not([hidden])"); m.click("#build")
    m.wait_for_selector("#viewerSec:not([hidden])",timeout=30000); m.wait_for_timeout(1200)
    check("phone: viewer fits", m.evaluate("document.documentElement.scrollWidth<=390"), m.evaluate("document.documentElement.scrollWidth"))
    m.screenshot(path=d+"stacks-phone.png")
    check("no page errors", not errs, errs); b.close()
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)

#!/usr/bin/env python3
"""Link check for the WTA sites.

Renders each page in headless Chromium (so links built by JavaScript count, such as the
calendar's Comptroller form links and every "§ 41.44" Tax Code link), then:

  1. Outside links (Comptroller PDFs and pages, westtexasanalytics.com, ...) must answer.
  2. Links within the site must point at a page that exists in the repo.
  3. Every Tax Code deep link (/tax-code/#q=Sec. N) must name a section that is in the
     current Property Tax Code PDF (tax-code/edition.json), so a renumbered or repealed
     section gets caught.

Usage:
  python tests/check_links.py TOOLS_DIR [SITE_DIR] [--report report.md] [--offline] [--pdf FILE]

  TOOLS_DIR  checkout of wta-tools (tools.westtexasanalytics.com)
  SITE_DIR   checkout of wta-site (westtexasanalytics.com), optional
  --offline  skip outside links (useful where the network is restricted)
  --pdf      use a local copy of the Tax Code PDF instead of downloading it

Exit code 1 if anything is broken. Links that only refuse automated checks (401/403/429)
are listed as warnings and don't fail the run.
"""
import argparse, datetime, functools, http.server, json, re, socket, sys, threading, time, urllib.parse
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 WTA-link-check"
SKIP_HOSTS = {"fonts.googleapis.com", "fonts.gstatic.com", "www.w3.org"}
SITE_HOSTS = {"tools.westtexasanalytics.com": "tools", "westtexasanalytics.com": "site", "www.westtexasanalytics.com": "site"}


def serve(root):
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
    handler = functools.partial(type("Quiet", (http.server.SimpleHTTPRequestHandler,), {"log_message": lambda *a: None}), directory=str(root))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}"


def collect(browser, base, paths, found, site):
    """Open each page and record every link on it: found[url] = set of 'site page' strings."""
    for path in paths:
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.route(re.compile(r"https?://(?!127\.0\.0\.1).*"), lambda r: r.abort())  # don't let pages fetch the outside world
        page.goto(base + path, wait_until="load"); page.wait_for_timeout(800)
        hrefs = page.evaluate("""() => [
          ...[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
          ...[...document.querySelectorAll('meta[property="og:image"], meta[property="og:url"]')].map(m => m.content)]""")
        for h in hrefs:
            if not h or h.startswith(("mailto:", "tel:", "javascript:")) or h == "#":
                continue
            found.setdefault((h, site), set()).add(f"{site}:{path}")
        page.close()


def tools_pages(root):
    y = datetime.date.today().year
    pages = ["/", "/tax-code/", "/categories/", "/stacks/"]
    pages += [f"/tax-calendar/?view=list&year={yy}" for yy in (y, y + 1)]  # even and odd years show different rows
    return [p for p in pages if (root / p.split("?")[0].lstrip("/") / "index.html").exists() or p == "/"]


def check_outside(url):
    """Return (status, detail). status: ok | warn | broken."""
    last = ""
    for attempt in range(3):
        try:
            r = requests.head(url, headers={"User-Agent": UA}, allow_redirects=True, timeout=30)
            if r.status_code in (405, 400, 403, 404, 501) or r.status_code >= 500:  # some servers dislike HEAD
                r = requests.get(url, headers={"User-Agent": UA}, allow_redirects=True, timeout=45, stream=True); r.close()
            if r.status_code < 400:
                return "ok", f"{r.status_code}" + (f" → {r.url}" if r.url.rstrip('/') != url.rstrip('/') else "")
            if r.status_code in (401, 403, 429):
                last = f"HTTP {r.status_code} (site refused an automated check)"; status = "warn"
            else:
                last = f"HTTP {r.status_code}"; status = "broken"
            if r.status_code in (404, 410):
                return status, last
        except requests.RequestException as e:
            last, status = f"{type(e).__name__}: {e}"[:200], "broken"
        time.sleep(5 * (attempt + 1))
    return status, last


def section_numbers_in_pdf(pdf_path):
    import pypdf
    text = " ".join((p.extract_text() or "") for p in pypdf.PdfReader(str(pdf_path)).pages)
    text = re.sub(r"\s+", " ", text)
    return set(re.findall(r"Sec\. ?(\d+[A-Z]?\.\d+[A-Z]?)\.", text))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tools"); ap.add_argument("site", nargs="?")
    ap.add_argument("--report"); ap.add_argument("--offline", action="store_true"); ap.add_argument("--pdf")
    a = ap.parse_args()
    roots = {"tools": Path(a.tools).resolve()}
    if a.site: roots["site"] = Path(a.site).resolve()

    found = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for site, root in roots.items():
            collect(browser, serve(root), tools_pages(root) if site == "tools" else ["/"], found, site)
        browser.close()
    edition = json.loads((roots["tools"] / "tax-code/edition.json").read_text())
    found.setdefault((edition["url"], "tools"), set()).add("tools:/tax-code/edition.json")

    broken, warns, ok = [], [], []
    outside, internal, sections = {}, {}, {}
    for (href, site), where in found.items():
        u = urllib.parse.urlsplit(href)
        host = u.hostname or ""
        if u.scheme in ("http", "https") and host in SKIP_HOSTS:
            continue
        if not u.scheme or host in ("127.0.0.1",):
            target_site, path, frag = site, u.path, u.fragment
        elif host in SITE_HOSTS and SITE_HOSTS[host] in roots:
            target_site, path, frag = SITE_HOSTS[host], u.path, u.fragment
        else:
            outside.setdefault(href, set()).update(where); continue
        # Links within our own sites: the file must exist in the repo
        rel = urllib.parse.unquote(path or "/").lstrip("/")
        f = roots[target_site] / rel
        if f.is_dir() or rel == "": f = f / "index.html"
        internal.setdefault((target_site, "/" + rel), [f.exists(), set()])[1].update(where)
        q = urllib.parse.parse_qs(frag).get("q", [""])[0] if frag.startswith("q=") else ""
        m = re.fullmatch(r"Sec\. ?(\S+)", q)
        if rel.startswith("tax-code") and m:
            sections.setdefault(m.group(1), set()).update(where)

    for (site, path), (exists, where) in sorted(internal.items()):
        (ok if exists else broken).append((f"{site}{path}", "page exists" if exists else "missing page in repo", where))

    if sections:
        pdf = Path(a.pdf) if a.pdf else None
        if not pdf and not a.offline:
            pdf = Path("/tmp/wta-taxcode.pdf")
            r = requests.get(edition["url"], headers={"User-Agent": UA}, timeout=120); r.raise_for_status(); pdf.write_bytes(r.content)
        if pdf:
            have = section_numbers_in_pdf(pdf)
            for n, where in sorted(sections.items()):
                good = n in have
                (ok if good else broken).append((f"Tax Code § {n}", f"in the {edition['edition']} edition" if good else f"not found in the {edition['edition']} edition PDF", where))

    if not a.offline:
        for url, where in sorted(outside.items()):
            status, detail = check_outside(url)
            {"ok": ok, "warn": warns, "broken": broken}[status].append((url, detail, where))

    lines = [f"# WTA link check · {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M} UTC", "",
             f"{len(ok)} OK · {len(warns)} could not verify · {len(broken)} broken", ""]
    for title, rows in (("Broken", broken), ("Could not verify (site refused an automated check; open by hand)", warns)):
        if rows:
            lines += [f"## {title}", ""] + [f"- **{u}** — {d}  \n  on {', '.join(sorted(w))}" for u, d, w in rows] + [""]
    lines += ["<details><summary>Checked OK</summary>", ""] + [f"- {u} — {d}" for u, d, _ in ok] + ["", "</details>"]
    report = "\n".join(lines)
    print(report)
    if a.report: Path(a.report).write_text(report)
    sys.exit(1 if broken else 0)


if __name__ == "__main__":
    main()

"""Run every WTA Tools browser test against a temporary copy of the site.

    pip install -r tests/requirements.txt && python -m playwright install chromium
    python tests/run_all.py                       # all tests that don't need the real PDF
    python tests/run_all.py --pdf path/to/96-297-25.pdf   # also the real-PDF test

The tests start a local web server, drive headless Chromium, and print PASS/FAIL lines.
Screenshots land in tests/.out/ (ignored by git).
"""
import argparse, shutil, subprocess, sys, tempfile
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parent
ap = argparse.ArgumentParser()
ap.add_argument("--pdf", help="the Comptroller's Tax Code PDF (96-297-YY.pdf) for the real-PDF test")
args = ap.parse_args()

out = here / ".out"; out.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    site = Path(tmp) / "site"
    shutil.copytree(root, site, ignore=shutil.ignore_patterns(".git", "tests"))   # tests rewrite edition.json in the copy
    pdf25, pdf24 = out / "96-297-25.pdf", out / "96-297-24.pdf"
    subprocess.run([sys.executable, str(here / "make_test_pdf.py"), str(pdf25), str(pdf24)], check=True)
    runs = [
        ("Tax Code Search", ["test_tax_code.py", site, pdf25, pdf24, out]),
        ("Tax Calendar", ["test_tax_calendar.py", site, out]),
        ("Property Categories", ["test_categories.py", site, out]),
        ("Parcel Stacks", ["test_stacks.py", site, out]),
    ]
    if args.pdf:
        runs.append(("Tax Code Search, real PDF", ["test_tax_code_clear.py", site, Path(args.pdf).resolve()]))
    failed = []
    for label, (script, *a) in runs:
        print(f"\n=== {label} ===", flush=True)
        r = subprocess.run([sys.executable, str(here / script), *map(str, a)])
        if r.returncode: failed.append(label)
print("\n" + ("ALL SUITES PASS" if not failed else "FAILED: " + ", ".join(failed)))
sys.exit(1 if failed else 0)

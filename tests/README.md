# WTA Tools tests

Browser tests for the tools site. Each test starts a local web server on a temporary copy of the repo and drives headless Chromium with Playwright.

```bash
pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/run_all.py                                  # everything except the real-PDF test
python tests/run_all.py --pdf ~/Downloads/96-297-25.pdf  # also runs the test that needs the Comptroller's PDF
```

| Test | Covers |
|---|---|
| `test_tax_code.py` | Tax Code Search: edition detection and banners, result badges (1–99), badge overlay in the PDF, dismissing the notice, phone layout. Uses small stand-in PDFs from `make_test_pdf.py`. |
| `test_tax_code_clear.py` | Tax Code Search with the real PDF: clearing a search returns to page 1; typing while browsing keeps your place. |
| `test_tax_calendar.py` | Tax Calendar: weekend and holiday rollover (including Dec. 31 into January), leap years, even-year entries, audience and key-date filters, Tax Code and Comptroller form links, search by form number, `.ics` export and line folding, the wheel view, phone layout. |
| `test_categories.py` | Property Categories: search ranking for plain-English descriptions, code lookups, cross-links between categories, filters, deep links (`#J3`), phone layout. |
| `test_stacks.py` | Parcel Stacks: opening a zipped shapefile, GeoJSON and GeoPackage; column guesses; the six planted stacks and their likely causes; a shapefile with no `.prj`; a file geodatabase turned away; CSV download; remembering and forgetting a file; no requests leave the page; phone layout. Uses made-up Caprock CAD parcels from `make_test_parcels.py`. |

Run them after any change to a tool, and add a check when you fix a bug. Screenshots are written to `tests/.out/`.

## Weekly link check

`check_links.py` opens every page (so links built by JavaScript count), then checks that

- outside links answer: Comptroller form PDFs, the Tax Code PDF, the deadlines page, westtexasanalytics.com;
- links within the sites point at pages that exist;
- every Tax Code link (`/tax-code/#q=Sec. N`) names a section that is in the current Property Tax Code PDF (`tax-code/edition.json`), so a renumbered or repealed section shows up.

It runs every Monday morning from `.github/workflows/link-check.yml` (and on demand from the Actions tab, "Link check" → "Run workflow"). When something breaks it opens an issue labeled `link-check`, adds the new report to that issue each week until it's fixed, and closes it when a run passes. Sites that refuse automated checks (HTTP 401/403/429) are listed as warnings and don't fail the run.

```bash
python tests/check_links.py . ../wta-site                       # both sites
python tests/check_links.py . --offline --pdf ~/Downloads/96-297-25.pdf   # just the internal links and sections
```

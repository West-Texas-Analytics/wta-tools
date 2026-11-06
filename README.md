# WTA Tools

Free tools from West Texas Analytics, LLC, published at **https://tools.westtexasanalytics.com** with GitHub Pages.

| Path | What it is |
|---|---|
| `/` | Landing page listing the tools |
| `/tax-code/` | Property Tax Code Search: visitors open the Comptroller's PDF in their own browser and search it. Nothing is uploaded. |
| `/tax-calendar/` | Texas Property Tax Calendar: statutory deadlines for any year, rolled to the next business day for weekends and holidays (§ 1.06), with audience filters and .ics export. Two views: a list, and a wheel of the tax year (phases as wedges, key dates as notches; `?view=wheel`). |
| `/categories/` | State Property Categories: searchable state property category codes with descriptions, examples and edge cases. |
| `/stacks/` | Parcel Stacks (unlisted, `noindex`): open a district's parcel file (zipped shapefile, GeoPackage or GeoJSON) and see every parcel as ground with same-shape rows stacked as 3D slabs. The file is read in the browser and never uploaded. Browser port of `wta-stacks` in wta-shell (`plugins/stacks`); keep the stack rule, causes and column names in step with it. Libraries are vendored in `stacks/vendor/`. |

Section numbers in the calendar and category lookup link into the Tax Code Search with `/tax-code/#q=Sec.%2041.44`, which opens the PDF at that section.

## Keeping the data current

- **Calendar** (`tax-calendar/index.html`, the `D` list near the top of the script): one line per deadline, `[month, day, title, audiences, sections, options]`, from the Comptroller's [Property Tax Law Deadlines](https://comptroller.texas.gov/taxes/property-tax/calendars/deadlines.php). Recheck after each legislative session. Holidays counted for § 1.06 are in `holidays()`.
- **Categories** (`categories/index.html`, the `C` list): summarized from the Comptroller's *Property Classification Guide*, Publication 96-313 (March 2026 edition). Recheck when a new edition is posted.

## When the Comptroller posts a new Tax Code PDF

The search tool reads `tax-code/edition.json` to know which copy is current. When a visitor's saved PDF is an older edition, or an older copy of the current edition, the tool shows a banner telling them to download the new file. To update it, edit only `tax-code/edition.json` (pencil icon on GitHub, then **Commit changes**):

```json
{
  "edition": 2025,
  "file": "96-297-25.pdf",
  "url": "https://comptroller.texas.gov/taxes/property-tax/docs/96-297-25.pdf",
  "bytes": 3228704,
  "posted": "2026-01-07"
}
```

- `edition`: the year printed on the cover ("TEXAS PROPERTY TAX CODE 2025 EDITION").
- `file` / `url`: the Comptroller's file name and download link.
- `bytes`: exact file size in bytes (Finder → Get Info, or the size from the download).
- `posted`: the date the Comptroller posted that file (YYYY-MM-DD).

The live site updates a minute or two after the commit.

## Files

- `CNAME`: custom domain for GitHub Pages (`tools.westtexasanalytics.com`). DNS is a CNAME record `tools` → `kerrymcclain.github.io` at GoDaddy.
- `.nojekyll`: serve the files as-is.
- `favicon-32.png`, `apple-touch-icon.png`: Twin Buttes site icon.

## Tests

Browser tests for every tool live in [`tests/`](tests/README.md). Run `python tests/run_all.py` after any change (add `--pdf path/to/96-297-25.pdf` to include the real-PDF test).

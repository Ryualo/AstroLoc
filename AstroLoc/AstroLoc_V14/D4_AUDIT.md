# AstroLoc Phase 1 — D4 Water, Ice & Subsurface Upgrade: Architecture Audit

**Date:** 2026-11-15 · **Scope:** Read-only audit. No code modified.

---

## 1. Existing Architecture (D1–D5)

Two parallel applications coexist in the repo:

| Component | Path | Role |
|---|---|---|
| **AstroLoc v9 (monolith)** | `astroloc_planetary_analog_discovery_platform_v9.html` (~6,000 lines) | 5D scoring engine, 27+ curated Earth analog sites, NASA POWER / Open-Meteo / USGS 3DEP / Macrostrat / Nominatim live fetch, CSV/JSON/MD export |
| **Planetary Explorer v2 (modular)** | `planetary-explorer/` (ES modules) | 3-body globe (Earth/Moon/Mars), PDS4 search, global DEM loaders, terrain comparison workbench |
| **Node proxy** | `proxy-server.js` | SSRF allowlist, key injection, 8.5 s timeout, 60 RPM rate limit |
| **Python proxy** | `planetary-explorer/server.py` | Static server + allowlisted HTTPS proxy (port 8082) |
| **Data provenance schema** | `astroloc-planetary-data.js` | Dataset registry + Mars/Moon D1–D5 reference benchmarks with epistemic classes (MEASURED/DERIVED/INFERRED/UNAVAILABLE) |

### D4 scoring engine (v9 monolith, lines ~2393–2415)
D4 = weighted mean of three site-level metrics:
- `lavaTubeScore` (0–100 idx) — weight `ideal.lavaTubeWeight × 0.75` (Mars 0.55, Moon 0.95)
- `iceCaveScore` (0–100 idx) — weight `ideal.iceCaveWeight × 0.75` (Mars 0.45, Moon 0.05)
- `shieldingDepth` (m) — weight 0.25; 100 if ≥ `ideal.shieldingTarget` (Mars 6 m, Moon 8 m), else linear decay to 15 floor

All three are **curated/literature values** (epistemic tag `inferred`), not live-computed. The `astroloc-planetary-data.js` registry explicitly marks planetary D4 as `UNAVAILABLE` in-situ and cites SHARAD/Mini-RF/LCROSS only as narrative provenance — no live data path exists for D4 today.

### Reusable infrastructure (preserved, no changes needed)
- `DataManager.httpFetch()` — bounded-retry proxy client → all new fetches should reuse it
- `searchPDS()` / `buildPDSQuery()` — PDS4 registry search already supports mission + instrument filters (`sharad`, `themis`, `diviner` keys already exist in `PDS_INSTRUMENT_NAMES`)
- `CacheManager` — IndexedDB raster cache; suitable for cached derived rasters
- `DEMProcessor` — binary `.img` (int16) + ESRI ASCII + CSV parsers; `cropGeographicGrid`/`downsampleGeographicGrid` handle any equirectangular grid
- `ComparisonEngine.computeDatasetMetrics()` — 5-point finite-difference slope/relief; body-agnostic (works for any `PLANETARY_CRS` entry)
- Proxy allowlists: `proxy-server.js` `ALLOWED_SCIENTIFIC_HOSTS` and `server.py` `ALLOWED_HOSTS` (both must be extended for any new host)

---

## 2. Dataset Mapping (verified against documentation)

### Mars

| Source | Measures | Access (verified) | Resolution | Limitations | Integrable? |
|---|---|---|---|---|---|
| **MRO SHARAD** | Subsurface radar sounder: water/ice in first few hundred meters; radargrams + clutter simulations | PDS4 bundles `urn:nasa:pds:mro_sharad_us_radargrams`, `urn-nasa-pds-mro_sharad_simulations` (PDS Geosciences Node); PDS3 volumes MROSH_0001–0004 (EDR) / MROSH_1001–1004 (RDR); Mars Orbital Data Explorer for search/display | ~3–5 m vertical, ~0.3–1 km along-track footprint | **No point/REST API** — bulk archive + ODE web tool only; radargram interpretation non-trivial (clutter vs. real reflectors); no global gridded ice-depth product | ⚠️ Partial — feasible as *curated extraction* (pre-published ice-table depths), not live query |
| **Mars Odyssey THEMIS** | IR day/night brightness temperature; derived thermal inertia (ice/cemented ground indicator) | THEMIS Data Node (ASU Mars Image Explorer), JMARS, PDS Imaging Node | 100 m/px IR (day/night); ~2.4 km thermal-inertia derived products | Search is web-tool based, not REST; thermal-inertia mosaics are large bulk downloads; night-time IR needed for ice detection | ⚠️ Partial — curated/derived values, or WMTS basemap overlay via existing `trek.nasa.gov` pattern |
| **NASA PDS (registry)** | Product-level metadata for all missions | `https://pds.mcp.nasa.gov/api/search/1` — **already integrated** (`DataManager.searchPDS`) | Product-level | Registry returns metadata, not measurement values | ✅ Already working |

### Moon

| Source | Measures | Access (verified) | Resolution | Limitations | Integrable? |
|---|---|---|---|---|---|
| **LRO Diviner** | Bolometric surface temperature (7 IR channels + solar); cold-trap/PSR ice-stability mapping | PDS4 bundles LRODLR_0001/0002 (EDR), LRODLR_1001/1002 (RDR); derived GDR/GCP/PCP/PRP/RCP/GHRM bundles; Lunar Orbital Data Explorer | 200–320 m/px; GHRM mosaics higher | RDR channels 1–2 mostly missing since 2019-04-17 (`tb = -9999`); no REST point API — ODE web tool + bulk files | ⚠️ Partial — GDR/PCP derived temperature grids are the practical product; load as raster like LOLA/MOLA DEMs |
| **LRO Mini-RF** | X/S-band radar CPR — polar ice signature, subsurface voids | **NOT VERIFIED** — `pds-geosciences.wustl.edu/missions/lro/minirf.htm(l)` returned HTTP 404 on both attempts (2-attempt stop rule invoked) | — | Cannot confirm product bundles or access path from documentation | ❌ Blocked this phase — retain existing curated `LRO_MINIRF_LCROSS_SUBSURFACE` registry entry as provenance only |
| **NASA PDS (registry)** | As Mars | Same API, `target=Moon` | — | — | ✅ Already working |

### Earth

| Source | Measures | Access (verified) | Resolution | Limitations | Integrable? |
|---|---|---|---|---|---|
| **NASA POWER** (already integrated) | T2M, precip, UV + hydrology params (soil moisture, frost) | `power.larc.nasa.gov/api/temporal/climatology/point` — REST, no key; documented HTTP 429 rate limit | 0.5° × 0.625° | Reanalysis grid, not in-situ; hydrology parameter table not verified (404 ×2) — confirm parameter codes before use | ✅ Extend existing provider |
| **GRACE / GRACE-FO mascons** | Terrestrial water storage anomaly → groundwater depletion proxy | PO.DAAC / Earthdata Cloud; current version **RL06.3Mv04** (RL06Mv02 retired); `podaac-data-subscriber`, OPeNDAP, direct S3; **Earthdata Login required** (protected bucket) | ~3° mascon cells (~300 km) | Auth + netCDF processing; coarse; monthly; not browser-fetchable point API | ⚠️ Partial — viable only as backend/CLI-preprocessed derived layer |
| **GLDAS** (GES DISC) | Soil moisture, snow water equivalent, runoff — cryo/groundwater context | GES DISC (HTTPS, GDS/OPeNDAP, Giovanni); NetCDF/GeoTIFF/KMZ; Earthdata Login for programmatic access | 0.25° / 1.0° | Auth required; modeled (not observed); large files | ⚠️ Partial — preprocess → static derived raster |
| **Randolph Glacier Inventory v7 (NSIDC-0770)** | Global glacier outlines (extent polygons) | HTTPS file system download; Shapefile/CSV/JSON; WGS84; DOI `10.5067/F6JMOVY5NAVZ`; citation required, no key | varies (Landsat/SPOT-derived) | Static snapshot (1950–2021 outlines); not a time series; shapefile parsing needed | ✅ Yes — one-time static asset; point-in-polygon test for glacier proximity |
| **Circum-Arctic Permafrost & Ground-Ice Map v2 (NSIDC GGD318)** | Permafrost extent % + ground-ice content classes | FTP (`sidads.colorado.edu`) / file system; Shapefile + EASE-Grid; DOI `10.7265/skbg-kf16`; citation required | ~1:10M source map | **FTP-only access** (no native browser FTP); coarse; Northern Hemisphere 28–90°N only | ⚠️ Partial — convert once to GeoJSON, then fully integrable |
| **USGS 3DEP / Copernicus GLO-30** (already integrated) | Elevation → slope, relief, pit/skylight geometry hints | Existing EPQS + Open-Meteo elevation providers | 10 m / 30 m | Cannot resolve meter-scale skylights (documented limitation) | ✅ Already working |

---

## 3. Implementation Plan (Phase 2, preserving architecture)

**Principle:** all new data flows through existing seams — `DataManager.httpFetch` (client), proxy allowlists (server), `astroloc-planetary-data.js` registry (provenance), `CacheManager` (rasters). No architectural changes.

1. **Registry additions** (`astroloc-planetary-data.js`): add verified entries — `MRO_SHARAD_RADARGRAMS`, `ODYSSEY_THEMIS_IR`, `LRO_DIVINER_GDR`, `NSIDC_RGI_V7`, `NSIDC_GGD318`, `GRACE_GRFO_MASCON_RL063`, `GLDAS_NOAH` — each with DOI/URL, resolution, coverage, citation string.
2. **Earth D4 enrichment (live/static, low risk):**
   - Bundle RGI 7.0 + GGD318 (converted once to GeoJSON) as static assets; add point-in-polygon glacier/permafrost/ground-ice tests feeding `iceCaveScore` and a new `permafrostClass` metric (DERIVED provenance).
   - Extend the NASA POWER provider with hydrology parameters (soil moisture/frost) after confirming parameter codes from the official POWER parameter table.
3. **Mars D4 (curated-derivative approach):** pre-extract SHARAD-published ice-table depths and THEMIS thermal-inertia classes for the existing landmark set into a static JSON layer (provenance: SHARAD bundle URN + citation). No live radargram processing in-browser.
4. **Moon D4:** load Diviner GDR/PCP bolometric temperature grids through the existing `DEMProcessor` binary-raster path (same pattern as LOLA `LDEM_4.IMG`) → cold-trap persistence metric for `iceCaveScore` (DERIVED).
5. **Proxy allowlist updates:** add `pds-geosciences.wustl.edu` and `pds.lroc.asu.edu` to `proxy-server.js` `ALLOWED_SCIENTIFIC_HOSTS` (`server.py` already covers `pds-geosciences.wustl.edu`).
6. **UI:** surface new D4 sub-metrics in the existing `d4Metrics` array and epistemic-badge system — no new panels required.

### Integration dependencies
- Earthdata Login account (GRACE, GLDAS) — server-side or one-time preprocessing only
- One-time GeoJSON conversion of RGI 7.0 / GGD318 (GDAL/OGR or equivalent, offline)
- SHARAD ice-depth extraction from published literature / bundle browse products (offline, curated)
- Diviner GDR binary layout confirmation from the RDR/GDR SIS PDF before writing a parser

### Blockers (per stop rules)

| Blocker | Status |
|---|---|
| **LRO Mini-RF** | ❌ Documentation unverifiable (404 on both PDS Geosciences attempts). Keep curated registry entry only; do not invent endpoints. |
| **PDS API docs** (`pds.nasa.gov/api`, `nasa-pds.github.io/pds-api`) | ⚠️ Both fetches failed (503 / fetch failure). The existing `searchPDS` integration is already in the codebase and presumed functional; re-verify docs before extending queries. |
| **POWER hydrology parameter codes** | ⚠️ Methodology page 404 ×2; parameter table must be confirmed before adding parameters. |
| **THEMIS / SHARAD live point query** | ❌ No REST API exists — only web tools (ODE, Mars Image Explorer, JMARS) and bulk archives. Live integration impossible; curated-derivative is the only path. |
| **GRACE / GLDAS in-browser fetch** | ❌ Earthdata auth + netCDF — not feasible client-side; backend/preprocessing only. |

### Licensing summary
- **NASA PDS data:** NASA data are generally in the public domain; PDS requires data citation (DOIs provided per bundle).
- **NSIDC (RGI 7.0, GGD318):** free, citation mandatory (DOIs above).
- **PO.DAAC / GRACE, GES DISC / GLDAS:** free with Earthdata Login; citation required.
- **Open-Meteo / Macrostrat / Nominatim / USGS EPQS:** already in use under their existing terms (CC-BY / ODbL / public domain respectively).

---

## 4. Verification record (2-attempt rule applied)

| Source | Attempt 1 | Attempt 2 | Outcome |
|---|---|---|---|
| SHARAD (Geosciences Node) | ✅ verified | — | Documented |
| THEMIS (Geosciences Node + ASU) | ✅ verified | — | Documented |
| Diviner (Geosciences Node) | ✅ verified | — | Documented |
| Mini-RF | ❌ 404 (`minirf.htm`) | ❌ 404 (`minirf.html`) | **Blocked** |
| PDS API docs | ❌ fetch failure | ❌ 503 | **Blocked** (existing code integration stands) |
| NASA POWER API overview | ✅ verified | — | Documented |
| POWER hydrology methodology | ❌ 404 | ❌ 404 | **Blocked** (parameter codes TBD) |
| GRACE-FO mascons (PO.DAAC) | ✅ verified | — | Documented |
| RGI v7 (NSIDC-0770) | ✅ verified | — | Documented |
| GGD318 permafrost | ❌ 404 (frozen-ground index) | ✅ verified (direct dataset page) | Documented |
| GLDAS (ldas.gsfc.nasa.gov) | ✅ verified | — | Documented |

# AstroLoc Side-by-Side Terrain Fixes

Updated from the supplied `AstroLoc_Planetary_Explorer_Comparison_Terrain_Camera_Patched(2).zip` and the accompanying 2026-11-15 Gemini audit.

## Targeted files and changes

1. `src/terrain/TextureManager.js`
   - Passes the canonical planetary body key into `_stitchEquirectangularWmtsLayer`.
   - Removes the out-of-scope `provider` reference that caused regional imagery stitching to throw.
   - Ensures the global image is loaded before building the overview underlay and uses the DEM-aligned bounds for fallback cropping.
   - Keeps the bounded worker pool and one retry per tile. Tile matrix dimensions use the 2:1 global equirectangular matrix convention represented by the configured Earth GIBS EPSG:4326 and NASA Trek EQ sources. This was cross-checked against NASA's published GIBS/Trek tile documentation; live endpoint responses were not tested.

2. `src/terrain/TerrainCropper.js`
   - Reworks `cropGeographicGrid` so output metadata describes the actual first/last sampled grid coordinates rather than requested edges.
   - Supports both edge-origin rasters and rasters explicitly marked `sampleCoordinatesAreCenters`.
   - Preserves unwrapped longitude progression across the antimeridian and keeps `bbox`, `lonSpan`, `latSpan`, and grid spacing consistent with the generated samples.

3. `src/terrain/DEMProcessor.js`
   - Changes the Earth SRTM output metadata to report the actual sample-centre extent of the generated grid.
   - Adds `sampleCoordinatesAreCenters` so subsequent crops interpret the SRTM grid consistently.

4. `src/comparison/ComparisonEngine.js`
   - `getPhysicalScaleContext(activeDems)` can calculate the shared scale from the two active comparison DEMs rather than stale historical body slots.

5. `src/terrain/TerrainRenderer.js`
   - Removes independent minimum/maximum clamps from physical horizontal plane sizing, preserving one shared world-units-per-kilometre ratio.
   - Stores mesh bounding-sphere information and uses it for fit, reset, directional presets, and normalized camera synchronization.
   - Adds `notifySync` controls so individual fit/reset actions do not accidentally synchronize the other viewport.
   - Existing 4x base relief presentation factor remains; the shared scale is horizontal, not a claim of unexaggerated vertical 1:1 scale.

6. `app.js`
   - Rejects a supplied/cached planetary DEM unless its body and original crop bounds match the requested comparison target.
   - Uses the active Earth/planetary DEM pair for physical scaling.
   - Renders with the already available global overview first, then asynchronously upgrades to regional imagery so WMTS requests do not block the initial terrain mesh.
   - Adds regional imagery source/coverage status to comparison metadata.
   - Wires the sync checkbox, independent camera reset/fit actions, satellite texture fallback, and custom heatmap updates for comparison renderers.

7. `index.html`
   - Turns camera synchronization off by default.
   - Renames the physical mode label to clarify that it is a shared horizontal scale.

## Validation performed

- `node --check` passed for all 13 JavaScript files in the project.
- `python -m py_compile server.py` completed with exit code 0.
- Focused Node tests passed for:
  - Edge-origin DEM crop bounds.
  - Sample-centre DEM crop bounds.
  - Antimeridian-crossing crop bounds.
- ZIP archive integrity was checked after packaging.

## Not verified

- No live browser session, WebGL rendering, UI interaction, NASA WMTS tile download, SRTM network request, or end-to-end server launch was performed in this environment.
- NASA documentation supports the 2-column/1-row global first tile matrix followed by 4-column/2-row levels for Trek, and GIBS publishes the EPSG:4326 TileMatrixSet. The actual configured layer responses and coverage are still runtime-dependent.
- The existing project may have other unrelated issues not covered by this targeted repair.

## Important scale note

The comparison's horizontal dimensions now share a common km-to-world-unit ratio. Terrain relief still uses the existing 4x base vertical presentation factor, followed by the user-selected exaggeration multiplier. Therefore the UI must not be interpreted as claiming true vertical 1:1 geometry.

# AstroLoc Planetary Explorer — Integrated Build Notes

This build applies the available audit/implementation record to the uploaded baseline project.

## Implemented in this build

- Added coordinate-derived default regional bounding boxes to all existing Earth, Moon, and Mars landmarks.
- Selecting a landmark or coordinate now updates the region bounds; restored saved bounds are preserved at startup.
- Added debounced automatic 2D regional crop preview and click-to-open 3D terrain behavior.
- Added cropped orbital imagery textures, UV coordinates, and Hybrid / Imagery / Elevation surface modes.
- Added side-by-side planetary and Earth DEM viewports, manual Earth analogue selection, camera presets, optional camera synchronization, and fit / physical scale modes.
- Added deterministic Earth analogue recommendations using existing `targetPair` relationships and landform-description keywords.
- Fixed the `relief` / `reliefM` comparison-table mismatch.
- Added regional DEM caching, in-flight Earth SRTM request deduplication, bounded in-memory caching, and more targeted SRTM tile iteration.
- Reduced terrain interaction overhead with throttled cursor raycasting and scale-based vertical exaggeration updates.
- Disposed removed globe landmark / region geometry and gated globe / terrain rendering when their viewports are hidden or have zero size.

## Important accuracy notes

- The analogue recommender is a deterministic, explainable heuristic over the existing landmark catalogue. It is **not an LLM-backed AI service**, and its displayed percentage is a heuristic match score, not a scientifically validated similarity probability.
- Earth SRTM coverage is limited to approximately 60°N–56°S. The app now rejects out-of-coverage requests rather than silently returning a partial DEM. Polar analogues require a local DEM or another suitable dataset.
- The configured Moon LOLA and Mars MOLA global grids are 4 pixels per degree. Regional cropping cannot create finer native elevation detail than those source grids.
- Orbital imagery alignment assumes the provider's loaded global mosaic is equirectangular. The configured source images and their projection metadata should be verified against the actual downloaded imagery before scientific use.
- The WebGL renderer still recreates its renderer/context when a DEM is re-rendered; this build removes forced context loss and reduces other bottlenecks, but persistent renderer reuse would be a further optimization.

## Validation performed

- JavaScript syntax checks passed for the modified modules.
- Provider data checks confirmed that all 17 Earth, 14 Moon, and 18 Mars landmarks have regional bounding boxes.
- A synthetic 4 ppd DEM crop test passed (10° × 10° region produced a 40 × 40 grid).
- A browser screenshot smoke test did not complete within the execution time limit, so full interactive browser validation is not claimed.

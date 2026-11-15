# Argon follow-up patch notes

The source export contains later incremental changes. Review these sections in the original export before production use:

- Phase update around lines 3747–4667: provider regional DEM loaders, provider status, and optional imagery preview.
- Phase update around lines 4707–6146: TextureManager, DEMProcessor, TerrainRenderer, terrain workbench, LOD, cancellation and profile updates.
- Phase update around lines 6182–7760: ComparisonEngine, TerrainRenderer updates, server route mounting, comparison workspace HTML/CSS, and app orchestration.

Some of these are full-file replacements; others explicitly say to replace a function or HTML section. They require careful merging rather than blind concatenation.

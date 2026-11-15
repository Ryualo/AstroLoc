// src/terrain/TextureManager.js
// Globe texture loading with fallback chain, Leaflet EPSG:4326 layer management, and scientific colormaps.

import { PROVIDERS } from '../providers/MarsProvider.js';
import { buildProxyUrl } from '../core/ApiConfig.js';

export class TextureManager {
    constructor(renderer) {
        this.renderer = renderer;
        this.textureCache = {};
        this.loadedImages = {};
        this.inFlightLoads = {};
        this.regionTextureCache = new Map();
    }

    loadBodyTexture(bodyKey, onLoaded, onStatus) {
        const canonicalKey = Object.keys(PROVIDERS).find(
            key => key.toLowerCase() === String(bodyKey || '').toLowerCase()
        ) || 'Moon';
        const provider = PROVIDERS[canonicalKey] || PROVIDERS.Moon;

        if (this.textureCache[canonicalKey] && this.loadedImages[canonicalKey]) {
            onStatus?.(`Basemap: Verified NASA/USGS ${provider.id} global mosaic`);
            onLoaded?.(this.textureCache[canonicalKey], this.loadedImages[canonicalKey].src, provider);
            return;
        }
        if (this.inFlightLoads[canonicalKey]) {
            this.inFlightLoads[canonicalKey].push({ onLoaded, onStatus });
            return;
        }

        this.inFlightLoads[canonicalKey] = [{ onLoaded, onStatus }];
        onStatus?.(`Loading verified NASA/USGS ${provider.id} global mosaic…`);
        const urls = provider.textureUrls.map(url => buildProxyUrl(url));
        let attempt = 0;

        const finish = (texture, url, status) => {
            const waiters = this.inFlightLoads[canonicalKey] || [];
            delete this.inFlightLoads[canonicalKey];
            waiters.forEach(waiter => {
                waiter.onStatus?.(status);
                waiter.onLoaded?.(texture, url, provider);
            });
        };
        const tryNext = () => {
            if (attempt >= urls.length) {
                finish(null, null, `Basemap: ${provider.id} Reference Sphere (offline texture fallback)`);
                return;
            }
            const url = urls[attempt++];
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.loadedImages[canonicalKey] = img;
                const texture = new window.THREE.Texture(img);
                texture.needsUpdate = true;
                if (this.renderer?.capabilities) texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
                this.textureCache[canonicalKey] = texture;
                finish(texture, url, `Basemap: Verified NASA/USGS ${provider.id} global mosaic`);
            };
            img.onerror = tryNext;
            img.src = url;
        };
        tryNext();
    }

    getLoadedImage(bodyKey) {
        const key = Object.keys(PROVIDERS).find(k => k.toLowerCase() === String(bodyKey || '').toLowerCase()) || bodyKey;
        return this.loadedImages[key] || null;
    }

    resolveDemAlignedBounds(bbox, dem = null) {
        // Align texture bounds strictly to the DEM vertex extent so UVs [0..1] map 1:1 without offset or stretching
        if (dem && dem.bbox && Number.isFinite(dem.bbox.north) && Number.isFinite(dem.bbox.south)) {
            const w = Number(dem.bbox.west);
            const e = Number(dem.bbox.east);
            const n = Number(dem.bbox.north);
            const s = Number(dem.bbox.south);
            const wraps = Boolean(dem.bbox.wrapsAntimeridian || e < w);
            const span = Number(dem.lonSpan) || (wraps ? e + 360 - w : e - w);
            if (n > s && span > 0) {
                return { north: n, south: s, west: w, east: e, wrapsAntimeridian: wraps, spanDegrees: span };
            }
        }
        if (!bbox) return null;
        const wraps = Boolean(bbox.wrapsAntimeridian || bbox.east < bbox.west);
        const span = Number(bbox.spanDegrees || (wraps ? bbox.east + 360 - bbox.west : bbox.east - bbox.west));
        return {
            north: Number(bbox.north),
            south: Number(bbox.south),
            west: Number(bbox.west),
            east: Number(bbox.east),
            wrapsAntimeridian: wraps,
            spanDegrees: span,
        };
    }

    buildCroppedRegionTexture(bodyKey, bbox, dem = null) {
        const key = Object.keys(PROVIDERS).find(k => k.toLowerCase() === String(bodyKey || '').toLowerCase()) || bodyKey;
        const provider = PROVIDERS[key] || PROVIDERS.Moon;
        const image = this.getLoadedImage(key);
        const aligned = this.resolveDemAlignedBounds(bbox, dem);
        if (!image || !aligned) return null;

        const cacheKey = ['overview', key, aligned.north.toFixed(4), aligned.south.toFixed(4), aligned.west.toFixed(4), aligned.east.toFixed(4)].join(':');
        if (this.regionTextureCache.has(cacheKey)) {
            const cached = this.regionTextureCache.get(cacheKey);
            this.regionTextureCache.delete(cacheKey);
            this.regionTextureCache.set(cacheKey, cached);
            return cached;
        }

        const canvas = document.createElement('canvas');
        const span = Math.max(0.05, aligned.spanDegrees);
        const latSpan = Math.max(0.05, aligned.north - aligned.south);
        const midLat = ((aligned.north + aligned.south) / 2) * (Math.PI / 180);
        const aspect = Math.max(0.08, span * Math.max(0.08, Math.cos(midLat))) / latSpan;
        canvas.width = 1024;
        canvas.height = Math.max(256, Math.min(1024, Math.round(1024 / Math.max(0.25, aspect))));
        const ctx = canvas.getContext('2d');

        // Exact floating-point source pixel coordinates prevent sub-pixel offsets on small regional crops
        const sy = Math.max(0, ((90 - aligned.north) / 180) * image.naturalHeight);
        const ey = Math.min(image.naturalHeight, ((90 - aligned.south) / 180) * image.naturalHeight);
        const sh = Math.max(0.5, ey - sy);
        const segments = aligned.wrapsAntimeridian
            ? [{ west: aligned.west, span: 180 - aligned.west }, { west: -180, span: aligned.east + 180 }]
            : [{ west: aligned.west, span }];
        let dx = 0;
        for (const segment of segments) {
            if (segment.span <= 0) continue;
            const sx = Math.max(0, ((segment.west + 180) / 360) * image.naturalWidth);
            const ex = Math.min(image.naturalWidth, ((segment.west + segment.span + 180) / 360) * image.naturalWidth);
            const dw = (canvas.width * segment.span) / span;
            ctx.drawImage(image, sx, sy, Math.max(0.5, ex - sx), sh, dx, 0, dw, canvas.height);
            dx += dw;
        }

        const texture = new window.THREE.CanvasTexture(canvas);
        texture.wrapS = window.THREE.ClampToEdgeWrapping;
        texture.wrapT = window.THREE.ClampToEdgeWrapping;
        texture.minFilter = window.THREE.LinearFilter;
        texture.magFilter = window.THREE.LinearFilter;
        texture.needsUpdate = true;
        texture.colorSpace = window.THREE.SRGBColorSpace || texture.colorSpace;
        texture.userData = {
            sourceName: provider.dataSources?.[0]?.name || `${provider.id} Global Mosaic`,
            resolution: provider.dataSources?.[0]?.resolution || 'Global Overview',
            date: 'Mission Composite',
            projection: provider.crs?.code || 'Equirectangular',
            coverageStatus: 'Global Overview Mosaic (Fallback / Base)',
        };
        this._cacheRegionTexture(cacheKey, texture);
        return texture;
    }

    async fetchRegionalWmtsTexture(bodyKey, bbox, dem = null) {
        const key = Object.keys(PROVIDERS).find(k => k.toLowerCase() === String(bodyKey || '').toLowerCase()) || 'Moon';
        const provider = PROVIDERS[key] || PROVIDERS.Moon;
        const aligned = this.resolveDemAlignedBounds(bbox, dem);
        if (!aligned) return null;
        if (!this.getLoadedImage(key)) {
            await new Promise(resolve => this.loadBodyTexture(key, () => resolve(), () => resolve()));
        }
        if (!provider.regionalImagery?.primary) {
            return this.buildCroppedRegionTexture(key, aligned, dem);
        }

        const cacheKey = ['wmts', key, aligned.north.toFixed(4), aligned.south.toFixed(4), aligned.west.toFixed(4), aligned.east.toFixed(4)].join(':');
        if (this.regionTextureCache.has(cacheKey)) {
            return this.regionTextureCache.get(cacheKey);
        }

        const layers = [provider.regionalImagery.primary, provider.regionalImagery.fallback].filter(Boolean);
        for (const layerCfg of layers) {
            try {
                const stitched = await this._stitchEquirectangularWmtsLayer(key, layerCfg, aligned);
                if (stitched) {
                    this._cacheRegionTexture(cacheKey, stitched);
                    return stitched;
                }
            } catch {
                // Gracefully fall through to fallback WMTS layer or global overview mosaic
            }
        }
        return this.buildCroppedRegionTexture(key, aligned, dem);
    }

    async _stitchEquirectangularWmtsLayer(bodyKey, layerCfg, aligned) {
        const key = Object.keys(PROVIDERS).find(k => k.toLowerCase() === String(bodyKey || '').toLowerCase()) || 'Moon';
        const span = Math.max(0.05, aligned.spanDegrees);
        const latSpan = Math.max(0.05, aligned.north - aligned.south);
        const maxExtent = Math.max(span, latSpan);

        // Choose zoom level in standard 2:1 Equirectangular TileMatrix (cols = 2^(z+1), rows = 2^z)
        // so the region spans ~2 to 12 tiles total without excessive requests
        let zoom = 2;
        if (maxExtent <= 1.5) zoom = Math.min(layerCfg.maxZoom || 5, 5);
        else if (maxExtent <= 6) zoom = Math.min(layerCfg.maxZoom || 4, 4);
        else if (maxExtent <= 20) zoom = Math.min(layerCfg.maxZoom || 4, 3);
        else zoom = 2;

        const matrixCols = 2 ** (zoom + 1);
        const matrixRows = 2 ** zoom;
        const lonPerTile = 360 / matrixCols;
        const latPerTile = 180 / matrixRows;

        const rowMin = Math.max(0, Math.min(matrixRows - 1, Math.floor((90 - aligned.north) / latPerTile)));
        const rowMax = Math.max(0, Math.min(matrixRows - 1, Math.floor((90 - (aligned.south + 1e-7)) / latPerTile)));
        const segments = aligned.wrapsAntimeridian
            ? [{ west: aligned.west, east: 180 }, { west: -180, east: aligned.east }]
            : [{ west: aligned.west, east: aligned.east }];

        const tileRequests = [];
        for (const seg of segments) {
            if (seg.east <= seg.west) continue;
            const cMin = Math.max(0, Math.min(matrixCols - 1, Math.floor((seg.west + 180) / lonPerTile)));
            const cMax = Math.max(0, Math.min(matrixCols - 1, Math.floor((seg.east - 1e-7 + 180) / lonPerTile)));
            for (let r = rowMin; r <= rowMax; r++) {
                for (let c = cMin; c <= cMax; c++) {
                    tileRequests.push({ r, c });
                }
            }
        }
        if (!tileRequests.length || tileRequests.length > 20) return null;

        const midLat = ((aligned.north + aligned.south) / 2) * (Math.PI / 180);
        const aspect = Math.max(0.08, span * Math.max(0.08, Math.cos(midLat))) / latSpan;
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = Math.max(256, Math.min(1024, Math.round(1024 / Math.max(0.25, aspect))));
        const ctx = canvas.getContext('2d');

        // Paint the global mosaic first. Regional tiles then replace covered areas,
        // so a partial/failed tile response never leaves a misleading black viewport.
        const overviewTexture = this.buildCroppedRegionTexture(key, aligned, null);
        if (overviewTexture?.image) {
            try { ctx.drawImage(overviewTexture.image, 0, 0, canvas.width, canvas.height); } catch { /* optional fallback */ }
        }

        // Bounded tile loader: avoid firing dozens of simultaneous image requests.
        const results = new Array(tileRequests.length);
        let nextIndex = 0;
        const workerCount = Math.min(4, tileRequests.length);
        const loadOne = ({ r, c }) => new Promise(resolve => {
            const attempt = (remaining) => {
                const rawUrl = layerCfg.endpoint
                    .replace('{z}', String(zoom))
                    .replace('{y}', String(r))
                    .replace('{x}', String(c));
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve({ r, c, img });
                img.onerror = () => remaining > 0
                    ? setTimeout(() => attempt(remaining - 1), 250)
                    : resolve(null);
                img.src = buildProxyUrl(rawUrl);
            };
            attempt(1); // One bounded retry; never loop indefinitely.
        });
        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (nextIndex < tileRequests.length) {
                const index = nextIndex++;
                results[index] = await loadOne(tileRequests[index]);
            }
        }));

        const validTiles = results.filter(Boolean);
        if (!validTiles.length) return null;

        for (const { r, c, img } of validTiles) {
            const tileNorth = 90 - r * latPerTile;
            const tileSouth = tileNorth - latPerTile;
            const tileWest = -180 + c * lonPerTile;
            const tileEast = tileWest + lonPerTile;

            const iNorth = Math.min(aligned.north, tileNorth);
            const iSouth = Math.max(aligned.south, tileSouth);
            if (iNorth <= iSouth) continue;

            // Compute unwrapped longitude offset relative to aligned.west
            let relWest = tileWest - aligned.west;
            if (aligned.wrapsAntimeridian && tileWest < 0) relWest += 360;
            const relEast = relWest + lonPerTile;
            const iRelWest = Math.max(0, relWest);
            const iRelEast = Math.min(span, relEast);
            if (iRelEast <= iRelWest) continue;

            const sx = ((iRelWest - relWest) / lonPerTile) * img.naturalWidth;
            const sw = ((iRelEast - iRelWest) / lonPerTile) * img.naturalWidth;
            const sy = ((tileNorth - iNorth) / latPerTile) * img.naturalHeight;
            const sh = ((iNorth - iSouth) / latPerTile) * img.naturalHeight;

            // Slight 0.35 px overlap on destination rect eliminates sub-pixel canvas tile seams
            const dx = (iRelWest / span) * canvas.width;
            const dw = ((iRelEast - iRelWest) / span) * canvas.width + 0.35;
            const dy = ((aligned.north - iNorth) / latSpan) * canvas.height;
            const dh = ((iNorth - iSouth) / latSpan) * canvas.height + 0.35;

            ctx.drawImage(img, sx, sy, Math.max(0.5, sw), Math.max(0.5, sh), dx, dy, dw, dh);
        }

        const texture = new window.THREE.CanvasTexture(canvas);
        texture.wrapS = window.THREE.ClampToEdgeWrapping;
        texture.wrapT = window.THREE.ClampToEdgeWrapping;
        texture.minFilter = window.THREE.LinearFilter;
        texture.magFilter = window.THREE.LinearFilter;
        texture.needsUpdate = true;
        texture.colorSpace = window.THREE.SRGBColorSpace || texture.colorSpace;
        texture.userData = {
            sourceName: layerCfg.name,
            resolution: layerCfg.resolution,
            date: layerCfg.date,
            projection: layerCfg.projection,
            coverageStatus: validTiles.length === tileRequests.length
                ? `Complete (${validTiles.length}/${tileRequests.length} WMTS tiles at z=${zoom})`
                : `Partial (${validTiles.length}/${tileRequests.length} WMTS tiles at z=${zoom})`,
        };
        return texture;
    }

    _cacheRegionTexture(cacheKey, texture) {
        this.regionTextureCache.set(cacheKey, texture);
        while (this.regionTextureCache.size > 10) {
            const oldest = this.regionTextureCache.keys().next().value;
            const oldTexture = this.regionTextureCache.get(oldest);
            oldTexture?.dispose?.();
            this.regionTextureCache.delete(oldest);
        }
    }

    static parseHexRgb(hex, fallback = [0.5, 0.5, 0.5]) {
        const clean = String(hex || '').replace('#', '').trim();
        if (clean.length !== 6) return fallback;
        const num = parseInt(clean, 16);
        if (!Number.isFinite(num)) return fallback;
        return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
    }

    static getColorFromMap(t, colorMap = 'heatmap', body = 'moon', customStops = null) {
        t = Math.max(0, Math.min(1, t));
        const b = String(body || '').toLowerCase();

        if (colorMap === 'grayscale') {
            const v = t * 0.88 + 0.08;
            return [v, v, v];
        }
        if (colorMap === 'clay') {
            // Neutral matte clay shading (uniform neutral warm-gray albedo; relief shown by lighting normals)
            return [0.76, 0.73, 0.69];
        }
        if (colorMap === 'custom-heatmap') {
            const low = TextureManager.parseHexRgb(customStops?.low, [0.10, 0.20, 0.40]);
            const mid = TextureManager.parseHexRgb(customStops?.mid, [0.18, 0.72, 0.45]);
            const high = TextureManager.parseHexRgb(customStops?.high, [0.97, 0.90, 0.58]);
            if (t <= 0.5) {
                const u = t * 2;
                return [
                    low[0] + (mid[0] - low[0]) * u,
                    low[1] + (mid[1] - low[1]) * u,
                    low[2] + (mid[2] - low[2]) * u,
                ];
            }
            const u = (t - 0.5) * 2;
            return [
                mid[0] + (high[0] - mid[0]) * u,
                mid[1] + (high[1] - mid[1]) * u,
                mid[2] + (high[2] - mid[2]) * u,
            ];
        }
        if (colorMap === 'thermal') {
            if (t < 0.25) return [0, t * 4, t * 2 + 0.5];
            if (t < 0.5) return [(t - 0.25) * 4, 1, 1 - (t - 0.25) * 4];
            if (t < 0.75) return [1, 1 - (t - 0.5) * 4, 0];
            return [1, 0, 0];
        }
        if (colorMap === 'scientific') {
            if (t < 0.25) return [0.27 + t * 0.4, t * 2, 0.33 + t * 1.5];
            if (t < 0.5) return [0.17, 0.5 + (t - 0.25) * 2, 0.55 - (t - 0.25) * 1.5];
            if (t < 0.75) return [(t - 0.5) * 4, 0.7 + (t - 0.5), 0.2 - (t - 0.5) * 0.6];
            return [0.99, 0.91 - (t - 0.75) * 2, 0.14];
        }
        if (colorMap === 'heatmap') {
            // Detailed multi-stop hypsometric/turbo-inspired scientific elevation ramp
            if (t < 0.2) {
                const u = t / 0.2;
                return [0.12 + 0.06 * u, 0.24 + 0.36 * u, 0.58 + 0.28 * u];
            }
            if (t < 0.45) {
                const u = (t - 0.2) / 0.25;
                return [0.18 + 0.14 * u, 0.60 + 0.18 * u, 0.86 - 0.48 * u];
            }
            if (t < 0.7) {
                const u = (t - 0.45) / 0.25;
                return [0.32 + 0.56 * u, 0.78 - 0.08 * u, 0.38 - 0.22 * u];
            }
            if (t < 0.9) {
                const u = (t - 0.7) / 0.2;
                return [0.88 - 0.10 * u, 0.70 - 0.36 * u, 0.16 + 0.04 * u];
            }
            const u = (t - 0.9) / 0.1;
            return [0.78 + 0.18 * u, 0.34 + 0.60 * u, 0.20 + 0.74 * u];
        }
        if (b === 'moon') {
            const base = 0.16 + t * 0.72;
            return [base, base * 0.98, base * 1.02];
        }
        if (b === 'mars') {
            if (t < 0.15) return [0.1, 0.15 + t * 2, 0.4 + t * 2];
            if (t < 0.3) return [0.2 + (t - 0.15) * 3, 0.4 + (t - 0.15) * 2, 0.3 - (t - 0.15) * 1.5];
            if (t < 0.6) return [0.6 + (t - 0.3) * 1.3, 0.4 - (t - 0.3) * 0.5, 0.1];
            if (t < 0.85) return [0.85, 0.25 - (t - 0.6) * 0.5, 0.1];
            return [0.9 + (t - 0.85) * 0.5, 0.8 * (t - 0.85) / 0.15 + 0.1, 0.8 * (t - 0.85) / 0.15 + 0.1];
        }
        // Earth / generic hypsometric
        if (t < 0.2) return [0.05, 0.32 + t * 1.8, 0.52 + t];
        if (t < 0.5) return [0.18 + (t - 0.2) * 1.8, 0.58 + (t - 0.2) * 0.8, 0.28 - (t - 0.2) * 0.4];
        if (t < 0.8) return [0.58 + (t - 0.5) * 1.2, 0.48 - (t - 0.5) * 0.9, 0.14];
        return [0.94, 0.91, 0.88];
    }
}

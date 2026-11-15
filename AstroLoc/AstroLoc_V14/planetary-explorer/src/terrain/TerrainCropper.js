// src/terrain/TerrainCropper.js
// Geographic DEM raster cropping, downsampling, and 2D equirectangular surface image cropping.

import { normalizeLon180, computeRegionSpanKm } from '../core/CoordinateEngine.js';

export function downsampleGeographicGrid(data, maxDim = 512) {
    const factor = Math.max(1, Math.ceil(Math.max(data.ncols, data.nrows) / maxDim));
    if (factor === 1) return data;
    const cols = Math.ceil(data.ncols / factor);
    const rows = Math.ceil(data.nrows / factor);
    const values = new Float32Array(cols * rows);
    let min = Infinity, max = -Infinity, valid = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const v = data.values[Math.min(data.nrows - 1, r * factor) * data.ncols + Math.min(data.ncols - 1, c * factor)];
            values[r * cols + c] = v;
            if (Number.isFinite(v) && v !== data.nodata) {
                if (v < min) min = v;
                if (v > max) max = v;
                valid++;
            }
        }
    }
    return {
        ...data,
        ncols: cols,
        nrows: rows,
        values,
        minElev: min,
        maxElev: max,
        cellsizeX: (data.cellsizeX || data.cellsize) * factor,
        cellsizeY: (data.cellsizeY || data.cellsize) * factor,
        cellsize: data.cellsize * factor,
        validCount: valid,
    };
}

export function cropGeographicGrid(data, bounds, maxDim = 512) {
    const dx = Number(data.cellsizeX || data.cellsize || 1);
    const dy = Number(data.cellsizeY || data.cellsize || dx);
    const dataWest = Number.isFinite(Number(data.xllcorner)) ? Number(data.xllcorner) : Number(data.bbox?.west ?? -180);
    const sampleCenters = Boolean(data.sampleCoordinatesAreCenters);
    const dataNorth = Number.isFinite(Number(data.bbox?.north))
        ? Number(data.bbox.north)
        : Number(data.yllcorner ?? -90) + (sampleCenters ? (data.nrows - 1) : data.nrows) * dy;
    const west = normalizeLon180(Number(bounds.west));
    const east = normalizeLon180(Number(bounds.east));
    const south = Math.max(-90, Math.min(90, Number(bounds.south)));
    const north = Math.max(-90, Math.min(90, Number(bounds.north)));
    const span = Number.isFinite(bounds.spanDegrees)
        ? Math.min(360, Math.max(0, Number(bounds.spanDegrees)))
        : (bounds.wrapsAntimeridian || east < west ? east + 360 - west : east - west);

    if (![west, east, south, north, span, dx, dy, dataWest, dataNorth].every(Number.isFinite) ||
        dx <= 0 || dy <= 0 || north <= south || span <= 0 ||
        !Number.isInteger(data.ncols) || !Number.isInteger(data.nrows) ||
        !data.values || data.values.length < data.ncols * data.nrows) {
        throw new Error('Bounding box or DEM grid geometry is invalid.');
    }

    const r0 = Math.max(0, sampleCenters
        ? Math.ceil((dataNorth - north) / dy - 1e-9)
        : Math.floor((dataNorth - north) / dy));
    const r1 = Math.min(data.nrows, sampleCenters
        ? Math.floor((dataNorth - south) / dy + 1e-9) + 1
        : Math.ceil((dataNorth - south) / dy));
    if (r1 - r0 < 2) throw new Error('Selected region is smaller than two DEM rows. Widen the box.');

    const endUnwrapped = west + span;
    const chunks = endUnwrapped <= 180
        ? [[west, endUnwrapped]]
        : [[west, 180], [-180, endUnwrapped - 360]];
    const colRanges = [];
    for (const [w, e] of chunks) {
        if (e <= w) continue;
        const c0 = Math.max(0, sampleCenters
            ? Math.ceil((w - dataWest) / dx - 1e-9)
            : Math.floor((w - dataWest) / dx));
        const c1 = Math.min(data.ncols, sampleCenters
            ? Math.floor((e - dataWest) / dx + 1e-9) + 1
            : Math.ceil((e - dataWest) / dx));
        if (c1 > c0) colRanges.push([c0, c1]);
    }

    const sourceColumnIndices = [];
    for (const [c0, c1] of colRanges) {
        for (let c = c0; c < c1; c++) sourceColumnIndices.push(c);
    }
    const sourceCols = sourceColumnIndices.length;
    if (sourceCols < 2) throw new Error('Selected region does not contain at least two DEM columns.');

    const safeMaxDim = Math.max(2, Math.floor(Number(maxDim) || 512));
    const factorX = Math.max(1, Math.ceil(sourceCols / safeMaxDim));
    const factorY = Math.max(1, Math.ceil((r1 - r0) / safeMaxDim));
    const sampledCols = [];
    for (let c = 0; c < sourceCols; c += factorX) sampledCols.push(sourceColumnIndices[c]);
    const sampledRows = [];
    for (let r = r0; r < r1; r += factorY) sampledRows.push(r);
    if (sampledCols.length < 2 || sampledRows.length < 2) {
        throw new Error('Selected region is too small after DEM downsampling.');
    }

    const cols = sampledCols.length;
    const rows = sampledRows.length;
    const values = new Float32Array(cols * rows).fill(NaN);
    let min = Infinity, max = -Infinity, valid = 0;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const value = Number(data.values[sampledRows[r] * data.ncols + sampledCols[c]]);
            if (Number.isFinite(value) && value !== Number(data.nodata)) {
                values[r * cols + c] = value;
                min = Math.min(min, value);
                max = Math.max(max, value);
                valid++;
            }
        }
    }
    if (valid < 4) throw new Error('Selected region contains too few valid elevation samples.');

    // DEM cell coordinates are sample centres. Unwrap longitude across the
    // antimeridian so the first and last mesh columns remain geographically adjacent.
    const sampledLongitudes = sampledCols.map(col => dataWest + (col + (sampleCenters ? 0 : 0.5)) * dx);
    for (let i = 1; i < sampledLongitudes.length; i++) {
        while (sampledLongitudes[i] <= sampledLongitudes[i - 1]) sampledLongitudes[i] += 360;
    }
    const westCentreUnwrapped = sampledLongitudes[0];
    const eastCentreUnwrapped = sampledLongitudes[sampledLongitudes.length - 1];
    const actualLonSpan = eastCentreUnwrapped - westCentreUnwrapped;
    const northCentre = dataNorth - (sampledRows[0] + (sampleCenters ? 0 : 0.5)) * dy;
    const southCentre = dataNorth - (sampledRows[rows - 1] + (sampleCenters ? 0 : 0.5)) * dy;
    const actualLatSpan = northCentre - southCentre;
    const gridWest = normalizeLon180(westCentreUnwrapped);
    const gridEast = normalizeLon180(eastCentreUnwrapped);

    return {
        ...data,
        ncols: cols,
        nrows: rows,
        values,
        minElev: min,
        maxElev: max,
        validCount: valid,
        // These are sample-centre origins because the renderer maps mesh vertices
        // to the first/last samples rather than to raster cell edges.
        xllcorner: gridWest,
        yllcorner: southCentre,
        cellsizeX: actualLonSpan / (cols - 1),
        cellsizeY: actualLatSpan / (rows - 1),
        cellsize: Math.max(actualLonSpan / (cols - 1), actualLatSpan / (rows - 1)),
        lonSpan: actualLonSpan,
        latSpan: actualLatSpan,
        sampleCoordinatesAreCenters: true,
        bbox: {
            west: +gridWest.toFixed(8),
            east: +gridEast.toFixed(8),
            south: +southCentre.toFixed(8),
            north: +northCentre.toFixed(8),
            spanDegrees: +actualLonSpan.toFixed(8),
            wrapsAntimeridian: eastCentreUnwrapped > 180 || westCentreUnwrapped < -180,
        },
        croppedFrom: {
            west, east, south, north,
            spanDegrees: span,
            wrapsAntimeridian: endUnwrapped > 180,
        },
    };
}

export function cropSurfaceImageToCanvas(img, bbox, bodyKey, canvas) {
    if (!img || !img.complete || !img.naturalWidth || !canvas) {
        throw new Error('Global planetary basemap image is still loading. Try again in a moment.');
    }
    const ctx = canvas.getContext('2d');
    const sy = Math.max(0, ((90 - bbox.north) / 180) * img.naturalHeight);
    const ey = Math.min(img.naturalHeight, ((90 - bbox.south) / 180) * img.naturalHeight);
    const sh = Math.max(0.5, ey - sy);
    const span = Math.max(0.25, Number(bbox.spanDegrees || (bbox.wrapsAntimeridian ? bbox.east + 360 - bbox.west : bbox.east - bbox.west)));
    const targetW = 280;
    const midLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
    const aspect = Math.max(0.08, span * Math.max(0.08, Math.cos(midLat))) / Math.max(0.25, bbox.north - bbox.south);
    const targetH = Math.max(95, Math.min(210, Math.round(targetW / aspect)));
    canvas.width = targetW;
    canvas.height = targetH;
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, targetW, targetH);

    const segments = bbox.wrapsAntimeridian
        ? [{ west: bbox.west, span: 180 - bbox.west }, { west: -180, span: bbox.east + 180 }]
        : [{ west: bbox.west, span }];
    let destX = 0;
    for (const segment of segments) {
        if (segment.span <= 0) continue;
        const sx = Math.max(0, ((segment.west + 180) / 360) * img.naturalWidth);
        const ex = Math.min(img.naturalWidth, ((segment.west + segment.span + 180) / 360) * img.naturalWidth);
        const sw = Math.max(0.5, ex - sx);
        const dw = (targetW * segment.span) / span;
        ctx.drawImage(img, sx, sy, sw, sh, destX, 0, dw, targetH);
        destX += dw;
    }

    ctx.strokeStyle = 'rgba(79, 195, 247, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, targetW - 1, targetH - 1);

    return computeRegionSpanKm(bbox, bodyKey);
}

// src/core/CoordinateEngine.js
// Planetary coordinate reference frames, flexible coordinate parsing,
// Three.js spherical/cartesian transforms, and antimeridian bounding-box geometry.

export const PLANETARY_CRS = {
    Earth: {
        id: 'Earth',
        name: 'Earth',
        meanRadiusKm: 6371.0,
        equatorialRadiusKm: 6378.137,
        polarRadiusKm: 6356.752,
        flattening: 1 / 298.257223563,
        refFrame: 'WGS84 Geographic (Planetodetic, East-Positive, North-Up)',
        code: 'EPSG:4326 / WGS84',
        lonConvention: 'East-Positive (-180° to +180° / 0° to 360°E)',
        verticalDatum: 'EGM96 / Mean Sea Level (SRTM 1″)',
    },
    Moon: {
        id: 'Moon',
        name: 'Moon',
        meanRadiusKm: 1737.4,
        equatorialRadiusKm: 1737.4,
        polarRadiusKm: 1737.4,
        flattening: 0.0,
        refFrame: 'IAU Mean Earth / Polar Axis (ME, Planetocentric, North-Up)',
        code: 'IAU2015:30100',
        lonConvention: 'East-Positive (-180° to +180° / 0° to 360°E)',
        verticalDatum: '1737.4 km IAU Mean Sphere (LRO LOLA)',
    },
    Mars: {
        id: 'Mars',
        name: 'Mars',
        meanRadiusKm: 3389.5,
        equatorialRadiusKm: 3396.19,
        polarRadiusKm: 3376.20,
        flattening: 1 / 169.894447,
        refFrame: 'IAU Mars 2000 Planetocentric (East-Positive, North-Up)',
        code: 'IAU2015:49900',
        lonConvention: 'East-Positive (-180° to +180° / 0° to 360°E)',
        verticalDatum: 'MGS MOLA Areoid (Equipotential Surface)',
    },
};

export function normalizeLon180(lon) {
    const n = Number(lon);
    if (!Number.isFinite(n)) return NaN;
    let l = Math.round((((n + 180) % 360 + 360) % 360 - 180) * 1e9) / 1e9;
    if (Object.is(l, -180)) return 180;
    if (l === 0) l = 0;
    return l;
}

export function normalizeLon360(lon) {
    const n = Number(lon);
    if (!Number.isFinite(n)) return NaN;
    return Math.round((((n % 360) + 360) % 360) * 1e9) / 1e9;
}

export function decimalToDMS(deg, axis = 'lat') {
    const n = Number(deg);
    if (!Number.isFinite(n)) return '—';
    const hemi = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : (n >= 0 ? 'E' : 'W');
    const abs = Math.abs(n);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = ((mFloat - m) * 60).toFixed(2);
    return `${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(5, '0')}″ ${hemi}`;
}

export function formatPlanetCoordinate(lat, lon) {
    const clampedLat = Math.max(-90, Math.min(90, Number(lat)));
    const lon180 = normalizeLon180(lon);
    const lon360 = normalizeLon360(lon);
    const ns = clampedLat >= 0 ? `${clampedLat.toFixed(4)}°N` : `${Math.abs(clampedLat).toFixed(4)}°S`;
    const ew = lon180 >= 0 ? `${lon180.toFixed(4)}°E` : `${Math.abs(lon180).toFixed(4)}°W`;
    return {
        lat: clampedLat,
        lon180,
        lon360,
        ns,
        ew,
        dmsLat: decimalToDMS(clampedLat, 'lat'),
        dmsLon: decimalToDMS(lon180, 'lon'),
        summary: `${ns}, ${ew} (${lon360.toFixed(3)}°E)`,
    };
}

/**
 * Parses decimal degrees, signed values, N/S/E/W prefixes or suffixes, and DMS:
 * Examples: "29.5578° N", "95° 05' 12.1\" W", "-43.31", "347.5E", "S89.9"
 */
export function parsePlanetCoordinate(value, axis = 'lat') {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return NaN;
        return axis === 'lat' ? (Math.abs(value) <= 90 ? value : NaN) : normalizeLon180(value);
    }
    let s = String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[′'’]/g, ' ')
        .replace(/[″"”]/g, ' ')
        .replace(/°/g, ' ')
        .replace(/[–—−]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    if (!s) return NaN;

    const hemiMatches = s.match(/[NSEW]/g) || [];
    if (hemiMatches.length > 1) return NaN;
    const hemi = hemiMatches[0] || null;
    if (axis === 'lat' && hemi && hemi !== 'N' && hemi !== 'S') return NaN;
    if (axis === 'lon' && hemi && hemi !== 'E' && hemi !== 'W') return NaN;

    const nums = (s.match(/[+-]?\d+(?:\.\d+)?/g) || []).map(Number);
    if (!nums.length || nums.length > 3) return NaN;

    const degPart = Math.abs(nums[0]);
    const minPart = nums[1] !== undefined ? Math.abs(nums[1]) : 0;
    const secPart = nums[2] !== undefined ? Math.abs(nums[2]) : 0;
    if (minPart >= 60 || secPart >= 60) return NaN;

    let sign = String(s).includes('-') || nums[0] < 0 ? -1 : 1;
    if (hemi === 'S' || hemi === 'W') sign = -1;
    if (hemi === 'N' || hemi === 'E') sign = 1;

    const magnitude = degPart + minPart / 60 + secPart / 3600;
    if (!Number.isFinite(magnitude)) return NaN;

    const result = sign * magnitude;
    if (axis === 'lat') {
        return Math.abs(result) <= 90 ? +result.toFixed(6) : NaN;
    }
    if (Math.abs(result) > 360) return NaN;
    return normalizeLon180(result);
}

/**
 * Parses either a combined coordinate string (e.g. "29.5578° N, 95.0867° W" or "-5.4, 137.8")
 * or two separate lat/lon inputs.
 */
export function parsePlanetCoordinatePair(latOrCombined, lonOptional) {
    if (lonOptional === undefined || lonOptional === null || String(lonOptional).trim() === '') {
        const raw = String(latOrCombined ?? '').trim();
        if (!raw) return null;
        let parts = raw.split(/\s*[,;/]\s*/);
        if (parts.length !== 2) {
            const hemiSplit = raw.match(/^(.+?[NS])\s+(.+?[EW])$/i);
            if (hemiSplit) {
                parts = [hemiSplit[1], hemiSplit[2]];
            } else {
                const spaceParts = raw.split(/\s+/);
                if (spaceParts.length === 2) parts = spaceParts;
            }
        }
        if (parts.length === 2) {
            const lat = parsePlanetCoordinate(parts[0], 'lat');
            const lon = parsePlanetCoordinate(parts[1], 'lon');
            if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
        }
        return null;
    }
    const lat = parsePlanetCoordinate(latOrCombined, 'lat');
    const lon = parsePlanetCoordinate(lonOptional, 'lon');
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export function bboxLonSpan(westRaw, eastRaw) {
    const w = Number(westRaw), e = Number(eastRaw);
    if (!Number.isFinite(w) || !Number.isFinite(e)) return null;
    const west360 = w > 180;
    const wNorm = west360 ? w - 360 : w;
    let span;
    if (e > 180) {
        span = e - (west360 ? w : (wNorm < 0 ? wNorm + 360 : wNorm));
    } else if (e >= wNorm) {
        span = e - wNorm;
    } else {
        span = e - wNorm + 360;
    }
    if (!Number.isFinite(span) || span < 0) span = 0.25;
    return { west: normalizeLon180(wNorm), span: Math.min(360, Math.max(0.25, span)) };
}

export function sanitizeBbox(north, south, west, east) {
    let n = Math.max(-90, Math.min(90, Number(north)));
    let s = Math.max(-90, Math.min(90, Number(south)));
    if (!Number.isFinite(n) || !Number.isFinite(s)) return null;
    if (n < s) [n, s] = [s, n];
    if (n - s < 0.25) n = Math.min(90, s + 0.25);

    const lon = bboxLonSpan(west, east);
    if (!lon) return null;
    const { west: west180, span } = lon;
    const east180 = normalizeLon180(west180 + span);
    const full = span >= 359.999;

    return {
        north: +n.toFixed(4),
        south: +s.toFixed(4),
        west: full ? -180 : +west180.toFixed(4),
        east: full ? 180 : +east180.toFixed(4),
        wrapsAntimeridian: !full && (west180 + span) > 180,
        spanDegrees: +span.toFixed(4),
    };
}

export function bboxIntersects(a, b) {
    if (!a || !b || a.south > b.north || a.north < b.south) return false;
    const lonSegments = box => box.west <= box.east ? [[box.west, box.east]] : [[box.west, 180], [-180, box.east]];
    return lonSegments(a).some(x => lonSegments(b).some(y => x[0] <= y[1] && x[1] >= y[0]));
}

export function pointInBbox(lat, lon, bbox) {
    if (!bbox) return false;
    if (lat < bbox.south || lat > bbox.north) return false;
    const l = normalizeLon180(lon);
    return bbox.west <= bbox.east ? (l >= bbox.west && l <= bbox.east) : (l >= bbox.west || l <= bbox.east);
}

export function latLonToVector3(latDeg, lonDeg, radius = 1, THREE_REF = window.THREE) {
    const phi = (90 - latDeg) * (Math.PI / 180);
    const theta = (lonDeg + 180) * (Math.PI / 180);
    const x = -radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    return new THREE_REF.Vector3(x, y, z);
}

export function vector3ToLatLon(vec) {
    const r = vec.length() || 1;
    const lat = 90 - Math.acos(Math.max(-1, Math.min(1, vec.y / r))) * (180 / Math.PI);
    let lon = (Math.atan2(vec.z, -vec.x) * (180 / Math.PI)) - 180;
    if (lon <= -180) lon += 360;
    if (lon > 180) lon -= 360;
    return { lat, lon };
}

export function computeRegionSpanKm(bbox, bodyKey = 'Moon') {
    const crs = PLANETARY_CRS[bodyKey] || PLANETARY_CRS.Moon;
    const degToKm = (Math.PI / 180) * crs.meanRadiusKm;
    const midLatRad = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
    const heightKm = Math.abs(bbox.north - bbox.south) * degToKm;
    const lonSpan = bbox.spanDegrees || (bbox.wrapsAntimeridian ? bbox.east + 360 - bbox.west : Math.abs(bbox.east - bbox.west));
    const widthKm = lonSpan * degToKm * Math.max(0.05, Math.cos(midLatRad));
    return {
        widthKm: Math.round(widthKm),
        heightKm: Math.round(heightKm),
        areaKm2: Math.round(widthKm * heightKm),
        meanRadiusKm: crs.meanRadiusKm,
    };
}

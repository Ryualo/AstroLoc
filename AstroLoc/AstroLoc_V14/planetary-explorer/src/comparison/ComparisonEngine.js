// src/comparison/ComparisonEngine.js
// Side-by-side Earth, Moon, and Mars 3D terrain comparison engine:
// - Synchronized camera rotation, zoom, target offset, footprint, and vertical exaggeration
// - Physical-Scale (km-unified) vs. Fit-to-Terrain (normalized) modes
// - Finite-difference slope statistics, elevation ranges, resolution, and overlaid transect profiles
// - Preserves each dataset's original vertical datum and provenance

import { PLANETARY_CRS, computeRegionSpanKm } from '../core/CoordinateEngine.js';
import { PROVIDERS } from '../providers/MarsProvider.js';
import { sampleTerrainProfile } from '../terrain/DEMProcessor.js';

export const REFERENCE_TABLE_PAIRINGS = [
    { earthName: 'Astroland Agency, Spain', earthCoordText: '43.27°N, 3.60°W', earthLat: 43.27, earthLon: -3.60, moonName: 'Mare Imbrium*', moonCoordText: '34.72°N, 14.91°W', moonLat: 34.72, moonLon: -14.91, moonDeltaDeg: '12.24', marsName: 'Deuteronilus Mensae', marsCoordText: '42.2°N, 24.7°E', marsLat: 42.2, marsLon: 24.7, marsDeltaDeg: '20.71' },
    { earthName: 'Atacama Desert, Chile', earthCoordText: '25.14°S, 68.77°W', earthLat: -25.14, earthLon: -68.77, moonName: 'Marius Hills', moonCoordText: '14°N, 56°W', moonLat: 14.0, moonLon: -56.0, moonDeltaDeg: '41.07', marsName: 'Eberswalde Crater', marsCoordText: '23.9°S, 33.3°W', marsLat: -23.9, marsLon: -33.3, marsDeltaDeg: '32.20' },
    { earthName: 'Biosphere 2, Arizona', earthCoordText: '32.58°N, 110.85°W', earthLat: 32.58, earthLon: -110.85, moonName: 'Oceanus Procellarum / Marius Hills*', moonCoordText: '20.67°N, 56.68°W', moonLat: 20.67, moonLon: -56.68, moonDeltaDeg: '49.34', marsName: 'Elysium Mons', marsCoordText: '22.3°N, 112.8°W', marsLat: 22.3, marsLon: -112.8, marsDeltaDeg: '10.42' },
    { earthName: 'Concordia Station, Antarctica', earthCoordText: '75.10°S, 123.33°E', earthLat: -75.10, earthLon: 123.33, moonName: 'Schrödinger Basin', moonCoordText: '75°S, 132.4°E', moonLat: -75.0, moonLon: 132.4, moonDeltaDeg: '2.34', marsName: 'Planum Australe', marsCoordText: '85°S, 160°E', marsLat: -85.0, marsLon: 160.0, marsDeltaDeg: '11.28' },
    { earthName: 'D-MARS, Israel', earthCoordText: '30.61°N, 34.80°E', earthLat: 30.61, earthLon: 34.80, moonName: 'Mare Tranquillitatis', moonCoordText: '8.5°N, 31.4°E', moonLat: 8.5, moonLon: 31.4, moonDeltaDeg: '22.34', marsName: 'Deuteronilus Mensae', marsCoordText: '42.2°N, 24.7°E', marsLat: 42.2, marsLon: 24.7, marsDeltaDeg: '14.13' },
    { earthName: 'Dachstein Ice Caves, Austria', earthCoordText: '47.53°N, 13.70°E', earthLat: 47.53, earthLon: 13.70, moonName: 'Hadley–Apennine', moonCoordText: '26.13°N, 3.63°E', moonLat: 26.13, moonLon: 3.63, moonDeltaDeg: '22.82', marsName: 'Deuteronilus Mensae', marsCoordText: '42.2°N, 24.7°E', marsLat: 42.2, marsLon: 24.7, marsDeltaDeg: '9.43' },
    { earthName: 'Devon Island, Canada', earthCoordText: '75.43°N, 89.86°W', earthLat: 75.43, earthLon: -89.86, moonName: 'Mare Imbrium*', moonCoordText: '34.72°N, 14.91°W', moonLat: 34.72, moonLon: -14.91, moonDeltaDeg: '52.78', marsName: 'Phoenix Landing Site', marsCoordText: '68.22°N, 125.75°W', marsLat: 68.22, marsLon: -125.75, marsDeltaDeg: '13.00' },
    { earthName: 'HI-SEAS, Hawaii', earthCoordText: '19.60°N, 155.49°W', earthLat: 19.60, earthLon: -155.49, moonName: 'Oceanus Procellarum / Marius Hills*', moonCoordText: '20.67°N, 56.68°W', moonLat: 20.67, moonLon: -56.68, moonDeltaDeg: '90.95', marsName: 'Tharsis Volcanic Region', marsCoordText: '18.4°N, 133.8°W', marsLat: 18.4, marsLon: -133.8, marsDeltaDeg: '20.53' },
    { earthName: 'Krafla, Iceland', earthCoordText: '65.72°N, 16.75°W', earthLat: 65.72, earthLon: -16.75, moonName: 'Mare Imbrium*', moonCoordText: '34.72°N, 14.91°W', moonLat: 34.72, moonLon: -14.91, moonDeltaDeg: '31.02', marsName: 'Planum Boreum', marsCoordText: '80°N, 15°E', marsLat: 80.0, marsLon: 15.0, marsDeltaDeg: '16.58' },
    { earthName: 'LunAres, Poland', earthCoordText: '53.18°N, 16.71°E', earthLat: 53.18, earthLon: 16.71, moonName: 'Hadley–Apennine', moonCoordText: '26.13°N, 3.63°E', moonLat: 26.13, moonLon: 3.63, moonDeltaDeg: '28.76', marsName: 'Deuteronilus Mensae', marsCoordText: '42.2°N, 24.7°E', marsLat: 42.2, marsLon: 24.7, marsDeltaDeg: '12.21' },
    { earthName: 'MDRS, Utah', earthCoordText: '38.41°N, 110.79°W', earthLat: 38.41, earthLon: -110.79, moonName: 'Oceanus Procellarum / Marius Hills*', moonCoordText: '20.67°N, 56.68°W', moonLat: 20.67, moonLon: -56.68, moonDeltaDeg: '49.53', marsName: 'Elysium Mons', marsCoordText: '22.3°N, 112.8°W', marsLat: 22.3, marsLon: -112.8, marsDeltaDeg: '16.20' },
    { earthName: 'Mars Dune Alpha, Texas', earthCoordText: '29.56°N, 95.09°W', earthLat: 29.56, earthLon: -95.09, moonName: 'Oceanus Procellarum / Marius Hills*', moonCoordText: '20.67°N, 56.68°W', moonLat: 20.67, moonLon: -56.68, moonDeltaDeg: '35.72', marsName: 'Elysium Mons', marsCoordText: '22.3°N, 112.8°W', marsLat: 22.3, marsLon: -112.8, marsDeltaDeg: '17.48' },
    { earthName: 'Mars-500, Moscow', earthCoordText: '55.82°N, 37.51°E', earthLat: 55.82, earthLon: 37.51, moonName: 'Hadley–Apennine', moonCoordText: '26.13°N, 3.63°E', moonLat: 26.13, moonLon: 3.63, moonDeltaDeg: '38.46', marsName: 'Deuteronilus Mensae', marsCoordText: '42.2°N, 24.7°E', marsLat: 42.2, marsLon: 24.7, marsDeltaDeg: '15.95' },
    { earthName: 'McMurdo Dry Valleys', earthCoordText: '77.56°S, 161.18°E', earthLat: -77.56, earthLon: 161.18, moonName: 'Schrödinger Basin', moonCoordText: '75°S, 132.4°E', moonLat: -75.0, moonLon: 132.4, moonDeltaDeg: '7.20', marsName: 'Planum Australe', marsCoordText: '85°S, 160°E', marsLat: -85.0, marsLon: 160.0, marsDeltaDeg: '7.44' },
    { earthName: 'Solar54, Argentina', earthCoordText: '29.98°S, 67.12°W', earthLat: -29.98, earthLon: -67.12, moonName: 'Marius Hills', moonCoordText: '14°N, 56°W', moonLat: 14.0, moonLon: -56.0, moonDeltaDeg: '45.27', marsName: 'Eberswalde Crater', marsCoordText: '23.9°S, 33.3°W', marsLat: -23.9, marsLon: -33.3, marsDeltaDeg: '30.64' },
    { earthName: 'Svalbard, Norway', earthCoordText: '78.92°N, 11.91°E', earthLat: 78.92, earthLon: 11.91, moonName: 'Mare Imbrium*', moonCoordText: '34.72°N, 14.91°W', moonLat: 34.72, moonLon: -14.91, moonDeltaDeg: '45.58', marsName: 'Planum Boreum', marsCoordText: '80°N, 15°E', marsLat: 80.0, marsLon: 15.0, marsDeltaDeg: '1.22' },
    { earthName: 'Singu Plateau, Myanmar', earthCoordText: '22.70°N, 95.98°E', earthLat: 22.70, earthLon: 95.98, moonName: 'Mare Tranquillitatis', moonCoordText: '8.3°N, 33.2°E', moonLat: 8.3, moonLon: 33.2, moonDeltaDeg: '61.75', marsName: 'Jezero Crater', marsCoordText: '18.38°N, 77.58°E', marsLat: 18.38, marsLon: 77.58, marsDeltaDeg: '17.75' },
    { earthName: 'Mount Popa, Myanmar', earthCoordText: '20.92°N, 95.25°E', earthLat: 20.92, earthLon: 95.25, moonName: 'Mare Tranquillitatis', moonCoordText: '8.3°N, 33.2°E', moonLat: 8.3, moonLon: 33.2, moonDeltaDeg: '61.00', marsName: 'Jezero Crater', marsCoordText: '18.38°N, 77.58°E', marsLat: 18.38, marsLon: 77.58, marsDeltaDeg: '16.82' },
    { earthName: 'Hpakant–Tawmaw, Myanmar', earthCoordText: '25.60°N, 96.30°E', earthLat: 25.60, earthLon: 96.30, moonName: 'Mare Tranquillitatis', moonCoordText: '8.3°N, 33.2°E', moonLat: 8.3, moonLon: 33.2, moonDeltaDeg: '62.22', marsName: 'Jezero Crater', marsCoordText: '18.38°N, 77.58°E', marsLat: 18.38, marsLon: 77.58, marsDeltaDeg: '18.77' },
];

export const SOURCE_CONFLICTS = [
    { key: 'biosphere 2', note: 'Provider EarthProvider.js (32.5788°N, 110.8506°W; Verified Analogue: Aristarchus Plateau) vs Reference TXT (32.58°N, 110.85°W; Table Pairings: Oceanus Procellarum / Marius Hills* Δ° 49.34, Elysium Mons Δ° 10.42). Both preserved.' },
    { key: 'houston|mars dune alpha', note: 'Provider EarthProvider.js JSC Houston (29.5578°N, 95.0867°W; Verified Analogue: Mare Tranquillitatis 8.5°N, 31.4°E) vs Reference TXT Mars Dune Alpha (29.56°N, 95.09°W; Table Pairings: Oceanus Procellarum / Marius Hills* Δ° 35.72, Elysium Mons Δ° 17.48). Both preserved.' },
    { key: 'concordia|dome c', note: 'Provider EarthProvider.js Dome C (-75.10°, 123.35°E; Verified Analogue: Malapert Massif) vs Reference TXT Concordia Station (75.10°S, 123.33°E; Table Pairings: Schrödinger Basin Δ° 2.34, Planum Australe Δ° 11.28). Both preserved.' },
    { key: 'devon island|haughton', note: 'Provider EarthProvider.js Haughton Crater (75.38°N, 89.67°W; Verified Analogue: Tycho & Shackleton) vs Reference TXT Devon Island (75.43°N, 89.86°W; Table Pairings: Mare Imbrium* Δ° 52.78, Phoenix Landing Site Δ° 13.00). Both preserved.' },
    { key: 'hi-seas|mauna loa', note: 'Provider EarthProvider.js Mauna Loa HI-SEAS (19.475°N, 155.608°W; Verified Analogue: Mare Imbrium 32.8°N, 15.6°W) vs Reference TXT HI-SEAS (19.60°N, 155.49°W; Table Pairings: Oceanus Procellarum / Marius Hills* Δ° 90.95, Tharsis Volcanic Region Δ° 20.53). Both preserved.' },
    { key: 'mcmurdo', note: 'Provider EarthProvider.js McMurdo Dry Valleys (-77.4667°, 162.5167°E; Verified Analogue: Gale Crater) vs Reference TXT McMurdo Dry Valleys (77.56°S, 161.18°E; Table Pairings: Schrödinger Basin Δ° 7.20, Planum Australe Δ° 7.44). Both preserved.' },
    { key: 'svalbard|bockfjord', note: 'Provider EarthProvider.js Bockfjord Svalbard (78.22°N, 15.65°E; Verified Analogue: Malapert & Leibnitz Beta) vs Reference TXT Svalbard (78.92°N, 11.91°E; Table Pairings: Mare Imbrium* Δ° 45.58, Planum Boreum Δ° 1.22). Both preserved.' },
    { key: 'mare imbrium', note: 'Provider MoonProvider.js Mare Imbrium (32.8°N, 15.6°W) vs Reference TXT Mare Imbrium* (34.72°N, 14.91°W). Both preserved.' },
    { key: 'mare tranquillitatis', note: 'Provider MoonProvider.js Apollo 11 (0.6741°N, 23.4730°E) and Analogue Reference (8.5°N, 31.4°E) vs Reference TXT Myanmar target Mare Tranquillitatis (8.3°N, 33.2°E). All 3 preserved.' },
    { key: 'oceanus procellarum|marius hills', note: 'Provider MoonProvider.js Oceanus Procellarum (18.4°N, 57.4°W) and Marius Hills (14.0°N, 56.0°W) vs Reference TXT combined Oceanus Procellarum / Marius Hills* (20.67°N, 56.68°W). All preserved.' },
    { key: 'hadley', note: 'Provider MoonProvider.js Apollo 15 Hadley–Apennine (26.1322°N, 3.6339°E) vs Reference TXT Hadley–Apennine (26.13°N, 3.63°E). Both preserved.' },
    { key: 'olympus mons|tharsis', note: 'Provider MarsProvider.js Olympus Mons Summit Caldera (18.65°N, 133.8°W) vs Reference TXT Tharsis Volcanic Region (18.4°N, 133.8°W). Both preserved.' },
];

export class ComparisonEngine {
    constructor() {
        this.products = [];
        this.demSnapshots = [];
        this.slots = {
            Earth: { dem: null, stats: null, profile: null, renderer: null },
            Moon: { dem: null, stats: null, profile: null, renderer: null },
            Mars: { dem: null, stats: null, profile: null, renderer: null },
        };
        this.syncEnabled = false; // Independent cameras by default; sync only when explicitly enabled.
        this.scaleMode = 'physical'; // Default 1:1 physical scale
        this.surfaceMode = 'heatmap';
        this.colorMap = 'heatmap';
        this.exaggeration = 1.0; // Default 1× exaggeration
        this.wireframe = false;
        this._isSyncingCamera = false;
    }

    getAllLandmarksCatalog() {
        const catalog = [];
        for (const [bodyKey, provider] of Object.entries(PROVIDERS)) {
            for (const lm of provider.landmarks) {
                catalog.push({
                    ...lm,
                    body: provider.id || bodyKey,
                    crsCode: provider.crs.code,
                    refFrame: provider.crs.refFrame,
                });
            }
        }
        return catalog;
    }

    searchCatalog(query, bodyFilter = '') {
        const all = this.getAllLandmarksCatalog();
        const q = String(query || '').trim().toLowerCase();
        return all.filter(item => {
            if (bodyFilter && item.body !== bodyFilter) return false;
            if (!q) return true;
            const hay = `${item.name} ${item.body} ${item.type} ${item.mission} ${item.targetPair || ''} ${item.desc} ${item.lat} ${item.lon}`.toLowerCase();
            return hay.includes(q);
        });
    }

    getSourceConflicts(nameOrQuery = '') {
        const q = String(nameOrQuery || '').toLowerCase();
        if (!q) return SOURCE_CONFLICTS;
        return SOURCE_CONFLICTS.filter(item =>
            item.key.split('|').some(token => q.includes(token))
        );
    }

    getReferencePairingsForLocation(bodyKey, landmark) {
        if (!landmark) return [];
        const nameLower = String(landmark.name || '').toLowerCase();
        const lat = Number(landmark.lat);
        const lon = Number(landmark.lon);
        if (bodyKey === 'Earth') {
            return REFERENCE_TABLE_PAIRINGS.filter(row =>
                (Math.abs(row.earthLat - lat) < 0.02 && Math.abs(row.earthLon - lon) < 0.02) ||
                nameLower.includes(row.earthName.split(',')[0].toLowerCase())
            );
        }
        if (bodyKey === 'Moon') {
            return REFERENCE_TABLE_PAIRINGS.filter(row =>
                (Math.abs(row.moonLat - lat) < 0.02 && Math.abs(row.moonLon - lon) < 0.02) ||
                nameLower.includes(row.moonName.replace('*', '').split('/')[0].trim().toLowerCase())
            );
        }
        if (bodyKey === 'Mars') {
            return REFERENCE_TABLE_PAIRINGS.filter(row =>
                (Math.abs(row.marsLat - lat) < 0.02 && Math.abs(row.marsLon - lon) < 0.02) ||
                nameLower.includes(row.marsName.toLowerCase())
            );
        }
        return [];
    }

    recommendEarthAnalogues({ body, landmark } = {}) {
        const bodyKey = body || 'Moon';
        if (!['Moon', 'Mars'].includes(bodyKey)) return [];
        const target = String(landmark?.name || '').toLowerCase();
        const targetCore = target.replace(/\(.*?\)/g, '').replace('*', '').split('—')[0].trim();
        const earth = PROVIDERS.Earth?.landmarks || [];
        const tableMatches = this.getReferencePairingsForLocation(bodyKey, landmark);

        return earth.map(place => {
            const pair = String(place.targetPair || '').toLowerCase();
            const name = String(place.name || '').toLowerCase();
            const earthCore = name.replace(/\(.*?\)/g, '').split('—')[0].split(',')[0].trim();
            const isRefPreset = place.pairingStatus === 'table_pairing';

            const matchingRow = tableMatches.find(row =>
                Math.abs(row.earthLat - place.lat) < 0.02 && Math.abs(row.earthLon - place.lon) < 0.02
            );
            const deltaDeg = matchingRow
                ? (bodyKey === 'Moon' ? matchingRow.moonDeltaDeg : matchingRow.marsDeltaDeg)
                : (bodyKey === 'Moon' ? place.moonPairing?.deltaDeg : place.marsPairing?.deltaDeg) || null;

            const isVerifiedAnalogue = !isRefPreset && Boolean(
                (targetCore && pair.includes(targetCore)) ||
                (earthCore && String(landmark?.targetPair || '').toLowerCase().includes(earthCore) && landmark?.pairingStatus !== 'table_pairing')
            );
            const isTablePairing = Boolean(matchingRow) || (isRefPreset && Boolean(
                (bodyKey === 'Moon' && place.moonPairing && targetCore && place.moonPairing.name.toLowerCase().includes(targetCore)) ||
                (bodyKey === 'Mars' && place.marsPairing && targetCore && place.marsPairing.name.toLowerCase().includes(targetCore))
            ));

            const rank = isVerifiedAnalogue ? 3 : isTablePairing ? 2 : 1;
            const relationshipLabel = isVerifiedAnalogue
                ? 'Verified Analogue (Documented)'
                : isTablePairing
                    ? 'Table Pairing / Candidate Comparison'
                    : 'Candidate Comparison';
            const badgeClass = isVerifiedAnalogue ? 'meas' : 'der';

            return {
                ...place,
                rank,
                deltaDeg,
                isVerifiedAnalogue,
                isTablePairing,
                relationshipLabel,
                badgeClass,
                rationale: isVerifiedAnalogue
                    ? `Verified geological/mission analogue documented in ${place.source}.`
                    : isTablePairing
                        ? `User-supplied table pairing${deltaDeg ? ` (preserved Δ° = ${deltaDeg})` : ''}; candidate comparison, not an independently verified analogue.`
                        : 'Available Earth site for candidate topographic comparison.',
                srtmAvailable: place.lat <= 60 && place.lat >= -56,
            };
        }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
    }

    computeDatasetMetrics(dem) {
        if (!dem || !dem.values || dem.ncols < 2 || dem.nrows < 2) return null;
        if (dem._cachedMetrics) return dem._cachedMetrics;
        const bodyKey = Object.keys(PLANETARY_CRS).find(
            k => k.toLowerCase() === String(dem.body || 'moon').toLowerCase()
        ) || 'Moon';
        const crs = PLANETARY_CRS[bodyKey];
        const degToMeters = (Math.PI / 180) * crs.meanRadiusKm * 1000;

        const bbox = dem.bbox || { west: -10, east: 10, south: -10, north: 10 };
        const midLatRad = (((bbox.north + bbox.south) / 2) * Math.PI) / 180;
        const cosLat = Math.max(0.05, Math.cos(midLatRad));
        const dxDeg = Number(dem.cellsizeX || dem.cellsize || 0.25);
        const dyDeg = Number(dem.cellsizeY || dem.cellsize || 0.25);
        const dxMeters = dxDeg * degToMeters * cosLat;
        const dyMeters = dyDeg * degToMeters;

        const spanKm = computeRegionSpanKm(bbox, bodyKey);

        let sum = 0;
        let sumSq = 0;
        let validCount = 0;
        let minElev = Infinity;
        let maxElev = -Infinity;

        const { ncols, nrows, values, nodata } = dem;
        for (let i = 0; i < values.length; i++) {
            const v = Number(values[i]);
            if (Number.isFinite(v) && v !== Number(nodata)) {
                sum += v;
                sumSq += v * v;
                validCount++;
                if (v < minElev) minElev = v;
                if (v > maxElev) maxElev = v;
            }
        }

        const meanElev = validCount > 0 ? sum / validCount : 0;
        const variance = validCount > 1 ? Math.max(0, sumSq / validCount - meanElev * meanElev) : 0;
        const stdDevElev = Math.sqrt(variance);
        const reliefM = Number.isFinite(minElev) ? maxElev - minElev : 0;

        // Finite-difference Horn / central-difference slope in degrees
        let slopeSum = 0;
        let maxSlopeDeg = 0;
        let slopeCount = 0;
        const slopeBins = [0, 0, 0, 0, 0]; // 0-2°, 2-5°, 5-15°, 15-30°, >30°

        for (let r = 1; r < nrows - 1; r++) {
            for (let c = 1; c < ncols - 1; c++) {
                const idx = r * ncols + c;
                const zC = Number(values[idx]);
                const zW = Number(values[idx - 1]);
                const zE = Number(values[idx + 1]);
                const zN = Number(values[idx - ncols]);
                const zS = Number(values[idx + ncols]);
                if (
                    !Number.isFinite(zC) || !Number.isFinite(zW) ||
                    !Number.isFinite(zE) || !Number.isFinite(zN) || !Number.isFinite(zS)
                ) {
                    continue;
                }
                const dzdx = (zE - zW) / (2 * Math.max(1, dxMeters));
                const dzdy = (zN - zS) / (2 * Math.max(1, dyMeters));
                const slopeDeg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
                slopeSum += slopeDeg;
                if (slopeDeg > maxSlopeDeg) maxSlopeDeg = slopeDeg;
                slopeCount++;
                if (slopeDeg < 2) slopeBins[0]++;
                else if (slopeDeg < 5) slopeBins[1]++;
                else if (slopeDeg < 15) slopeBins[2]++;
                else if (slopeDeg < 30) slopeBins[3]++;
                else slopeBins[4]++;
            }
        }

        const meanSlopeDeg = slopeCount > 0 ? slopeSum / slopeCount : 0;
        const midRow = Math.floor(nrows / 2);
        const profile = sampleTerrainProfile(
            dem,
            { col: 0, row: midRow },
            { col: ncols - 1, row: midRow },
            80
        );

        const metrics = {
            body: bodyKey,
            source: dem.source,
            mission: dem.mission,
            instrument: dem.instrument,
            units: dem.units,
            coordSystem: dem.coordSystem,
            grid: `${ncols} × ${nrows}`,
            ncols,
            nrows,
            minElev: +minElev.toFixed(1),
            maxElev: +maxElev.toFixed(1),
            reliefM: +reliefM.toFixed(1),
            meanElev: +meanElev.toFixed(1),
            stdDevElev: +stdDevElev.toFixed(1),
            meanSlopeDeg: +meanSlopeDeg.toFixed(2),
            maxSlopeDeg: +maxSlopeDeg.toFixed(2),
            slopeBins,
            slopeCount,
            cellResolutionM: `${Math.round(dxMeters).toLocaleString()} × ${Math.round(dyMeters).toLocaleString()} m/cell`,
            nativeResolutionText: dem.resolutionText || `${dxDeg.toFixed(4)}°/cell`,
            coverageText: dem.coverageText,
            missingDataText: dem.missingDataText,
            widthKm: spanKm.widthKm,
            heightKm: spanKm.heightKm,
            areaKm2: spanKm.areaKm2,
            bbox,
            profile,
        };
        Object.defineProperty(dem, '_cachedMetrics', { value: metrics, enumerable: false, configurable: true });
        return metrics;
    }

    recordDemSnapshot(dem) {
        const metrics = this.computeDatasetMetrics(dem);
        if (!metrics) return this.demSnapshots;

        const bodyKey = metrics.body;
        if (this.slots[bodyKey]) {
            this.slots[bodyKey].dem = dem;
            this.slots[bodyKey].stats = metrics;
            this.slots[bodyKey].profile = metrics.profile;
        }

        const existingIdx = this.demSnapshots.findIndex(s => s.body === metrics.body && s.coverageText === metrics.coverageText);
        if (existingIdx !== -1) {
            this.demSnapshots.splice(existingIdx, 1);
        }
        this.demSnapshots.unshift(metrics);
        if (this.demSnapshots.length > 9) this.demSnapshots.pop();
        return this.demSnapshots;
    }

    /**
     * Computes physical-scale reference dimensions across all loaded comparison slots
     * so Earth, Moon, and Mars meshes render at a unified km-per-world-unit ratio
     * when scaleMode === 'physical'.
     */
    getPhysicalScaleContext(activeDems = null) {
        const activeStats = Array.isArray(activeDems) && activeDems.length
            ? activeDems.map(dem => this.computeDatasetMetrics(dem)).filter(Boolean)
            : Object.values(this.slots).map(slot => slot.stats).filter(Boolean);
        if (!activeStats.length) {
            return { maxSpanKm: 500, maxReliefM: 10000 };
        }
        const maxSpanKm = Math.max(10, ...activeStats.map(s => Math.max(s.widthKm || 10, s.heightKm || 10)));
        const maxReliefM = Math.max(500, ...activeStats.map(s => s.reliefM || 1000));
        return { maxSpanKm, maxReliefM };
    }

    /**
     * Synchronizes spherical camera offset (azimuth, polar angle, normalized zoom distance)
     * and target offset across all active side-by-side TerrainRenderer instances.
     */
    attachRendererSync(bodyKey, terrainRenderer) {
        if (!this.slots[bodyKey]) return;
        this.slots[bodyKey].renderer = terrainRenderer;

        terrainRenderer.onCameraChange = sourceRenderer => {
            if (!this.syncEnabled || this._isSyncingCamera) return;
            this._isSyncingCamera = true;
            try {
                const state = sourceRenderer.getCameraSphericalState();
                if (!state) return;
                for (const [otherKey, slot] of Object.entries(this.slots)) {
                    if (otherKey !== bodyKey && slot.renderer && slot.renderer !== sourceRenderer) {
                        slot.renderer.applyCameraSphericalState(state);
                    }
                }
            } finally {
                this._isSyncingCamera = false;
            }
        };
    }

    syncAllViewportsView(viewName) {
        this._isSyncingCamera = true;
        try {
            for (const slot of Object.values(this.slots)) {
                if (!slot.renderer) continue;
                if (viewName === 'fit') slot.renderer.fitCamera();
                else slot.renderer.setCameraView(viewName);
            }
        } finally {
            this._isSyncingCamera = false;
        }
    }

    setExaggerationAll(exag) {
        this.exaggeration = Math.max(1, Number(exag) || 1);
        for (const slot of Object.values(this.slots)) {
            slot.renderer?.updateExaggeration(this.exaggeration);
        }
    }

    setSurfaceModeAll(mode) {
        this.surfaceMode = mode;
        for (const slot of Object.values(this.slots)) {
            slot.renderer?.setSurfaceMode(mode);
        }
    }

    setColorMapAll(colorMap) {
        this.colorMap = colorMap;
        for (const slot of Object.values(this.slots)) {
            slot.renderer?.updateColorMap(colorMap);
        }
    }

    setWireframeAll(enabled) {
        this.wireframe = Boolean(enabled);
        for (const slot of Object.values(this.slots)) {
            slot.renderer?.setWireframe(this.wireframe);
        }
    }

    disposeAllRenderers() {
        for (const slot of Object.values(this.slots)) {
            if (slot.renderer) {
                slot.renderer.dispose();
                slot.renderer = null;
            }
        }
    }
}

// src/providers/MoonProvider.js
// Moon IAU Mean Earth configuration, LRO LROC-WAC basemaps, LOLA 4ppd DEM config, and lunar landmarks.

import { PLANETARY_CRS } from '../core/CoordinateEngine.js';
import { API_PROXY_BASE } from '../core/ApiConfig.js';

export const MoonProvider = {
    id: 'Moon',
    crs: PLANETARY_CRS.Moon,
    textureUrls: [
        'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.jpg',
        'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/0/0/0.jpg',
    ],
    wmtsTemplate: API_PROXY_BASE + '?url=' + encodeURIComponent('https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/') + '{z}/{y}/{x}.jpg',
    regionalImagery: {
        primary: {
            id: 'LRO_WAC_Mosaic_Global_303ppd_v02',
            name: 'NASA Moon Trek WMTS — LRO LROC-WAC Global Mosaic v02',
            endpoint: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
            projection: 'IAU2015:30100 Equirectangular (2:1)',
            tileMatrixSet: 'default028mm',
            resolution: '100 m/px (303 ppd)',
            date: 'LRO Mission Composite (v02)',
            coverage: 'Global (90°S–90°N, 180°W–180°E)',
            maxZoom: 4,
        },
    },
    fallbackColor: 0x9aa4b2,
    demSource: {
        url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.img',
        cols: 1440,
        rows: 720,
        littleEndian: true,
        nodata: -32768,
        scale: 0.5,
        label: 'LRO LOLA GDR 4 ppd Elevation (LDEM_4.IMG, PDS Geosciences Node)',
        mission: 'Lunar Reconnaissance Orbiter (LRO)',
        instrument: 'LOLA — Lunar Orbiter Laser Altimeter',
        units: 'meters relative to 1737.4 km reference radius',
    },
    dataSources: [
        { name: 'LRO LROC-WAC Global Mosaic (v02)', type: 'Global Basemap / WMTS', url: 'https://trek.nasa.gov', resolution: '100 m/px (303 ppd)' },
        { name: 'LRO LOLA GDR 4 ppd (LDEM_4.IMG)', type: 'Laser Altimetry DEM', url: 'https://pds-geosciences.wustl.edu/lro/', resolution: '0.25° (~7.6 km/px)' },
        { name: 'NASA PDS4 Registry (Moon)', type: 'Scientific Product Archive', url: 'https://pds.mcp.nasa.gov/api/search/1/', resolution: 'Product-level' },
    ],
    landmarks: [
        { name: 'Apollo 11 — Mare Tranquillitatis', lat: 0.6741, lon: 23.4730, type: 'Landing Site', mission: 'Apollo 11 / LRO', targetPair: 'JSC Houston (29.5578°N, 95.0867°W)', source: 'NASA LRO / Moon coordinates.docx', desc: 'First crewed lunar landing site; calibrated LRRR retroreflector benchmark.' },
        { name: 'Mare Tranquillitatis Analogue Reference', lat: 8.5, lon: 31.4, type: 'Basaltic Mare', mission: 'LRO / Kaguya', targetPair: 'JSC Houston & Víkursandur, Iceland', source: 'Moon coordinates.docx (lines 12, 202)', desc: 'Smooth basaltic mare basin paired with JSC Houston and Víkursandur black sand plains.' },
        { name: 'Apollo 15 — Hadley–Apennine Region', lat: 26.1322, lon: 3.6339, type: 'Landing Site / Rille', mission: 'Apollo 15 / LRO', targetPair: 'Flagstaff, Arizona (35.1983°N, 111.6513°W)', source: 'Moon coordinates.docx (line 106)', desc: 'Montes Apenninus & Rima Hadley geoscience traverse station.' },
        { name: 'Apollo 17 — Taurus-Littrow Valley', lat: 20.1908, lon: 30.7717, type: 'Landing Site', mission: 'Apollo 17 / LRO', targetPair: 'Cinder Lake / Flagstaff, Arizona', source: 'NASA LRO', desc: 'Deep drill core and pyroclastic orange glass soil sampling valley.' },
        { name: 'Shackleton Crater (Lunar South Pole)', lat: -89.9, lon: 0.0, type: 'Polar Crater', mission: 'LRO LOLA / Diviner', targetPair: 'Aquarius Reef Base, Askja & Devon Island', source: 'Moon coordinates.docx (lines 30, 70, 212)', desc: 'Permanently shadowed interior trap for volatiles with sunlit rim crests.' },
        { name: 'Malapert Massif (Artemis Candidate)', lat: -85.9948, lon: -0.2358, type: 'South Polar Massif', mission: 'LRO LOLA / LROC', targetPair: 'ESA/DLR LUNA, Dome C Concordia & Svalbard', source: 'Moon coordinates.docx (lines 22, 152, 247)', desc: 'High-elevation south polar ridge with high Earth visibility and illumination.' },
        { name: 'Tycho Crater Central Peak', lat: -43.31, lon: -11.36, type: 'Complex Impact Crater', mission: 'LRO LROC / Diviner', targetPair: 'Meteor Crater, AZ & Haughton Crater, Canada', source: 'Moon coordinates.docx (lines 111, 227)', desc: '85 km Copernican impact crater with prominent ray system and central peak.' },
        { name: 'Aristarchus Plateau', lat: 23.67, lon: -47.53, type: 'Volcanic Plateau', mission: 'LRO / Chandrayaan-1', targetPair: 'Biosphere 2, Arizona (32.5788°N, 110.8506°W)', source: 'Moon coordinates.docx (line 17)', desc: 'Elevated crustal block rich in pyroclastic deposits and sinuous rilles.' },
        { name: 'Marius Hills Skylight & Domes', lat: 14.0, lon: -56.0, type: 'Volcanic Domes / Lava Tube', mission: 'SELENE Kaguya / LRO', targetPair: 'Lanzarote, Spain & Icelandic Lava Tubes', source: 'Moon coordinates.docx (lines 46, 78, 207)', desc: 'Concentration of lunar volcanic cones, domes, and a collapsed lava-tube skylight.' },
        { name: 'Rimae Prinz', lat: 26.0, lon: -44.0, type: 'Sinuous Rilles', mission: 'LRO LROC', targetPair: 'Sardinia, Italy (40.12°N, 9.01°E)', source: 'Moon coordinates.docx (line 50)', desc: 'System of volcanic sinuous rilles north of Crater Prinz.' },
        { name: 'Mare Imbrium', lat: 32.8, lon: -15.6, type: 'Impact Basin / Mare', mission: 'LRO / Chang’e 3', targetPair: 'Askja Volcano, Iceland & Mauna Loa, Hawaiʻi', source: 'Moon coordinates.docx (lines 74, 177, 197)', desc: 'Vast flood-basalt plain displaying wrinkle ridges and lobate scarps.' },
        { name: 'Oceanus Procellarum', lat: 18.4, lon: -57.4, type: 'KREEP Basaltic Mare', mission: 'LRO / Chang’e 5', targetPair: 'Mauna Kea, Hawaiʻi (19.8207°N, 155.4681°W)', source: 'Moon coordinates.docx (line 182)', desc: 'Largest lunar basaltic mare province, rich in late-stage volcanic units.' },
        { name: 'Schrödinger Basin (Lunar Far Side)', lat: -75.0, lon: 132.4, type: 'Peak-Ring Impact Basin', mission: 'LRO LOLA / GRAIL', targetPair: 'Pavilion Lake, Canada (50.8673°N, 121.7351°W)', source: 'Moon coordinates.docx (line 38)', desc: '320 km well-preserved peak-ring basin within the South Pole–Aitken Basin.' },
        { name: 'Leibnitz Beta Plateau', lat: -85.0, lon: 30.0, type: 'Polar Highland Plateau', mission: 'LRO LOLA', targetPair: 'Svalbard Archipelago, Norway (78.22°N, 15.65°E)', source: 'Moon coordinates.docx (line 252)', desc: 'High-altitude south polar plateau near Mons Mouton.' },
        // Preserved User Coordinate Reference Moon Targets (A. EARTH ↔ MOON)
        { name: 'Mare Imbrium* (Reference Table)', lat: 34.72, lon: -14.91, coordText: '34.72°N, 14.91°W', type: 'Reference Table Target', mission: 'AstroLoc Reference Dataset', pairingStatus: 'table_pairing', targetPair: 'Candidate Table Pairings: Astroland (Δ° 12.24), Krafla (Δ° 31.02), Svalbard (Δ° 45.58), Devon Island (Δ° 52.78)', source: 'AstroLoc_Earth_Moon_Mars_Coordinate_Reference.txt', desc: 'Preserved Moon reference coordinate (34.72°N, 14.91°W) distinct from provider Mare Imbrium entry (32.8°N, 15.6°W).' },
        { name: 'Oceanus Procellarum / Marius Hills* (Reference Table)', lat: 20.67, lon: -56.68, coordText: '20.67°N, 56.68°W', type: 'Reference Table Target', mission: 'AstroLoc Reference Dataset', pairingStatus: 'table_pairing', targetPair: 'Candidate Table Pairings: Mars Dune Alpha (Δ° 35.72), Biosphere 2 (Δ° 49.34), MDRS (Δ° 49.53), HI-SEAS (Δ° 90.95)', source: 'AstroLoc_Earth_Moon_Mars_Coordinate_Reference.txt', desc: 'Preserved Moon reference coordinate (20.67°N, 56.68°W) distinct from individual Oceanus Procellarum (18.4, -57.4) and Marius Hills (14.0, -56.0) entries.' },
        { name: 'Mare Tranquillitatis (8.3°N, 33.2°E Reference Table)', lat: 8.3, lon: 33.2, coordText: '8.3°N, 33.2°E', type: 'Reference Table Target', mission: 'AstroLoc Reference Dataset', pairingStatus: 'table_pairing', targetPair: 'Candidate Table Pairings: Mount Popa (Δ° 61.00), Singu Plateau (Δ° 61.75), Hpakant–Tawmaw (Δ° 62.22)', source: 'AstroLoc_Earth_Moon_Mars_Coordinate_Reference.txt', desc: 'Preserved Moon reference coordinate (8.3°N, 33.2°E) distinct from Apollo 11 (0.6741, 23.4730) and Mare Tranquillitatis (8.5, 31.4).' },
        { name: 'Hadley–Apennine (26.13°N, 3.63°E Reference Table)', lat: 26.13, lon: 3.63, coordText: '26.13°N, 3.63°E', type: 'Reference Table Target', mission: 'AstroLoc Reference Dataset', pairingStatus: 'table_pairing', targetPair: 'Candidate Table Pairings: Dachstein Ice Caves (Δ° 22.82), LunAres (Δ° 28.76), Mars-500 (Δ° 38.46)', source: 'AstroLoc_Earth_Moon_Mars_Coordinate_Reference.txt', desc: 'Preserved 2-decimal Moon reference coordinate (26.13°N, 3.63°E) alongside Apollo 15 entry (26.1322, 3.6339).' },
    ],
};

// Default regional bounds are derived from each landmark's published coordinates.
// Longitude is kept unwrapped when crossing the antimeridian; crop utilities normalize it.
MoonProvider.landmarks = MoonProvider.landmarks.map(landmark => {
    if (landmark.bbox) return landmark;
    const halfSpan = 5;
    const north = Math.min(90, landmark.lat + halfSpan);
    const south = Math.max(-90, landmark.lat - halfSpan);
    const normalizeLon = value => ((value + 180) % 360 + 360) % 360 - 180;
    const rawWest = landmark.lon - halfSpan;
    const rawEast = landmark.lon + halfSpan;
    const west = normalizeLon(rawWest);
    const east = normalizeLon(rawEast);
    return { ...landmark, bbox: {
        north, south, west, east,
        spanDegrees: halfSpan * 2,
        wrapsAntimeridian: west > east,
    } };
});

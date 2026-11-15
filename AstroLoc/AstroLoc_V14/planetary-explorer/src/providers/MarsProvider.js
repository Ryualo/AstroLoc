// src/providers/MarsProvider.js
// Mars IAU 2000 configuration, USGS Viking/MOLA basemaps, MOLA 4ppd DEM config, and Martian landmarks.

import { PLANETARY_CRS } from '../core/CoordinateEngine.js';
import { API_PROXY_BASE } from '../core/ApiConfig.js';
import { EarthProvider } from './EarthProvider.js';
import { MoonProvider } from './MoonProvider.js';

export const MarsProvider = {
    id: 'Mars',
    crs: PLANETARY_CRS.Mars,
    textureUrls: [
        'https://astrogeology.usgs.gov/ckan/dataset/f0c2f407-0d1c-4b83-9b81-25b2d2216888/resource/69f06299-7552-49f1-8259-27908c0d7d8e/download/mars_viking_mdim21_clrmosaic_global_1024.jpg',
        'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/0/0/0.jpg',
    ],
    wmtsTemplate: API_PROXY_BASE + '?url=' + encodeURIComponent('https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/') + '{z}/{y}/{x}.jpg',
    regionalImagery: {
        primary: {
            id: 'CTX_beta01_uncontrolled_5m_Caltech',
            name: 'NASA Mars Trek WMTS — MRO CTX Global Beta Mosaic (Caltech)',
            endpoint: 'https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
            projection: 'IAU2015:49900 Equirectangular (2:1)',
            tileMatrixSet: 'default028mm',
            resolution: '~5 m/px (MRO Context Camera)',
            date: 'MRO CTX Global Beta01 Composite',
            coverage: 'Near-Global Regional Coverage (with automatic MDIM 2.1 fallback)',
            maxZoom: 4,
        },
        fallback: {
            id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
            name: 'NASA Mars Trek WMTS — USGS Viking MDIM 2.1 Color Mosaic',
            endpoint: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
            projection: 'IAU2015:49900 Equirectangular (2:1)',
            tileMatrixSet: 'default028mm',
            resolution: '232 m/px',
            date: 'Viking Orbiter MDIM 2.1',
            coverage: 'Global (90°S–90°N, 180°W–180°E)',
            maxZoom: 4,
        },
    },
    fallbackColor: 0xc86b46,
    demSource: {
        url: 'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg004/megt90n000cb.img',
        cols: 1440,
        rows: 720,
        littleEndian: false,
        nodata: -32768,
        scale: 1.0,
        label: 'MGS MOLA MEGDR 4 ppd Topography (MEGT90N000CB.IMG, PDS Geosciences Node)',
        mission: 'Mars Global Surveyor (MGS)',
        instrument: 'MOLA — Mars Orbiter Laser Altimeter',
        units: 'meters above MOLA areoid',
    },
    dataSources: [
        { name: 'USGS Viking MDIM 2.1 Colorized Global Mosaic', type: 'Global Basemap / WMTS', url: 'https://trek.nasa.gov', resolution: '232 m/px' },
        { name: 'MGS MOLA MEGDR 4 ppd (MEGT90N000CB.IMG)', type: 'Laser Altimetry DEM', url: 'https://pds-geosciences.wustl.edu/mgs/', resolution: '0.25° (~14.8 km/px)' },
        { name: 'NASA PDS4 Registry (Mars)', type: 'Scientific Product Archive', url: 'https://pds.mcp.nasa.gov/api/search/1/', resolution: 'Product-level' },
    ],
    landmarks: [
        { name: 'Jezero Crater (Perseverance)', lat: 18.38, lon: 77.58, type: 'Rover Landing Site', mission: 'Mars 2020 / MRO HiRISE', targetPair: 'Pilbara Stromatolites, Australia & Atacama', source: 'Mars loc.docx (lines 257, 260, 270)', desc: 'Ancient lacustrine fan-delta deposit explored by the Perseverance rover.' },
        { name: 'Gale Crater / Aeolis Mons (Curiosity)', lat: -5.4, lon: 137.8, type: 'Rover Landing Site', mission: 'MSL Curiosity / MRO', targetPair: 'McMurdo Dry Valleys, Antarctica (77.47°S, 162.52°E)', source: 'Moon coordinates.docx & Mars loc.docx (line 270)', desc: '154 km crater containing layered clay and sulfate-bearing sedimentary strata.' },
        { name: 'Olympus Mons Summit Caldera', lat: 18.65, lon: -133.8, type: 'Shield Volcano', mission: 'MGS MOLA / Mars Odyssey', targetPair: 'Mauna Loa, Hawaiʻi', source: 'app.js & Mars loc.docx', desc: 'Largest planetary shield volcano in the Solar System (~21.9 km above MOLA areoid).' },
        { name: 'Utopia Planitia (Viking 2 / Zhurong)', lat: 46.7, lon: 118.0, type: 'Impact Basin Plains', mission: 'Viking 2 / MRO', targetPair: 'Mojave Desert, California (35.0°N, 115.5°W)', source: 'Moon coordinates.docx & Mars loc.docx (line 259)', desc: 'Northern lowland basin hosting scalloped periglacial terrain and subsurface water ice.' },
        { name: 'Korolev Crater', lat: 72.77, lon: 164.58, type: 'Ice-Filled Crater', mission: 'Mars Express / MRO', targetPair: 'Devon Island & Antarctic Plateau', source: 'Mars loc.docx (line 256)', desc: '82 km northern crater containing a permanent 1.8 km thick water-ice mound.' },
        { name: 'Endeavour Crater (Opportunity)', lat: -2.28, lon: -5.30, type: 'Noachian Impact Crater', mission: 'MER Opportunity / MRO', targetPair: 'MDRS / Pilot Valley, Utah', source: 'Mars loc.docx (line 257)', desc: '22 km crater in Meridiani Planum exposing phyllosilicate-bearing Noachian rim rocks.' },
        { name: 'Meridiani Planum', lat: -2.0, lon: -6.0, type: 'Hematite Plains', mission: 'MER Opportunity / TES', targetPair: 'Hanksville & San Rafael Swell, Utah', source: 'Mars loc.docx (line 267)', desc: 'Equatorial plains rich in crystalline grey hematite spherules and sulfate evaporites.' },
        { name: 'Phoenix Landing Site (Vastitas Borealis)', lat: 68.22, lon: -125.75, type: 'Polar Lander Site', mission: 'Phoenix Mars Lander', targetPair: 'McMurdo Dry Valleys & Alaska Permafrost', source: 'Mars loc.docx (line 261)', desc: 'High-latitude polygonal permafrost plains where shallow water ice and perchlorates were sampled.' },
        { name: 'Nili Fossae', lat: 21.0, lon: 74.0, type: 'Tectonic Graben System', mission: 'MRO CRISM / HiRISE', targetPair: 'Svalbard Bockfjord Complex', source: 'Mars loc.docx (line 270)', desc: 'Olivine, carbonate, and phyllosilicate-rich graben troughs northwest of Isidis Planitia.' },
        { name: 'Eberswalde Crater Delta', lat: -23.9, lon: -33.3, type: 'Inverted Fluvial Delta', mission: 'MGS MOC / MRO HiRISE', targetPair: 'Atacama / Colorado Plateau Channels', source: 'Mars loc.docx (line 270 — 326.7°E)', desc: '37 km crater preserving a lithified, inverted meandering river delta.' },
        { name: 'Chryse Planitia (Viking 1)', lat: 22.48, lon: -47.97, type: 'Outflow Channel Plains', mission: 'Viking 1 / Pathfinder', targetPair: 'Verde Valley, Arizona', source: 'Mars loc.docx (line 275)', desc: 'Northern circular plain at the terminus of Kasei, Maja, and Ares Vallis outflow channels.' },
        { name: 'Deuteronilus Mensae', lat: 42.2, lon: 24.7, type: 'Lobate Debris Aprons', mission: 'MRO SHARAD / CTX', targetPair: 'Arctic Rock Glaciers (GPR Campaign)', source: 'Mars loc.docx (line 266)', desc: 'Dichotomy boundary fretted terrain containing massive debris-covered glaciers.' },
        { name: 'Planum Boreum (Martian North Pole)', lat: 80.0, lon: 15.0, type: 'Polar Layered Deposits', mission: 'MRO SHARAD / MOLA', targetPair: 'Dome C, Antarctica', source: 'Mars loc.docx (line 262)', desc: 'Northern polar ice cap incised by spiral troughs and Chasma Boreale.' },
        { name: 'Planum Australe (Martian South Pole)', lat: -85.0, lon: 160.0, type: 'Polar Layered Deposits', mission: 'MRO / Mars Express MARSIS', targetPair: 'Concordia Station, Antarctica', source: 'Mars loc.docx (line 263)', desc: 'Southern polar cap of water ice and residual CO₂ ice.' },
        { name: 'Elysium Mons', lat: 22.3, lon: -112.8, type: 'Volcanic Shield', mission: 'MGS MOLA / Mars Odyssey', targetPair: 'Icelandic Volcanic Highlands', source: 'Mars loc.docx (line 280)', desc: 'Major shield volcano rising 14 km above the surrounding Elysium volcanic province.' },
        { name: 'Alba Mons', lat: 9.0, lon: -121.0, type: 'Low-Sloped Volcano', mission: 'MGS MOLA', targetPair: 'Volcanic Rift Zones', source: 'Mars loc.docx (line 283 — 239.0°E)', desc: 'Broad, low-relief volcanic structure encircled by concentric graben.' },
        { name: 'Valles Marineris (Melas Chasma)', lat: -9.8, lon: -73.6, type: 'Tectonic Canyon System', mission: 'MRO CTX / CRISM / MOLA', targetPair: 'East African Rift / Grand Canyon', source: 'app.js reference landmark', desc: 'Deepest central trough of the 4,000 km Valles Marineris canyon system.' },
        { name: 'Hellas Planitia Basin Floor', lat: -42.4, lon: 70.5, type: 'Giant Impact Basin', mission: 'MGS MOLA / MRO', targetPair: 'South Pole–Aitken Basin (Moon)', source: 'app.js reference landmark', desc: '2,300 km impact basin reaching 7,152 m below the Mars topographic datum.' },
        // Preserved User Coordinate Reference Mars Target (B. EARTH ↔ MARS)
        { name: 'Tharsis Volcanic Region (Reference Table)', lat: 18.4, lon: -133.8, coordText: '18.4°N, 133.8°W', type: 'Reference Table Target', mission: 'AstroLoc Reference Dataset', pairingStatus: 'table_pairing', targetPair: 'Candidate Table Pairing: HI-SEAS, Hawaii (19.60°N, 155.49°W, Δ° 20.53)', source: 'AstroLoc_Earth_Moon_Mars_Coordinate_Reference.txt', desc: 'Preserved Mars reference coordinate (18.4°N, 133.8°W) distinct from Olympus Mons Summit Caldera (18.65, -133.8).' },
    ],
};


// Default regional bounds are derived from each landmark's published coordinates.
// Longitude is kept unwrapped when crossing the antimeridian; crop utilities normalize it.
MarsProvider.landmarks = MarsProvider.landmarks.map(landmark => {
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

export const PROVIDERS = {
    Earth: EarthProvider,
    Moon: MoonProvider,
    Mars: MarsProvider,
};

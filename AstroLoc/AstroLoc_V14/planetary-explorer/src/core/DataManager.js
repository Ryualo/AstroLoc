// src/core/DataManager.js
import { buildProxyUrl } from './ApiConfig.js';
// Bounded-retry HTTP proxy client, NASA PDS4 query engine, file inventory resolver, and Earth geocoder.

export const API_CONFIG = {
    PDS_API_BASE: 'https://pds.mcp.nasa.gov/api/search/1',
    NASA_API_BASE: 'https://api.nasa.gov',
    NOMINATIM_BASE: 'https://nominatim.openstreetmap.org',
    DEFAULT_NASA_KEY: 'm8kMqrgD9cRR6DBMgqRhQCFzt7ffKThhcLDWjRH9',
    REQUEST_TIMEOUT_MS: 30000,
    MAX_RETRIES: 2,
    DEFAULT_LIMIT: 25,
};

export const PDS_MISSIONS = {
    lunar_reconnaissance_orbiter: ['urn:nasa:pds:context:investigation:mission.lunar_reconnaissance_orbiter', 'Lunar Reconnaissance Orbiter (LRO)'],
    kaguya: ['urn:nasa:pds:context:investigation:mission.kaguya', 'SELENE (Kaguya)'],
    'chandrayaan-1': ['urn:nasa:pds:context:investigation:mission.chandrayaan-1', 'Chandrayaan-1'],
    mars_reconnaissance_orbiter: ['urn:nasa:pds:context:investigation:mission.mars_reconnaissance_orbiter', 'Mars Reconnaissance Orbiter (MRO)'],
    mars_odyssey: ['urn:nasa:pds:context:investigation:mission.2001_mars_odyssey', '2001 Mars Odyssey'],
    mars_global_surveyor: ['urn:nasa:pds:context:investigation:mission.mars_global_surveyor', 'Mars Global Surveyor (MGS)'],
};

export const PDS_INSTRUMENT_NAMES = {
    lola: 'Lunar Orbiter Laser Altimeter',
    lroc: 'Lunar Reconnaissance Orbiter Camera',
    diviner: 'Diviner Lunar Radiometer',
    mola: 'Mars Orbiter Laser Altimeter',
    hirise: 'High Resolution Imaging Science Experiment',
    ctx: 'Context Camera',
    themis: 'Thermal Emission Imaging System',
    crism: 'Compact Reconnaissance Imaging Spectrometer',
};

let apiCallCount = 0;
const listeners = new Set();

export function onApiCallCountChange(fn) {
    listeners.add(fn);
}

export function getApiCallCount() {
    return apiCallCount;
}

function bumpApiCounter() {
    apiCallCount++;
    listeners.forEach(fn => fn(apiCallCount));
}

export async function httpFetch(url, options = {}, retries = 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || API_CONFIG.REQUEST_TIMEOUT_MS);
    const startTime = performance.now();
    bumpApiCounter();

    try {
        const fetchOptions = {
            method: options.method || 'GET',
            headers: options.headers || {},
            signal: controller.signal,
        };
        if (options.body) fetchOptions.body = options.body;

        const response = await fetch(buildProxyUrl(url), fetchOptions);
        clearTimeout(timeoutId);
        const latency = Math.round(performance.now() - startTime);

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('json') ? await response.json() : await response.text();

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            data,
            latency,
            headers: Object.fromEntries(response.headers.entries()),
            size: typeof data === 'string' ? data.length : JSON.stringify(data).length,
        };
    } catch (err) {
        clearTimeout(timeoutId);
        const latency = Math.round(performance.now() - startTime);
        const isAbort = err.name === 'AbortError';
        if (retries < API_CONFIG.MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 900));
            return httpFetch(url, options, retries + 1);
        }
        return {
            ok: false,
            status: 0,
            statusText: isAbort ? 'Timeout' : 'Network Error',
            data: null,
            latency,
            error: isAbort
                ? `Request timed out after ${API_CONFIG.REQUEST_TIMEOUT_MS}ms`
                : (err.message || 'Network request failed. Ensure python3 server.py is running.'),
        };
    }
}

export function pdsEq(field, value) {
    return `(${field} eq "${String(value).replace(/[\\"]/g, '\\$&')}")`;
}

export function buildPDSQuery(filters = {}) {
    const c = [];
    const targetEq = v => pdsEq('pds:Target_Identification.pds:name', v);
    if (filters.target && filters.target !== 'Earth') {
        c.push(targetEq(filters.target));
    } else if (filters.defaultMoonMars) {
        c.push(`(${targetEq('Moon')} or ${targetEq('Mars')})`);
    }
    if (filters.mission) {
        const m = PDS_MISSIONS[filters.mission];
        c.push(m ? pdsEq('ref_lid_investigation', m[0]) : pdsEq('pds:Investigation_Area.pds:name', filters.mission));
    }
    if (filters.instrument) {
        c.push(pdsEq('pds:Instrument.pds:name', PDS_INSTRUMENT_NAMES[filters.instrument] || filters.instrument));
    }
    if (filters.processingLevel) {
        c.push(pdsEq('pds:Primary_Result_Summary.pds:processing_level', filters.processingLevel));
    }
    return c.length === 0 ? '' : c.length === 1 ? c[0] : `(${c.join(' and ')})`;
}

export function getPropertyValue(props, key) {
    const val = props?.[key];
    if (val === undefined || val === null) return '';
    return Array.isArray(val) ? String(val[0]) : String(val);
}

export function getExplicitProductType(props) {
    const candidates = [
        getPropertyValue(props, 'pds:Identification_Area.pds:product_type'),
        getPropertyValue(props, 'pds:Primary_Result_Summary.pds:product_type'),
        getPropertyValue(props, 'ops:product_type'),
        getPropertyValue(props, 'product_type'),
        getPropertyValue(props, 'pds:Identification_Area.pds:product_class'),
    ].filter(Boolean);
    return candidates.find(v => /(^|[^A-Z])(MEAS|DER)([^A-Z]|$)/i.test(v)) || '';
}

export function classifyProduct(processingLevel, explicitType = '') {
    const explicit = String(explicitType || '').toLowerCase();
    if (/(^|[^a-z])der([^a-z]|$)|derived/.test(explicit)) return { label: 'DER', class: 'der' };
    if (/(^|[^a-z])meas([^a-z]|$)|measurement/.test(explicit)) return { label: 'MEAS', class: 'meas' };
    return { label: '—', class: '' };
}

export async function searchPDS(filters = {}) {
    const params = new URLSearchParams();
    const q = buildPDSQuery(filters);
    if (q) params.set('q', q);
    if (filters.keyword && !q) params.set('keywords', filters.keyword.trim());
    params.set('limit', String(filters.limit ?? API_CONFIG.DEFAULT_LIMIT));
    const sort = filters.sort === 'pds:Time_Coordinates.pds:start_date_time'
        ? 'pds:Time_Coordinates.pds:start_date_time'
        : 'ops:Harvest_Info.ops:harvest_date_time';
    params.set('sort', sort);
    if (filters.searchAfter) params.set('search-after', filters.searchAfter);

    const requestOptions = { headers: { Accept: 'application/json' } };
    let result = await httpFetch(`${API_CONFIG.PDS_API_BASE}/products?${params}`, requestOptions);

    if (!result.ok && [502, 503, 504].includes(result.status)) {
        const nodeBases = ['https://pds.nasa.gov/api/search-geo/1', 'https://pds.nasa.gov/api/search-img/1'];
        const nodeResults = [];
        for (const base of nodeBases) {
            const nr = await httpFetch(`${base}/products?${params}`, requestOptions);
            if (nr.ok && Array.isArray(nr.data?.data)) nodeResults.push(nr);
        }
        if (nodeResults.length) {
            const merged = [];
            const seen = new Set();
            for (const nr of nodeResults) {
                for (const product of nr.data.data) {
                    const props = product.properties || product;
                    const id = getPropertyValue(props, 'lidvid') || getPropertyValue(props, 'lid');
                    const key = String(id || JSON.stringify(product));
                    if (!seen.has(key)) {
                        seen.add(key);
                        merged.push(product);
                    }
                }
            }
            result = {
                ...nodeResults[0],
                ok: true,
                status: 200,
                data: { ...nodeResults[0].data, data: merged, summary: { hits: merged.length }, partial: true },
            };
        }
    }

    if (result.ok && result.data && Array.isArray(result.data.data)) {
        let rows = result.data.data;
        if (filters.keyword && q) {
            const needle = filters.keyword.toLowerCase();
            rows = rows.filter(x => JSON.stringify(x?.properties || x || {}).toLowerCase().includes(needle));
        }
        if (filters.productType) {
            rows = rows.filter(x => classifyProduct('', getExplicitProductType(x.properties || x)).label === filters.productType);
        }
        result.data = { ...result.data, data: rows };
    }
    return result;
}

export async function searchPDSByLidvid(lidvid, fullPds4 = false) {
    const url = `${API_CONFIG.PDS_API_BASE}/products/${encodeURIComponent(lidvid)}`;
    return await httpFetch(url, {
        headers: { Accept: fullPds4 ? 'application/vnd.nasa.pds.pds4+json' : 'application/json' },
    });
}

export async function getPDSProductCount(target) {
    const params = new URLSearchParams({ limit: '0' });
    if (target) params.set('q', pdsEq('pds:Target_Identification.pds:name', target));
    const res = await httpFetch(`${API_CONFIG.PDS_API_BASE}/products?${params}`, { headers: { Accept: 'application/json' } });
    return res.ok && res.data?.summary ? (res.data.summary.hits || 0) : null;
}

export async function geocodeEarthLocation(query) {
    if (!query || !query.trim()) return [];
    const params = new URLSearchParams({
        q: query.trim(),
        format: 'jsonv2',
        limit: '6',
    });
    const res = await httpFetch(`${API_CONFIG.NOMINATIM_BASE}/search?${params}`, {
        headers: { Accept: 'application/json' },
    });
    if (!res.ok || !Array.isArray(res.data)) return [];
    return res.data.map(item => ({
        name: item.display_name,
        lat: Number(item.lat),
        lon: Number(item.lon),
        type: item.type || 'Earth Gazetteer',
        body: 'Earth',
        source: 'OpenStreetMap Nominatim Gazetteer',
        bbox: item.boundingbox
            ? {
                south: Number(item.boundingbox[0]),
                north: Number(item.boundingbox[1]),
                west: Number(item.boundingbox[2]),
                east: Number(item.boundingbox[3]),
            }
            : null,
    }));
}

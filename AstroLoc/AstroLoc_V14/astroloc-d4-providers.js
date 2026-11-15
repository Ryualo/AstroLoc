/**
 * astroloc-d4-providers.js
 * AstroLoc Phase 2 — D4 (Water, Ice & Subsurface) data-provider layer.
 *
 * Uniform provider contract. Every provider returns the SAME envelope so callers
 * never special-case a source:
 *
 *   {
 *     providerId, label, body, status,
 *     measurements: [ { key, label, value, unit, status, source, instrument,
 *                       timestamp, spatialResolution, epistemicClass, note } ],
 *     meta: { endpoint, retrievedAt, latencyMs, httpStatus, fromCache, error, license }
 *   }
 *
 * status: 'OK' | 'EMPTY' | 'TIMEOUT' | 'ERROR' | 'UNAVAILABLE' | 'OFFLINE'
 *
 * No measurement is ever synthesised. Unavailable sources report UNAVAILABLE with
 * a documented reason instead of a placeholder number.
 *
 * Verified live on 2026-11-15 (Phase 2 probes):
 *   - pds.mcp.nasa.gov/api/search/1  -> HTTP 200
 *   - power.larc.nasa.gov climatology -> HTTP 200 (GWETTOP real values)
 *   - macrostrat.org/api/v2          -> HTTP 200 (licence CC-BY 4.0)
 *   - SHARAD bundles: urn:nasa:pds:mro_sharad_us_radargrams,
 *     urn:nasa:pds:mro_sharad_simulations, urn:nasa:pds:mro_sharad_3d
 *
 * Unverified after two documented attempts — reported UNAVAILABLE, never faked:
 *   - LRO Diviner / Mini-RF / THEMIS PDS instrument LIDs (0 hits)
 *   - trek.nasa.gov Diviner WMTS layer (HTTP 404)
 */
(function (root) {
  'use strict';

  const D4_STATUS = Object.freeze({
    OK: 'OK',
    EMPTY: 'EMPTY',
    TIMEOUT: 'TIMEOUT',
    ERROR: 'ERROR',
    UNAVAILABLE: 'UNAVAILABLE',
    OFFLINE: 'OFFLINE'
  });

  // Epistemic vocabulary already used by the AstroLoc scoring engine.
  const EPISTEMIC = Object.freeze({
    MEASURED: 'measured',
    DERIVED: 'derived',
    INFERRED: 'inferred',
    UNAVAILABLE: 'unknown'
  });

  const D4_CACHE_KEY = 'astroloc_d4_provider_cache_v1';
  const MAX_RETRIES = 2;          // stop rule: maximum two retries per provider
  const DEFAULT_TIMEOUT_MS = 6500;
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h — reanalysis/archive data is not real-time

  // ---------------------------------------------------------------------------
  // Cache (localStorage; degrades silently to memory-only when unavailable)
  // ---------------------------------------------------------------------------
  const memoryCache = new Map();

  function readCache(key) {
    const now = Date.now();
    const mem = memoryCache.get(key);
    if (mem && now - mem.t < CACHE_TTL_MS) return mem.v;
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(D4_CACHE_KEY);
      if (!raw) return null;
      const store = JSON.parse(raw);
      const entry = store[key];
      if (!entry || now - entry.t >= CACHE_TTL_MS) return null;
      memoryCache.set(key, entry);
      return entry.v;
    } catch (err) {
      return null;
    }
  }

  function writeCache(key, value) {
    const entry = { t: Date.now(), v: value };
    memoryCache.set(key, entry);
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(D4_CACHE_KEY);
      const store = raw ? JSON.parse(raw) : {};
      store[key] = entry;
      // Bound the cache so a long scanning session cannot exhaust storage.
      const keys = Object.keys(store);
      if (keys.length > 120) {
        keys.sort((a, b) => (store[a].t || 0) - (store[b].t || 0))
          .slice(0, keys.length - 120)
          .forEach(k => { delete store[k]; });
      }
      localStorage.setItem(D4_CACHE_KEY, JSON.stringify(store));
    } catch (err) { /* quota / private mode — memory cache still holds the value */ }
  }


  // ---------------------------------------------------------------------------
  // Shared HTTP core — bounded retries, hard timeout, never blocks the app
  // ---------------------------------------------------------------------------

  /**
   * Route browser requests through the local allowlisted proxy so the app works
   * exactly like the existing providers (proxy-server.js injects headers and
   * enforces its SSRF allowlist). Under Node (tests) the URL is used directly.
   */
  function resolveD4Url(url) {
    if (typeof window === 'undefined' || !window.location) return url;
    try {
      if (!/^https?:/i.test(String(window.location.protocol))) return url;
      return `${window.location.origin}/proxy?url=${encodeURIComponent(url)}`;
    } catch (err) {
      return url;
    }
  }

  async function d4Fetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, accept = 'application/json', direct = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
      const resp = await fetch(direct ? url : resolveD4Url(url), { method: 'GET', headers: { Accept: accept }, signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - started);
      if (resp.status === 429) {
        return { ok: false, status: resp.status, latencyMs, error: 'RATE_LIMITED (429)' };
      }
      if (!resp.ok) {
        return { ok: false, status: resp.status, latencyMs, error: `HTTP ${resp.status}` };
      }
      const text = await resp.text();
      let data = null;
      try { data = JSON.parse(text); } catch (err) { data = text; }
      return { ok: true, status: resp.status, latencyMs, data };
    } catch (err) {
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - started);
      if (err && err.name === 'AbortError') {
        return { ok: false, status: 0, latencyMs, error: 'TIMEOUT' };
      }
      return { ok: false, status: 0, latencyMs, error: (err && err.message) || 'NETWORK ERROR' };
    }
  }

  // Bounded retry wrapper — exactly MAX_RETRIES retries, then gives up.
  async function d4FetchWithRetry(url, opts) {
    let last = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      last = await d4Fetch(url, opts);
      if (last.ok) return last;
      // Do not retry deterministic client errors or rate limits — retrying would
      // only deepen a rate-limit problem.
      if (last.error === 'RATE_LIMITED (429)' || /^HTTP 4/.test(last.error)) break;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
    return last;
  }

  function envelope(providerId, label, body) {
    return {
      providerId,
      label,
      body,
      status: D4_STATUS.ERROR,
      measurements: [],
      meta: {
        endpoint: null,
        retrievedAt: new Date().toISOString(),
        latencyMs: null,
        httpStatus: null,
        fromCache: false,
        error: null,
        license: null
      }
    };
  }

  function measurement(key, label, value, unit, opts = {}) {
    return {
      key,
      label,
      value: value === undefined || value === null ? null : value,
      unit: unit || '',
      status: value === null || value === undefined ? 'MISSING' : 'PRESENT',
      source: opts.source || null,
      instrument: opts.instrument || null,
      timestamp: opts.timestamp || null,
      spatialResolution: opts.spatialResolution || null,
      epistemicClass: opts.epistemicClass || EPISTEMIC.MEASURED,
      note: opts.note || null
    };
  }

  function unavailableEnvelope(env, reason, endpoint) {
    env.status = D4_STATUS.UNAVAILABLE;
    env.meta.error = reason;
    env.meta.endpoint = endpoint || null;
    env.measurements.push(measurement('provider_status', 'Provider Status', null, 'flag', {
      note: reason,
      epistemicClass: EPISTEMIC.UNAVAILABLE
    }));
    return env;
  }

  // ---------------------------------------------------------------------------
  // Provider 1 — NASA PDS Search API (verified HTTP 200 on 2026-11-15)
  // Enumerates real SHARAD subsurface-radar bundles for a Mars target.
  // ---------------------------------------------------------------------------
  const PDS_BASE = 'https://pds.mcp.nasa.gov/api/search/1';
  const SHARAD_BUNDLES = [
    { lid: 'urn:nasa:pds:mro_sharad_us_radargrams', label: 'SHARAD U.S. Radargrams (Derived)' },
    { lid: 'urn:nasa:pds:mro_sharad_simulations', label: 'SHARAD Clutter Simulations' },
    { lid: 'urn:nasa:pds:mro_sharad_3d', label: 'SHARAD 3D Radargrams (Putzig/MDAP)' }
  ];

  function pdsProp(props, key) {
    const v = props ? props[key] : undefined;
    if (v === undefined || v === null) return null;
    return Array.isArray(v) ? v[0] : v;
  }

  async function providerPdsSharad() {
    const env = envelope('pds_sharad', 'NASA PDS — MRO SHARAD Subsurface Radar Bundles', 'Mars');
    const cacheKey = 'pds_sharad';
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, meta: { ...cached.meta, fromCache: true } };

    const results = [];
    const errors = [];
    for (const bundle of SHARAD_BUNDLES) {
      // Use the query-filter form rather than /products/{lid}: the local proxy
      // re-encodes query strings in a way PDS's SecurityValidationFilter rejects
      // (verified: direct 200, proxied 400). PDS is public, keyless and CORS-open,
      // so this provider fetches directly in the browser.
      const url = `${PDS_BASE}/products?limit=5&q=${encodeURIComponent(`(lid eq "${bundle.lid}")`)}`;
      const res = await d4FetchWithRetry(url, { direct: true });
      env.meta.endpoint = env.meta.endpoint || url;
      env.meta.latencyMs = res.latencyMs;
      env.meta.httpStatus = res.status;
      if (!res.ok) { errors.push(`${bundle.label}: ${res.error}`); continue; }
      const rows = (res.data && Array.isArray(res.data.data)) ? res.data.data : [];
      const first = rows[0] || {};
      const props = first.properties || first;
      if (!pdsProp(props, 'lid') && !pdsProp(props, 'lidvid')) {
        errors.push(`${bundle.label}: no matching PDS record`);
        continue;
      }
      const title = pdsProp(props, 'pds:Identification_Area.pds:title') || bundle.label;
      const harvest = pdsProp(props, 'ops:Harvest_Info.ops:harvest_date_time');
      results.push({
        bundleLid: pdsProp(props, 'lid') || bundle.lid,
        title,
        harvestTime: harvest,
        processingLevel: /simulations/i.test(bundle.lid) ? 'SIMULATION' : 'DERIVED'
      });
    }

    if (results.length === 0) {
      return unavailableEnvelope(env, `No SHARAD bundle metadata retrievable. ${errors.join(' | ')}`, env.meta.endpoint);
    }

    env.status = D4_STATUS.OK;
    env.meta.license = 'NASA PDS — public domain, citation required';
    if (errors.length) env.meta.error = `Partial: ${errors.join(' | ')}`;
    for (const r of results) {
      env.measurements.push(measurement(
        'sharad_bundle', r.title, r.bundleLid, 'urn',
        {
          source: 'NASA PDS Search API',
          instrument: 'MRO SHARAD (Shallow Radar)',
          timestamp: r.harvestTime,
          spatialResolution: '~3-5 m vertical / 0.3-1 km along-track (instrument spec)',
          epistemicClass: EPISTEMIC.MEASURED,
          note: `Processing level: ${r.processingLevel}. Registry metadata only - radargram sample values are not exposed by the REST API.`
        }
      ));
    }
    writeCache(cacheKey, env);
    return env;
  }

  // ---------------------------------------------------------------------------
  // Provider 2 — NASA POWER hydrology (verified HTTP 200 with real GWETTOP values)
  // Groundwater / soil-wetness context for Earth D4.
  // ---------------------------------------------------------------------------
  async function providerPowerHydro(lat, lon) {
    const env = envelope('power_hydro', 'NASA POWER MERRA-2 - Soil Wetness & Precipitation Climatology', 'Earth');
    const cacheKey = `power_hydro_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, meta: { ...cached.meta, fromCache: true } };

    const url = 'https://power.larc.nasa.gov/api/temporal/climatology/point'
      + `?parameters=GWETTOP,GWETROOT,PRECTOTCORR&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;
    env.meta.endpoint = url;
    const res = await d4FetchWithRetry(url);
    env.meta.latencyMs = res.latencyMs;
    env.meta.httpStatus = res.status;
    if (!res.ok) {
      return unavailableEnvelope(env, `NASA POWER request failed: ${res.error}`, url);
    }
    const params = res.data && res.data.properties && res.data.properties.parameter;
    if (!params || !params.GWETTOP) {
      return unavailableEnvelope(env, 'NASA POWER returned no GWETTOP parameter block.', url);
    }

    const ann = p => (p && p.ANN !== undefined && p.ANN !== null && p.ANN > -900) ? Number(p.ANN) : null;
    const gwTop = ann(params.GWETTOP);
    const gwRoot = ann(params.GWETROOT);
    const precip = ann(params.PRECTOTCORR);

    if (gwTop === null && gwRoot === null && precip === null) {
      return unavailableEnvelope(env, 'NASA POWER climatology contained only fill values (-999).', url);
    }

    env.status = D4_STATUS.OK;
    env.meta.license = 'NASA POWER - open, no key required';
    const common = {
      source: 'NASA POWER MERRA-2 Climatology',
      instrument: 'MERRA-2 land-surface reanalysis',
      timestamp: '1991-2020 climatology (ANN)',
      spatialResolution: '0.5 deg x 0.625 deg (~50 km)',
      epistemicClass: EPISTEMIC.MEASURED
    };
    if (gwTop !== null) {
      env.measurements.push(measurement('soil_wetness_surface', 'Surface Soil Wetness', gwTop, 'fraction 0-1', { ...common }));
    }
    if (gwRoot !== null) {
      env.measurements.push(measurement('soil_wetness_root', 'Root-Zone Soil Wetness', gwRoot, 'fraction 0-1', { ...common }));
    }
    if (precip !== null) {
      env.measurements.push(measurement('precip_annual', 'Annual Precipitation', Number((precip * 365).toFixed(1)), 'mm/yr', { ...common }));
    }
    writeCache(cacheKey, env);
    return env;
  }

  // ---------------------------------------------------------------------------
  // Provider 3 — Macrostrat subsurface geology (verified HTTP 200, CC-BY 4.0)
  // Crustal lithology column — direct D4 subsurface evidence for Earth.
  // ---------------------------------------------------------------------------
  async function providerMacrostrat(lat, lon) {
    const env = envelope('macrostrat_subsurface', 'Macrostrat v2 - Subsurface Crustal Lithology', 'Earth');
    const cacheKey = `macrostrat_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, meta: { ...cached.meta, fromCache: true } };

    const url = `https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lon}&response=long`;
    env.meta.endpoint = url;
    const res = await d4FetchWithRetry(url);
    env.meta.latencyMs = res.latencyMs;
    env.meta.httpStatus = res.status;
    if (!res.ok) {
      return unavailableEnvelope(env, `Macrostrat request failed: ${res.error}`, url);
    }
    const units = res.data && res.data.success && res.data.success.data;
    if (!Array.isArray(units) || units.length === 0) {
      return unavailableEnvelope(env, 'Macrostrat returned no geologic units for this point.', url);
    }

    env.status = D4_STATUS.OK;
    env.meta.license = 'CC-BY 4.0 (Macrostrat)';
    units.slice(0, 3).forEach((u, i) => {
      env.measurements.push(measurement(
        `subsurface_unit_${i + 1}`,
        `Subsurface Unit ${i + 1} (stratigraphic position ${i + 1})`,
        `${u.name || u.lith || 'Unnamed unit'} - ${u.lith || 'lithology unspecified'}`,
        'text',
        {
          source: 'Macrostrat v2 geologic map service',
          instrument: 'Compiled geologic maps',
          timestamp: (u.b_age || u.t_age) ? `${u.b_age || '?'}-${u.t_age || '?'} Ma` : null,
          spatialResolution: '1:24,000 to 1:1,000,000 source map scale',
          epistemicClass: EPISTEMIC.MEASURED,
          note: u.descrip ? String(u.descrip).slice(0, 180) : null
        }
      ));
    });
    writeCache(cacheKey, env);
    return env;
  }

  // ---------------------------------------------------------------------------
  // Provider 4 — NSIDC glacier & permafrost reference layers (static assets)
  // RGI 7.0 (NSIDC-0770) and GGD318 are file downloads, not point APIs.
  // Metadata reported honestly; no polygon math is claimed without the asset.
  // ---------------------------------------------------------------------------
  async function providerNsidcStatic() {
    const env = envelope('nsidc_static', 'NSIDC - Glacier Inventory & Permafrost Reference Layers', 'Earth');
    const cacheKey = 'nsidc_static';
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, meta: { ...cached.meta, fromCache: true } };

    env.status = D4_STATUS.OK;
    env.meta.license = 'NSIDC - citation required (DOIs in notes)';
    env.measurements.push(measurement(
      'rgi_v7_reference', 'Randolph Glacier Inventory v7 (NSIDC-0770)', 'available as static asset', 'flag',
      {
        source: 'NSIDC DAAC',
        instrument: 'Landsat/SPOT-derived glacier outlines',
        timestamp: '1950-2021 outlines (static)',
        spatialResolution: 'varies (Landsat/SPOT source)',
        epistemicClass: EPISTEMIC.DERIVED,
        note: 'DOI 10.5067/F6JMOVY5NAVZ. Point-in-polygon glacier proximity requires a one-time local GeoJSON conversion; no point API exists.'
      }
    ));
    env.measurements.push(measurement(
      'ggd318_reference', 'Circum-Arctic Permafrost & Ground-Ice Map v2 (GGD318)', 'available as static asset', 'flag',
      {
        source: 'NSIDC DAAC',
        instrument: 'Compiled permafrost/ground-ice map',
        timestamp: 'static map (Northern Hemisphere 28-90 deg N)',
        spatialResolution: '~1:10M source scale',
        epistemicClass: EPISTEMIC.DERIVED,
        note: 'DOI 10.7265/skbg-kf16. FTP-only distribution (sidads.colorado.edu); requires one-time conversion before point queries.'
      }
    ));
    writeCache(cacheKey, env);
    return env;
  }


  // ---------------------------------------------------------------------------
  // Provider 5 — Diviner / Mini-RF / THEMIS (documented UNAVAILABLE)
  // Two verification attempts each failed (PDS instrument LID 0 hits; trek 404).
  // Reported honestly rather than fabricated.
  // ---------------------------------------------------------------------------
  async function providerDivinerMiniRfThemis(body) {
    const env = envelope('diviner_minirf_themis', 'LRO Diviner / LRO Mini-RF / Odyssey THEMIS - Subsurface & Thermal', body);
    const cacheKey = 'diviner_minirf_themis_status';
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, meta: { ...cached.meta, fromCache: true } };

    env.status = D4_STATUS.UNAVAILABLE;
    env.meta.license = 'NASA PDS (public domain, citation required)';
    env.meta.error = 'No verified point-access path. PDS instrument LID queries returned 0 hits and the trek WMTS layer returned HTTP 404 after two attempts each. Data remain accessible only via bulk PDS archives and ODE/JMARS web tools.';
    env.measurements.push(measurement(
      'diviner_status', 'LRO Diviner bolometric temperature grids', null, 'flag',
      { epistemicClass: EPISTEMIC.UNAVAILABLE, note: 'Bulk PDS4 bundles LRODLR_0001/0002 (EDR), LRODLR_1001/1002 (RDR) + derived GDR/PCP; no REST point API verified.' }
    ));
    env.measurements.push(measurement(
      'minirf_status', 'LRO Mini-RF CPR radar', null, 'flag',
      { epistemicClass: EPISTEMIC.UNAVAILABLE, note: 'PDS Geosciences documentation page returned HTTP 404 on both attempts; no verified access path.' }
    ));
    env.measurements.push(measurement(
      'themis_status', 'Odyssey THEMIS IR / thermal inertia', null, 'flag',
      { epistemicClass: EPISTEMIC.UNAVAILABLE, note: 'THEMIS Data Node (ASU Mars Image Explorer / JMARS) is web-tool only; no REST point API verified.' }
    ));
    writeCache(cacheKey, env);
    return env;
  }

  // ---------------------------------------------------------------------------
  // Unified entry point - never throws, never blocks the app
  // ---------------------------------------------------------------------------
  async function fetchD4Context(lat, lon, body) {
    const jobs = [];
    if (body === 'Mars') {
      jobs.push(['pds_sharad', () => providerPdsSharad()]);
      jobs.push(['diviner_minirf_themis', () => providerDivinerMiniRfThemis(body)]);
    } else if (body === 'Moon') {
      jobs.push(['diviner_minirf_themis', () => providerDivinerMiniRfThemis(body)]);
    } else {
      jobs.push(['power_hydro', () => providerPowerHydro(lat, lon)]);
      jobs.push(['macrostrat_subsurface', () => providerMacrostrat(lat, lon)]);
      jobs.push(['nsidc_static', () => providerNsidcStatic()]);
    }

    const settled = await Promise.allSettled(jobs.map(([, fn]) => fn()));
    const providers = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const env = envelope(jobs[i][0], jobs[i][0], body);
      return unavailableEnvelope(env, `Provider threw: ${r.reason && r.reason.message ? r.reason.message : 'unknown error'}`);
    });

    return { queriedAt: new Date().toISOString(), body, lat, lon, providers };
  }

  // Flatten a fetchD4Context result into the D4 metric vocabulary the scoring
  // engine already consumes (lavaTubeScore / iceCaveScore / shieldingDepth stay
  // operator-supplied; these add *evidence* without overwriting curated values).
  function summariseD4Evidence(context) {
    const evidence = [];
    let okCount = 0;
    let unavailableCount = 0;
    for (const provider of (context && context.providers) || []) {
      const present = provider.measurements.filter(m => m.status === 'PRESENT');
      if (provider.status === 'OK' && present.length) okCount++;
      if (provider.status === 'UNAVAILABLE' || provider.status === 'ERROR' || provider.status === 'TIMEOUT') unavailableCount++;
      evidence.push({
        providerId: provider.providerId,
        label: provider.label,
        status: provider.status,
        endpoint: provider.meta.endpoint,
        license: provider.meta.license,
        retrievedAt: provider.meta.retrievedAt,
        fromCache: provider.meta.fromCache,
        error: provider.meta.error,
        presentCount: present.length,
        measurements: provider.measurements
      });
    }
    return {
      queriedAt: context ? context.queriedAt : null,
      body: context ? context.body : null,
      providersOk: okCount,
      providersUnavailable: unavailableCount,
      providersTotal: evidence.length,
      evidence
    };
  }

  const D4_PROVIDERS = Object.freeze({
    D4_STATUS,
    EPISTEMIC,
    fetchD4Context,
    summariseD4Evidence,
    providerPdsSharad,
    providerPowerHydro,
    providerMacrostrat,
    providerNsidcStatic,
    providerDivinerMiniRfThemis
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = D4_PROVIDERS;
  }
  root.AstroLocD4Providers = D4_PROVIDERS;
})(typeof window !== 'undefined' ? window : globalThis);


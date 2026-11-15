const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env (primary) or .env.example (fallback template) automatically if present
['.env', '.env.example'].forEach(file => {
  const envPath = path.join(__dirname, file);
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...val] = trimmed.split('=');
      const cleanVal = val.join('=').trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key.trim()] && cleanVal && !cleanVal.startsWith('YOUR_')) {
        process.env[key.trim()] = cleanVal;
      }
    });
  }
});

const PORT = Number(process.env.PORT) || 8080;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'AstroLoc-Planetary-Analog-Explorer/8.2 (scientific-research)';
const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY || '';
const OPENTOPOGRAPHY_API_KEY = process.env.OPENTOPOGRAPHY_API_KEY || '';
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 8500;
const RATE_LIMIT_MAX_RPM = Number(process.env.RATE_LIMIT_MAX_RPM) || 60;

// Strict CORS allowlist (defaults to localhost origins)
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT},null`)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// Explicit allowlist of approved scientific API hostnames (SSRF prevention)
const ALLOWED_SCIENTIFIC_HOSTS = new Set([
  'api.nasa.gov',
  'power.larc.nasa.gov',
  'eonet.gsfc.nasa.gov',
  'api.open-meteo.com',
  'archive-api.open-meteo.com',
  'climate-api.open-meteo.com',
  'epqs.nationalmap.gov',
  'nominatim.openstreetmap.org',
  'macrostrat.org',
  'portal.opentopography.org',
  'api.opentopodata.org',
  'pds.mcp.nasa.gov',
  'pds-geosciences.wustl.edu'
]);

// Per-IP sliding-window rate limiter
const rateLimitBuckets = new Map();
function checkRateLimit(clientIp) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const bucket = rateLimitBuckets.get(clientIp) || [];
  const recent = bucket.filter(ts => now - ts < windowMs);
  if (recent.length >= RATE_LIMIT_MAX_RPM) {
    rateLimitBuckets.set(clientIp, recent);
    return false;
  }
  recent.push(now);
  rateLimitBuckets.set(clientIp, recent);
  return true;
}

function validateLatLonParams(latRaw, lonRaw) {
  if (latRaw !== null && latRaw !== undefined && latRaw !== '') {
    const lat = Number(latRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { valid: false, error: 'Invalid latitude parameter: must be a finite number between -90 and 90.' };
    }
  }
  if (lonRaw !== null && lonRaw !== undefined && lonRaw !== '') {
    const lon = Number(lonRaw);
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return { valid: false, error: 'Invalid longitude parameter: must be a finite number between -180 and 180.' };
    }
  }
  return { valid: true, error: null };
}

function isAllowedUpstreamUrl(parsedUrl) {
  if (!parsedUrl || parsedUrl.protocol !== 'https:') return false;
  const host = (parsedUrl.hostname || '').toLowerCase();
  if (!ALLOWED_SCIENTIFIC_HOSTS.has(host)) return false;
  // Block any embedded credentials or non-standard ports
  if (parsedUrl.username || parsedUrl.password || (parsedUrl.port && parsedUrl.port !== '443')) {
    return false;
  }
  return true;
}

async function fetchWithTimeout(urlStr, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': NOMINATIM_USER_AGENT,
      ...(options.headers || {})
    };
    const response = await fetch(urlStr, { ...options, headers, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', `http://localhost:${PORT}`);
  } else if (ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGINS.has('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

const server = http.createServer(async (req, res) => {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Enforce GET-only across all proxy and static endpoints
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Allow': 'GET, OPTIONS' });
    return res.end(JSON.stringify({ error: 'Method Not Allowed. Only GET requests are supported.' }));
  }

  const clientIp = req.socket?.remoteAddress || '127.0.0.1';
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
    return res.end(JSON.stringify({ error: 'Rate limit exceeded. Please wait before issuing additional requests.' }));
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Route 0: Health & Configuration Status Check
  if (reqUrl.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      status: 'ok',
      service: 'AstroLoc Planetary Analog Discovery Proxy Server',
      methodologyVersion: 'AstroLoc-5D-v8.2',
      port: PORT,
      nasaKeyConfigured: Boolean(process.env.NASA_API_KEY && process.env.NASA_API_KEY !== 'DEMO_KEY'),
      nominatimUserAgent: NOMINATIM_USER_AGENT,
      openMeteoKeyConfigured: Boolean(OPEN_METEO_API_KEY),
      openTopographyKeyConfigured: Boolean(OPENTOPOGRAPHY_API_KEY),
      allowedHosts: Array.from(ALLOWED_SCIENTIFIC_HOSTS),
      rateLimitMaxRpm: RATE_LIMIT_MAX_RPM
    }));
  }

  // Route 1: Serve the main AstroLoc HTML application
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html' || reqUrl.pathname === '/astroloc_planetary_analog_discovery_platform_v8.html') {
    const htmlPath = path.join(__dirname, 'astroloc_planetary_analog_discovery_platform_v8.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(htmlPath).pipe(res);
    }
  }

  
  // Route 1B: Serve astroloc-planetary-data.js and architecture-diagram.svg
  if (reqUrl.pathname === '/astroloc-planetary-data.js') {
    const jsPath = path.join(__dirname, 'astroloc-planetary-data.js');
    if (fs.existsSync(jsPath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return fs.createReadStream(jsPath).pipe(res);
    }
  }
  if (reqUrl.pathname === '/architecture-diagram.svg') {
    const svgPath = path.join(__dirname, 'architecture-diagram.svg');
    if (fs.existsSync(svgPath)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      return fs.createReadStream(svgPath).pipe(res);
    }
  }

  // Route 1C: Real 3x3 DEM Terrain Grid Endpoint (/api/terrain-grid?lat=...&lon=...&step=0.0025)
  if (reqUrl.pathname === '/api/terrain-grid') {
    const latRaw = reqUrl.searchParams.get('lat');
    const lonRaw = reqUrl.searchParams.get('lon');
    const stepRaw = reqUrl.searchParams.get('step') || '0.0025';
    const check = validateLatLonParams(latRaw, lonRaw);
    if (!check.valid || latRaw === null || lonRaw === null) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: check.error || 'Missing lat/lon parameters' }));
    }
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    const d = Math.max(0.0005, Math.min(0.02, Number(stepRaw) || 0.0025));

    // Build 3x3 grid coordinates (NW, N, NE, W, C, E, SW, S, SE)
    const offsets = [
      [d, -d], [d, 0], [d, d],
      [0, -d], [0, 0], [0, d],
      [-d, -d], [-d, 0], [-d, d]
    ];
    const lats = offsets.map(([dLat]) => Math.max(-89.99, Math.min(89.99, lat + dLat)).toFixed(5));
    const lons = offsets.map(([, dLon]) => {
      let wrapped = ((((lon + dLon) + 180) % 360) + 360) % 360 - 180;
      return wrapped.toFixed(5);
    });

    try {
      // Primary: Copernicus DEM GLO-30 (30m) via Open-Meteo Elevation API
      const omUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
      const omResp = await fetchWithTimeout(omUrl);
      if (omResp.ok) {
        const omData = await omResp.json();
        if (Array.isArray(omData.elevation) && omData.elevation.length === 9) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            provider: 'Copernicus DEM GLO-30 (Open-Meteo 30m)',
            resolutionMeters: 30,
            stepDeg: d,
            center: { lat, lon },
            grid3x3: [
              omData.elevation.slice(0, 3),
              omData.elevation.slice(3, 6),
              omData.elevation.slice(6, 9)
            ],
            elevations: omData.elevation
          }));
        }
      }
      // Fallback: OpenTopoData SRTMGL1 / ASTER30m
      const locs = lats.map((lt, idx) => `${lt},${lons[idx]}`).join('|');
      const otdUrl = `https://api.opentopodata.org/v1/aster30m?locations=${encodeURIComponent(locs)}`;
      const otdResp = await fetchWithTimeout(otdUrl);
      if (otdResp.ok) {
        const otdData = await otdResp.json();
        const elevs = (otdData.results || []).map(r => r.elevation);
        if (elevs.length === 9) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            provider: 'NASA/METI ASTER GDEM 30m (OpenTopoData)',
            resolutionMeters: 30,
            stepDeg: d,
            center: { lat, lon },
            grid3x3: [
              elevs.slice(0, 3),
              elevs.slice(3, 6),
              elevs.slice(6, 9)
            ],
            elevations: elevs
          }));
        }
      }
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Upstream DEM providers unavailable' }));
    } catch (err) {
      res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'DEM Grid fetch timed out' }));
    }
  }

  // Route 2: Proxy NASA Open API requests (e.g., /api/nasa/planetary/apod)
  if (reqUrl.pathname.startsWith('/api/nasa')) {
    try {
      const nasaEndpoint = reqUrl.pathname.replace('/api/nasa', '') || '/planetary/apod';
      if (nasaEndpoint.includes('..') || !nasaEndpoint.startsWith('/')) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Invalid NASA endpoint path.' }));
      }

      const coordValidation = validateLatLonParams(
        reqUrl.searchParams.get('lat') ?? reqUrl.searchParams.get('latitude'),
        reqUrl.searchParams.get('lon') ?? reqUrl.searchParams.get('longitude')
      );
      if (!coordValidation.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: coordValidation.error }));
      }

      // Guard against deprecated /planetary/earth/assets endpoint by routing to live NASA EONET v3
      if (/^\/planetary\/earth\/(assets|imagery)/i.test(nasaEndpoint)) {
        const lat = Number(reqUrl.searchParams.get('lat')) || 0;
        const lon = Number(reqUrl.searchParams.get('lon')) || 0;
        const bbox = `${(lon - 2.5).toFixed(2)},${(lat + 2.5).toFixed(2)},${(lon + 2.5).toFixed(2)},${(lat - 2.5).toFixed(2)}`;
        const eonetUrl = `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&limit=5&bbox=${encodeURIComponent(bbox)}`;
        const response = await fetchWithTimeout(eonetUrl);
        const data = await response.text();
        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(data);
      }

      const targetUrl = new URL(`https://api.nasa.gov${nasaEndpoint}`);
      if (!isAllowedUpstreamUrl(targetUrl)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Upstream host is not in the approved scientific API allowlist.' }));
      }

      reqUrl.searchParams.forEach((value, key) => targetUrl.searchParams.set(key, value));
      if (!targetUrl.searchParams.has('api_key')) {
        targetUrl.searchParams.set('api_key', NASA_API_KEY);
      }

      const response = await fetchWithTimeout(targetUrl.toString());
      const data = await response.text();

      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8'
      });
      return res.end(data);
    } catch (err) {
      const status = err.name === 'AbortError' ? 504 : 502;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: err.name === 'AbortError' ? 'Upstream NASA API request timed out' : 'Upstream NASA API request failed safely' }));
    }
  }

  // Route 3: Allowlisted Scientific API proxy (e.g., /proxy?url=https://...)
  if (reqUrl.pathname === '/proxy') {
    const target = reqUrl.searchParams.get('url');
    if (!target || target.length > 2048) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Missing or invalid url parameter' }));
    }
    try {
      const parsedTarget = new URL(target);
      if (!isAllowedUpstreamUrl(parsedTarget)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          error: `Blocked by SSRF policy: host '${parsedTarget.hostname}' is not in ALLOWED_SCIENTIFIC_HOSTS.`
        }));
      }

      const coordCheck = validateLatLonParams(
        parsedTarget.searchParams.get('lat') ?? parsedTarget.searchParams.get('latitude') ?? parsedTarget.searchParams.get('y'),
        parsedTarget.searchParams.get('lon') ?? parsedTarget.searchParams.get('lng') ?? parsedTarget.searchParams.get('longitude') ?? parsedTarget.searchParams.get('x')
      );
      if (!coordCheck.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: coordCheck.error }));
      }

      if (parsedTarget.hostname.endsWith('nasa.gov') && !parsedTarget.searchParams.has('api_key')) {
        parsedTarget.searchParams.set('api_key', NASA_API_KEY);
      }
      if (parsedTarget.hostname.endsWith('open-meteo.com') && OPEN_METEO_API_KEY && !parsedTarget.searchParams.has('apikey')) {
        parsedTarget.searchParams.set('apikey', OPEN_METEO_API_KEY);
      }
      if (parsedTarget.hostname.endsWith('opentopography.org') && OPENTOPOGRAPHY_API_KEY && !parsedTarget.searchParams.has('API_Key')) {
        parsedTarget.searchParams.set('API_Key', OPENTOPOGRAPHY_API_KEY);
      }

      const response = await fetchWithTimeout(parsedTarget.toString());
      const data = await response.text();
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8'
      });
      return res.end(data);
    } catch (err) {
      const status = err.name === 'AbortError' ? 504 : 502;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: err.name === 'AbortError' ? 'Upstream scientific API request timed out' : 'Upstream scientific API request failed safely' }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Route not found' }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`AstroLoc Proxy Server running at http://localhost:${PORT}`);
    console.log(`NASA API Key status: ${process.env.NASA_API_KEY ? 'Loaded from .env' : 'Using DEMO_KEY fallback'}`);
  });
}

module.exports = {
  server,
  ALLOWED_SCIENTIFIC_HOSTS,
  isAllowedUpstreamUrl,
  validateLatLonParams,
  checkRateLimit
};

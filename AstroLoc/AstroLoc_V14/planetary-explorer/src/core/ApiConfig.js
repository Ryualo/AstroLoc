// Shared backend URL configuration for the Planetary Explorer frontend.
// Live Server serves the UI on port 5500; the Python API/proxy runs on port 8082.
// Derive the hostname so both localhost and 127.0.0.1 development URLs work.
const backendHost = (typeof window !== 'undefined' && window.location.hostname)
    ? window.location.hostname
    : '127.0.0.1';

export const API_BASE_URL = `http://${backendHost}:8082`;
export const API_PROXY_BASE = `${API_BASE_URL}/api/proxy`;

export function buildProxyUrl(targetUrl) {
    return `${API_PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
}

// planetary-explorer-v2/app.js
// Main orchestrator for the Earth, Moon, and Mars Global Exploration Interface.

import {
    PLANETARY_CRS,
    normalizeLon180,
    normalizeLon360,
    formatPlanetCoordinate,
    parsePlanetCoordinate,
    parsePlanetCoordinatePair,
    sanitizeBbox,
    bboxIntersects,
    latLonToVector3,
    vector3ToLatLon,
    computeRegionSpanKm,
} from './src/core/CoordinateEngine.js';
import { CacheManager } from './src/core/CacheManager.js';
import {
    onApiCallCountChange,
    searchPDS,
    searchPDSByLidvid,
    getPDSProductCount,
    getPropertyValue,
    classifyProduct,
    getExplicitProductType,
    geocodeEarthLocation,
} from './src/core/DataManager.js';
import { PROVIDERS } from './src/providers/MarsProvider.js';
import { TextureManager } from './src/terrain/TextureManager.js';
import {
    fetchPlanetaryGlobalDem,
    fetchEarthSrtmDem,
    parseESRIASCII,
    parseCSVElevation,
} from './src/terrain/DEMProcessor.js';
import {
    cropGeographicGrid,
    downsampleGeographicGrid,
    cropSurfaceImageToCanvas,
} from './src/terrain/TerrainCropper.js';
import { TerrainRenderer } from './src/terrain/TerrainRenderer.js';
import { ComparisonEngine } from './src/comparison/ComparisonEngine.js';

const STATE = {
    body: 'Moon',
    mode: 'globe', // 'globe' | 'map' | 'split'
    lat: 0.6741,
    lon: 23.4730,
    bbox: sanitizeBbox(15, -15, 5, 40),
    regionSelecting: false,
    syncingMap: false,
    selectedLandmark: null,
    searchResults: null,
    terrainRenderer: null,
    textureManager: null,
    currentDem: null,
    selectedEarthAnalogue: null,
    comparisonRenderers: { primary: null, earth: null },
    comparison: new ComparisonEngine(),
};

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function showToast(message, type = 'info', duration = 3800) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 280);
    }, duration);
}

function showLoading(text = 'Loading…') {
    const el = document.getElementById('loadingOverlay');
    if (!el) return;
    el.querySelector('.loading-text').textContent = text;
    el.style.display = 'flex';
}

function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.style.display = 'none';
}

function setCoordStatus(msg, state = 'info') {
    const el = document.getElementById('coordStatusBanner');
    if (!el) return;
    el.textContent = msg || '';
    el.dataset.state = state;
    el.style.display = msg ? 'block' : 'none';
}

// ==================== GLOBAL EXPLORATION INTERFACE (3D GLOBE + 2D MAP) ====================

function initPlanetaryExplorer() {
    const globeContainer = document.getElementById('planetGlobeViewport');
    const flatMapContainer = document.getElementById('planetFlatMapViewport');
    const stageWrapper = document.getElementById('planetStageWrapper');
    if (!globeContainer || !window.THREE) return;

    // Restore workspace state if available
    const saved = CacheManager.loadWorkspaceState();
    const hasRestoredBbox = Boolean(saved.bbox);
    if (saved.body && PROVIDERS[saved.body]) STATE.body = saved.body;
    if (Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
        STATE.lat = saved.lat;
        STATE.lon = saved.lon;
    }
    if (saved.bbox) STATE.bbox = sanitizeBbox(saved.bbox.north, saved.bbox.south, saved.bbox.west, saved.bbox.east);
    if (saved.landmarkName && PROVIDERS[STATE.body]) {
        STATE.selectedLandmark = PROVIDERS[STATE.body].landmarks.find(
            lm => lm.name === saved.landmarkName && Math.abs(lm.lat - STATE.lat) < 1e-4 && Math.abs(lm.lon - STATE.lon) < 1e-4
        ) || null;
    }

    // 1. THREE.JS 3D GLOBE
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050913);

    const width = globeContainer.clientWidth || 640;
    const height = globeContainer.clientHeight || 460;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.55, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    globeContainer.appendChild(renderer.domElement);

    STATE.textureManager = new TextureManager(renderer);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.18;
    controls.maxDistance = 6.2;
    controls.rotateSpeed = 0.65;

    scene.add(new THREE.AmbientLight(0xdce6f7, 0.9));
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.95);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);

    const sphereGeo = new THREE.SphereGeometry(1, 96, 64);
    const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.03 });
    const globeMesh = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(globeMesh);

    // 30-degree planetocentric graticule
    const graticuleGroup = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.16 });
    const eqMat = new THREE.LineBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.38 });
    for (let lat = -60; lat <= 60; lat += 30) {
        const pts = [];
        for (let lon = -180; lon <= 180; lon += 4) pts.push(latLonToVector3(lat, lon, 1.002));
        graticuleGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lat === 0 ? eqMat : lineMat));
    }
    for (let lon = -180; lon < 180; lon += 30) {
        const pts = [];
        for (let lat = -90; lat <= 90; lat += 4) pts.push(latLonToVector3(lat, lon, 1.002));
        graticuleGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lon === 0 ? eqMat : lineMat));
    }
    scene.add(graticuleGroup);

    // Selected Coordinate Pin on 3D Globe
    const selectionPin = new THREE.Group();
    selectionPin.add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 16), new THREE.MeshBasicMaterial({ color: 0x00e5ff })));
    selectionPin.add(new THREE.Mesh(new THREE.RingGeometry(0.032, 0.048, 24), new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide })));
    scene.add(selectionPin);

    // 3D Region Wireframe Outline
    const globeRegionGroup = new THREE.Group();
    scene.add(globeRegionGroup);

    function updateGlobeRegionOutline(bbox) {
        while (globeRegionGroup.children.length) {
            const child = globeRegionGroup.children[0];
            globeRegionGroup.remove(child);
            child.geometry?.dispose?.();
            child.material?.dispose?.();
        }
        if (!bbox) return;
        const span = bbox.spanDegrees || (bbox.wrapsAntimeridian ? bbox.east + 360 - bbox.west : bbox.east - bbox.west);
        const pts = [];
        const steps = 28;
        for (let i = 0; i <= steps; i++) pts.push(latLonToVector3(bbox.north, normalizeLon180(bbox.west + (span * i) / steps), 1.007));
        for (let i = 0; i <= steps; i++) pts.push(latLonToVector3(bbox.north - ((bbox.north - bbox.south) * i) / steps, bbox.east, 1.007));
        for (let i = 0; i <= steps; i++) pts.push(latLonToVector3(bbox.south, normalizeLon180(bbox.west + (span * (steps - i)) / steps), 1.007));
        for (let i = 0; i <= steps; i++) pts.push(latLonToVector3(bbox.south + ((bbox.north - bbox.south) * i) / steps, bbox.west, 1.007));
        globeRegionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffca28 })));
    }

    const landmarksGroup = new THREE.Group();
    scene.add(landmarksGroup);
    let landmarkMeshes = [];

    // 2. LEAFLET 2D NORTH-UP EQUIRECTANGULAR MAP
    let leafletMap = null;
    let leafletTileLayer = null;
    let leafletImageOverlay = null;
    let leafletSelectedMarker = null;
    let leafletLandmarkLayer = null;
    let leafletBboxRect = null;
    let leafletResizeHandles = [];

    function initLeafletMap() {
        if (!flatMapContainer || !window.L || leafletMap) return;
        leafletMap = L.map(flatMapContainer, {
            crs: L.CRS.EPSG4326,
            center: [STATE.lat, STATE.lon],
            zoom: 1,
            minZoom: 0,
            maxZoom: 6,
            maxBounds: [[-90, -180], [90, 180]],
            maxBoundsViscosity: 1.0,
            worldCopyJump: false,
            attributionControl: false,
        });

        leafletLandmarkLayer = L.layerGroup().addTo(leafletMap);

        const pinIcon = L.divIcon({
            className: 'flatmap-selected-pin',
            html: '<div class="pin-pulse"></div><div class="pin-core"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
        });
        leafletSelectedMarker = L.marker([STATE.lat, STATE.lon], { icon: pinIcon, interactive: false }).addTo(leafletMap);

        leafletMap.on('moveend', () => {
            if (STATE.syncingMap || STATE.mode === 'globe') return;
            const c = leafletMap.getCenter();
            moveGlobeCamera(Math.max(-90, Math.min(90, c.lat)), normalizeLon180(c.lng), globeDistanceFromZoom(leafletMap.getZoom()));
        });

        let dragStart = null;
        let drawing = false;
        leafletMap.on('mousedown', e => {
            if (!STATE.regionSelecting && !e.originalEvent.shiftKey) return;
            drawing = true;
            dragStart = e.latlng;
            leafletMap.dragging.disable();
        });
        leafletMap.on('mousemove', e => {
            if (!drawing || !dragStart) return;
            const b = sanitizeBbox(
                Math.max(dragStart.lat, e.latlng.lat),
                Math.min(dragStart.lat, e.latlng.lat),
                Math.min(dragStart.lng, e.latlng.lng),
                Math.max(dragStart.lng, e.latlng.lng)
            );
            setRegionBbox(b, { skipHandles: true });
        });
        window.addEventListener('mouseup', () => {
            if (!drawing) return;
            drawing = false;
            dragStart = null;
            if (leafletMap) leafletMap.dragging.enable();
            if (STATE.bbox) setRegionBbox(STATE.bbox);
        });

        leafletMap.on('click', e => {
            if (STATE.regionSelecting) return;
            selectLocation(e.latlng.lat, e.latlng.lng, { focusCamera: false, sourceNote: 'Selected via 2D North-Up Map click' });
        });
    }

    function globeDistanceFromZoom(z) {
        return Math.max(controls.minDistance, Math.min(controls.maxDistance, 3.4 - z * 0.42));
    }

    function zoomFromGlobeDistance(dist) {
        return Math.max(0, Math.min(5, Math.round((3.4 - dist) / 0.42)));
    }

    function moveGlobeCamera(lat, lon, distance = camera.position.length()) {
        const d = Math.max(controls.minDistance, Math.min(controls.maxDistance, distance));
        camera.position.copy(latLonToVector3(lat, lon, d));
        controls.target.set(0, 0, 0);
        controls.update();
    }

    function clearResizeHandles() {
        leafletResizeHandles.forEach(h => leafletMap && leafletMap.removeLayer(h));
        leafletResizeHandles = [];
    }

    let cropPreviewTimer = null;
    function updateSurfaceCropPreview(bbox = STATE.bbox, { silent = true } = {}) {
        if (!bbox || !STATE.textureManager) return;
        const image = STATE.textureManager.getLoadedImage(STATE.body);
        const canvas = document.getElementById('regionCropCanvas');
        if (!image || !canvas) return;
        try {
            const spanInfo = cropSurfaceImageToCanvas(image, bbox, STATE.body, canvas);
            document.getElementById('regionCropWrap').style.display = 'block';
            document.getElementById('regionCropMeta').innerHTML = `
                <strong>${escapeHtml(STATE.body)} North-Up Surface Crop</strong><br>
                Bounds: ${bbox.south.toFixed(3)}°…${bbox.north.toFixed(3)}°N, ${bbox.west.toFixed(3)}°…${bbox.east.toFixed(3)}°E<br>
                Span: ~${spanInfo.widthKm.toLocaleString()} km × ${spanInfo.heightKm.toLocaleString()} km
            `;
        } catch (error) {
            if (!silent) showToast(error.message, 'warning');
        }
    }

    function scheduleSurfaceCropPreview(bbox = STATE.bbox) {
        if (cropPreviewTimer) clearTimeout(cropPreviewTimer);
        cropPreviewTimer = setTimeout(() => {
            cropPreviewTimer = null;
            updateSurfaceCropPreview(bbox, { silent: true });
        }, 90);
    }

    function setRegionBbox(bbox, options = {}) {
        STATE.bbox = bbox;
        CacheManager.saveWorkspaceState({ bbox });
        const hudRegion = document.getElementById('hudRegionReadout');
        if (!bbox) {
            if (leafletBboxRect && leafletMap) {
                leafletMap.removeLayer(leafletBboxRect);
                leafletBboxRect = null;
            }
            clearResizeHandles();
            updateGlobeRegionOutline(null);
            if (hudRegion) hudRegion.textContent = 'Region: None';
            return;
        }

        document.getElementById('bboxNorth').value = bbox.north;
        document.getElementById('bboxSouth').value = bbox.south;
        document.getElementById('bboxWest').value = bbox.west;
        document.getElementById('bboxEast').value = bbox.east;

        const spanInfo = computeRegionSpanKm(bbox, STATE.body);
        if (hudRegion) {
            hudRegion.textContent = `Region: ${bbox.south}°…${bbox.north}°N, ${bbox.west}°…${bbox.east}°E (~${spanInfo.widthKm.toLocaleString()}×${spanInfo.heightKm.toLocaleString()} km)`;
        }
        updateGlobeRegionOutline(bbox);

        if (leafletMap) {
            const bounds = [[bbox.south, bbox.west], [bbox.north, bbox.wrapsAntimeridian ? 180 : bbox.east]];
            if (!leafletBboxRect) {
                leafletBboxRect = L.rectangle(bounds, {
                    color: '#ffca28',
                    weight: 2,
                    fillColor: '#ffca28',
                    fillOpacity: 0.14,
                    dashArray: '5,4',
                }).addTo(leafletMap);
            } else {
                leafletBboxRect.setBounds(bounds);
            }

            if (!options.skipHandles && !bbox.wrapsAntimeridian) {
                clearResizeHandles();
                const corners = [
                    { key: 'nw', lat: bbox.north, lng: bbox.west },
                    { key: 'ne', lat: bbox.north, lng: bbox.east },
                    { key: 'sw', lat: bbox.south, lng: bbox.west },
                    { key: 'se', lat: bbox.south, lng: bbox.east },
                ];
                corners.forEach(c => {
                    const icon = L.divIcon({
                        className: 'bbox-resize-handle',
                        html: `<div title="Drag corner (${c.key.toUpperCase()})"></div>`,
                        iconSize: [12, 12],
                        iconAnchor: [6, 6],
                    });
                    const m = L.marker([c.lat, c.lng], { icon, draggable: true }).addTo(leafletMap);
                    m.on('drag', ev => {
                        const pos = ev.target.getLatLng();
                        let { north, south, west, east } = STATE.bbox;
                        if (c.key.includes('n')) north = pos.lat;
                        if (c.key.includes('s')) south = pos.lat;
                        if (c.key.includes('w')) west = pos.lng;
                        if (c.key.includes('e')) east = pos.lng;
                        setRegionBbox(sanitizeBbox(north, south, west, east), { skipHandles: true });
                    });
                    m.on('dragend', () => STATE.bbox && setRegionBbox(STATE.bbox));
                    leafletResizeHandles.push(m);
                });
            }
        }
        if (!options.skipPreview) scheduleSurfaceCropPreview(bbox);
    }

    function applyBodyBasemap(bodyKey) {
        const provider = PROVIDERS[bodyKey] || PROVIDERS.Moon;
        document.querySelectorAll('.body-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.body === bodyKey);
        });
        document.getElementById('hudBodyBadge').textContent = `${provider.id} · ${provider.crs.meanRadiusKm.toLocaleString()} km · ${provider.crs.code}`;
        document.getElementById('crsRefFrameText').textContent = provider.crs.refFrame;
        document.getElementById('crsDatumText').textContent = provider.crs.verticalDatum;

        // Render Data Sources list for active body
        const sourcesEl = document.getElementById('activeBodySourcesList');
        if (sourcesEl) {
            sourcesEl.innerHTML = provider.dataSources.map(ds => `
                <div class="source-chip">
                    <strong>${escapeHtml(ds.name)}</strong>
                    <span>${escapeHtml(ds.type)} · ${escapeHtml(ds.resolution)}</span>
                </div>
            `).join('');
        }

        sphereMat.map = null;
        sphereMat.color.setHex(provider.fallbackColor);
        sphereMat.needsUpdate = true;

        STATE.textureManager.loadBodyTexture(
            bodyKey,
            (tex, resolvedUrl) => {
                if (STATE.body !== bodyKey) return;
                if (tex) {
                    sphereMat.map = tex;
                    sphereMat.color.setHex(0xffffff);
                    sphereMat.needsUpdate = true;
                }
                if (STATE.bbox) {
                    scheduleSurfaceCropPreview(STATE.bbox);
                }
                if (leafletMap) {
                    if (leafletImageOverlay) {
                        leafletMap.removeLayer(leafletImageOverlay);
                        leafletImageOverlay = null;
                    }
                    if (leafletTileLayer) {
                        leafletMap.removeLayer(leafletTileLayer);
                        leafletTileLayer = null;
                    }
                    if (resolvedUrl) {
                        leafletImageOverlay = L.imageOverlay(resolvedUrl, [[-90, -180], [90, 180]], { opacity: 1 }).addTo(leafletMap);
                    }
                    if (provider.wmtsTemplate) {
                        leafletTileLayer = L.tileLayer(provider.wmtsTemplate, {
                            tileSize: 256,
                            minZoom: 0,
                            maxZoom: 6,
                            noWrap: true,
                            bounds: [[-90, -180], [90, 180]],
                        }).addTo(leafletMap);
                    }
                }
            },
            statusText => {
                const st = document.getElementById('hudTextureStatus');
                if (st) st.textContent = statusText;
            }
        );
    }

    function renderLandmarksList(bodyKey, filterQuery = '') {
        while (landmarksGroup.children.length) {
            const old = landmarksGroup.children[0];
            landmarksGroup.remove(old);
            old.geometry?.dispose?.();
            old.material?.dispose?.();
        }
        landmarkMeshes = [];
        if (leafletLandmarkLayer) leafletLandmarkLayer.clearLayers();

        const provider = PROVIDERS[bodyKey] || PROVIDERS.Moon;
        provider.landmarks.forEach((lm, idx) => {
            const mMesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.019, 14, 14),
                new THREE.MeshBasicMaterial({ color: 0xffca28 })
            );
            mMesh.position.copy(latLonToVector3(lm.lat, lm.lon, 1.012));
            mMesh.userData = { landmark: lm, index: idx };
            landmarksGroup.add(mMesh);
            landmarkMeshes.push(mMesh);

            if (leafletLandmarkLayer) {
                const lmIcon = L.divIcon({
                    className: 'flatmap-landmark-dot',
                    html: `<span title="${escapeHtml(lm.name)}"></span>`,
                    iconSize: [12, 12],
                    iconAnchor: [6, 6],
                });
                const m = L.marker([lm.lat, lm.lon], { icon: lmIcon }).addTo(leafletLandmarkLayer);
                m.bindTooltip(`${escapeHtml(lm.name)} (${lm.lat.toFixed(2)}°, ${lm.lon.toFixed(2)}°E)`, { direction: 'top' });
                m.on('click', ev => {
                    L.DomEvent.stopPropagation(ev);
                    selectLocation(lm.lat, lm.lon, { focusCamera: true, distance: 2.15, landmark: lm });
                });
            }
        });

        const matches = STATE.comparison.searchCatalog(filterQuery, filterQuery ? '' : bodyKey);
        const listEl = document.getElementById('landmarksListContainer');
        if (!listEl) return;

        listEl.innerHTML = matches.map((lm, i) => `
            <button type="button" class="globe-landmark-btn" data-body="${escapeHtml(lm.body)}" data-lat="${lm.lat}" data-lon="${lm.lon}" data-idx="${i}">
                <div class="landmark-row-top">
                    <span class="landmark-title">${escapeHtml(lm.name)}</span>
                    <span class="result-badge ${lm.body === 'Earth' ? 'earth-badge' : lm.body === 'Mars' ? 'der' : 'meas'}">${escapeHtml(lm.body)}</span>
                </div>
                <span class="landmark-coords">${lm.lat.toFixed(3)}°, ${lm.lon.toFixed(3)}°E · ${escapeHtml(lm.type)}</span>
                ${lm.targetPair ? `<span class="landmark-pair">⇄ ${escapeHtml(lm.targetPair)}</span>` : ''}
            </button>
        `).join('');

        listEl.querySelectorAll('.globe-landmark-btn').forEach((btn, i) => {
            btn.addEventListener('click', () => {
                const item = matches[i];
                if (!item) return;
                if (item.body !== STATE.body) {
                    switchBody(item.body, false);
                }
                selectLocation(item.lat, item.lon, { focusCamera: true, distance: 2.15, landmark: item });
            });
        });
    }

    function selectLocation(lat, lon, options = {}) {
        const fmt = formatPlanetCoordinate(lat, lon);
        STATE.lat = fmt.lat;
        STATE.lon = fmt.lon180;
        const providerForBody = PROVIDERS[STATE.body] || PROVIDERS.Moon;
        const matchedLandmark = options.landmark || providerForBody.landmarks.find(
            item => Math.abs(item.lat - fmt.lat) < 1e-4 && Math.abs(normalizeLon180(item.lon) - fmt.lon180) < 1e-4
        ) || null;
        STATE.selectedLandmark = matchedLandmark;
        if (!options.preserveBbox) {
            const landmarkBbox = matchedLandmark?.bbox
                ? sanitizeBbox(matchedLandmark.bbox.north, matchedLandmark.bbox.south, matchedLandmark.bbox.west, matchedLandmark.bbox.east)
                : null;
            const halfSpan = STATE.body === 'Earth' ? 0.5 : 5;
            const bbox = landmarkBbox || sanitizeBbox(
                Math.min(90, fmt.lat + halfSpan),
                Math.max(-90, fmt.lat - halfSpan),
                fmt.lon180 - halfSpan,
                fmt.lon180 + halfSpan
            );
            setRegionBbox(bbox);
        } else if (STATE.bbox) {
            scheduleSurfaceCropPreview(STATE.bbox);
        }
        CacheManager.saveWorkspaceState({
            body: STATE.body,
            lat: STATE.lat,
            lon: STATE.lon,
            bbox: STATE.bbox,
            landmarkName: STATE.selectedLandmark?.name || null,
        });

        // Update input controls
        document.getElementById('coordLatInput').value = fmt.lat.toFixed(4);
        document.getElementById('coordLonInput').value = fmt.lon180.toFixed(4);
        document.getElementById('coordCombinedInput').value = `${fmt.ns}, ${fmt.ew}`;

        // Update 3D Globe Pin
        const surfacePos = latLonToVector3(fmt.lat, fmt.lon180, 1.006);
        selectionPin.position.copy(surfacePos);
        selectionPin.lookAt(surfacePos.clone().multiplyScalar(2));

        // Update 2D Map Pin
        if (leafletSelectedMarker) {
            leafletSelectedMarker.setLatLng([fmt.lat, fmt.lon180]);
        }
        if (leafletMap && options.focusCamera) {
            STATE.syncingMap = true;
            leafletMap.setView([fmt.lat, fmt.lon180], Math.max(leafletMap.getZoom(), 2), { animate: true });
            setTimeout(() => { STATE.syncingMap = false; }, 260);
        }
        if (options.focusCamera) {
            moveGlobeCamera(fmt.lat, fmt.lon180, options.distance || camera.position.length());
        }

        // Update HUD & Readout Panel
        document.getElementById('hudCoordReadout').textContent = `Selected: ${fmt.summary}`;
        const provider = PROVIDERS[STATE.body] || PROVIDERS.Moon;
        const lm = options.landmark;
        const detailEl = document.getElementById('locationInspectorCard');
        if (detailEl) {
            detailEl.innerHTML = `
                <div class="inspector-head">
                    <div>
                        <h4>${escapeHtml(lm ? lm.name : `${provider.id} Surface Coordinate`)}</h4>
                        <span class="inspector-sub">${escapeHtml(lm ? `${lm.type} · ${lm.mission}` : (options.sourceNote || 'Interactive Coordinate Selection'))}</span>
                    </div>
                    <span class="result-badge meas">${escapeHtml(provider.id)}</span>
                </div>
                <div class="coord-readout-grid">
                    <div><small>Signed Decimal</small><code>${fmt.lat.toFixed(5)}°, ${fmt.lon180.toFixed(5)}°</code></div>
                    <div><small>Hemisphere / East-360°</small><code>${escapeHtml(fmt.ns)}, ${escapeHtml(fmt.ew)} (${fmt.lon360.toFixed(4)}°E)</code></div>
                    <div><small>DMS Notation</small><code>${escapeHtml(fmt.dmsLat)} · ${escapeHtml(fmt.dmsLon)}</code></div>
                    <div><small>Reference Frame</small><code>${escapeHtml(provider.crs.code)} (${escapeHtml(provider.crs.verticalDatum)})</code></div>
                </div>
                ${lm?.desc ? `<p class="inspector-desc">${escapeHtml(lm.desc)}</p>` : ''}
                ${lm?.targetPair ? `<div class="inspector-pair"><strong>${lm.pairingStatus === 'table_pairing' ? 'Candidate Table Pairing (Unverified):' : 'Documented Analogue / Target Pairing:'}</strong> ${escapeHtml(lm.targetPair)}</div>` : ''}
                ${lm?.moonPairing || lm?.marsPairing ? `
                    <div class="inspector-pair" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                        ${lm.moonPairing ? `<button type="button" class="btn btn-small" id="btnJumpPairedMoon">☽ Go to Moon Target: ${escapeHtml(lm.moonPairing.name)} (${escapeHtml(lm.moonPairing.coordText)}, Δ° ${escapeHtml(lm.moonPairing.deltaDeg)})</button>` : ''}
                        ${lm.marsPairing ? `<button type="button" class="btn btn-small" id="btnJumpPairedMars">♂ Go to Mars Target: ${escapeHtml(lm.marsPairing.name)} (${escapeHtml(lm.marsPairing.coordText)}, Δ° ${escapeHtml(lm.marsPairing.deltaDeg)})</button>` : ''}
                    </div>
                ` : ''}
                <div class="inspector-source"><strong>Provenance:</strong> ${escapeHtml(lm?.source || provider.dataSources[0].name)}</div>
                ${STATE.body !== 'Earth' && lm ? `<div class="analogue-recommender"><strong>Suggested Earth analogues</strong><div id="locationAnalogueChoices"></div><div class="analogue-manual-picker"><label for="manualEarthAnalogueSelect">Choose another Earth analogue</label><select id="manualEarthAnalogueSelect">${PROVIDERS.Earth.landmarks.map((place, index) => `<option value="${index}">${escapeHtml(place.name)}</option>`).join('')}</select><button type="button" class="btn btn-small btn-primary" id="btnManualCompare">Compare selected</button></div></div>` : ''}
            `;
            const conflicts = STATE.comparison.getSourceConflicts(lm?.name || '');
            if (conflicts.length > 0) {
                const conflictDiv = document.createElement('div');
                conflictDiv.className = 'coord-status-banner';
                conflictDiv.style.marginTop = '8px';
                conflictDiv.innerHTML = `<strong>Preserved Source Coordinate Notice:</strong> ${escapeHtml(conflicts.map(c => c.note).join(' '))}`;
                detailEl.appendChild(conflictDiv);
            }
            if (STATE.body === 'Earth' && lm) {
                const refRows = STATE.comparison.getReferencePairingsForLocation('Earth', lm);
                const moonPair = lm.moonPairing || (refRows[0] ? { name: refRows[0].moonName, lat: refRows[0].moonLat, lon: refRows[0].moonLon, coordText: refRows[0].moonCoordText, deltaDeg: refRows[0].moonDeltaDeg } : null);
                const marsPair = lm.marsPairing || (refRows[0] ? { name: refRows[0].marsName, lat: refRows[0].marsLat, lon: refRows[0].marsLon, coordText: refRows[0].marsCoordText, deltaDeg: refRows[0].marsDeltaDeg } : null);
                if (moonPair || marsPair) {
                    const pairWrap = document.createElement('div');
                    pairWrap.className = 'analogue-recommender';
                    pairWrap.style.marginTop = '8px';
                    pairWrap.innerHTML = `
                        <strong>Supplied Moon &amp; Mars Comparison Targets (Independent Planetary Coordinates)</strong>
                        <div class="analogue-recommendations-grid">
                            ${moonPair ? `
                                <div class="analogue-card">
                                    <span class="result-badge der">Table Pairing / Candidate Comparison</span>
                                    <strong style="margin-top:4px;">☽ Moon: ${escapeHtml(moonPair.name)}</strong>
                                    <p>Coordinates: <code>${escapeHtml(moonPair.coordText)}</code> (IAU2015:30100)</p>
                                    <p>Supplied Δ°: <strong>${escapeHtml(moonPair.deltaDeg)}°</strong></p>
                                    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                                        <button type="button" class="btn btn-small" id="btnInspectorGoMoon">Navigate on Moon</button>
                                        <button type="button" class="btn btn-small btn-primary" id="btnInspectorCompareMoon">⚖ Compare 3D</button>
                                    </div>
                                </div>
                            ` : ''}
                            ${marsPair ? `
                                <div class="analogue-card">
                                    <span class="result-badge der">Table Pairing / Candidate Comparison</span>
                                    <strong style="margin-top:4px;">♂ Mars: ${escapeHtml(marsPair.name)}</strong>
                                    <p>Coordinates: <code>${escapeHtml(marsPair.coordText)}</code> (IAU2015:49900)</p>
                                    <p>Supplied Δ°: <strong>${escapeHtml(marsPair.deltaDeg)}°</strong></p>
                                    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                                        <button type="button" class="btn btn-small" id="btnInspectorGoMars">Navigate on Mars</button>
                                        <button type="button" class="btn btn-small btn-primary" id="btnInspectorCompareMars">⚖ Compare 3D</button>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    `;
                    detailEl.appendChild(pairWrap);
                    pairWrap.querySelector('#btnInspectorGoMoon')?.addEventListener('click', () => {
                        switchBody('Moon', false);
                        const targetLm = PROVIDERS.Moon.landmarks.find(
                            item => Math.abs(item.lat - moonPair.lat) < 1e-2 && Math.abs(normalizeLon180(item.lon) - normalizeLon180(moonPair.lon)) < 1e-2
                        ) || null;
                        selectLocation(moonPair.lat, moonPair.lon, { focusCamera: true, distance: 2.15, landmark: targetLm });
                    });
                    pairWrap.querySelector('#btnInspectorCompareMoon')?.addEventListener('click', () => {
                        const targetLm = PROVIDERS.Moon.landmarks.find(
                            item => Math.abs(item.lat - moonPair.lat) < 1e-2 && Math.abs(normalizeLon180(item.lon) - normalizeLon180(moonPair.lon)) < 1e-2
                        ) || { name: moonPair.name, lat: moonPair.lat, lon: moonPair.lon, body: 'Moon', pairingStatus: 'table_pairing' };
                        loadSideBySideComparison(null, lm, { targetBody: 'Moon', targetLandmark: targetLm, deltaDeg: moonPair.deltaDeg, relationshipLabel: 'Table Pairing / Candidate Comparison' });
                    });
                    pairWrap.querySelector('#btnInspectorGoMars')?.addEventListener('click', () => {
                        switchBody('Mars', false);
                        const targetLm = PROVIDERS.Mars.landmarks.find(
                            item => Math.abs(item.lat - marsPair.lat) < 1e-2 && Math.abs(normalizeLon180(item.lon) - normalizeLon180(marsPair.lon)) < 1e-2
                        ) || null;
                        selectLocation(marsPair.lat, marsPair.lon, { focusCamera: true, distance: 2.15, landmark: targetLm });
                    });
                    pairWrap.querySelector('#btnInspectorCompareMars')?.addEventListener('click', () => {
                        const targetLm = PROVIDERS.Mars.landmarks.find(
                            item => Math.abs(item.lat - marsPair.lat) < 1e-2 && Math.abs(normalizeLon180(item.lon) - normalizeLon180(marsPair.lon)) < 1e-2
                        ) || { name: marsPair.name, lat: marsPair.lat, lon: marsPair.lon, body: 'Mars', pairingStatus: 'table_pairing' };
                        loadSideBySideComparison(null, lm, { targetBody: 'Mars', targetLandmark: targetLm, deltaDeg: marsPair.deltaDeg, relationshipLabel: 'Table Pairing / Candidate Comparison' });
                    });
                }
            }
            if (lm?.moonPairing) {
                detailEl.querySelector('#btnJumpPairedMoon')?.addEventListener('click', () => {
                    const mp = lm.moonPairing;
                    switchBody('Moon', false);
                    const targetLm = PROVIDERS.Moon.landmarks.find(
                        item => Math.abs(item.lat - mp.lat) < 1e-3 && Math.abs(normalizeLon180(item.lon) - normalizeLon180(mp.lon)) < 1e-3
                    ) || null;
                    selectLocation(mp.lat, mp.lon, { focusCamera: true, distance: 2.15, landmark: targetLm });
                });
            }
            if (lm?.marsPairing) {
                detailEl.querySelector('#btnJumpPairedMars')?.addEventListener('click', () => {
                    const mrp = lm.marsPairing;
                    switchBody('Mars', false);
                    const targetLm = PROVIDERS.Mars.landmarks.find(
                        item => Math.abs(item.lat - mrp.lat) < 1e-3 && Math.abs(normalizeLon180(item.lon) - normalizeLon180(mrp.lon)) < 1e-3
                    ) || null;
                    selectLocation(mrp.lat, mrp.lon, { focusCamera: true, distance: 2.15, landmark: targetLm });
                });
            }
            if (STATE.body !== 'Earth' && lm) {
                STATE.recommendedAnalogues = STATE.comparison.recommendEarthAnalogues({ body: STATE.body, landmark: lm });
                const choices = detailEl.querySelector('#locationAnalogueChoices');
                if (choices) {
                    choices.innerHTML = STATE.recommendedAnalogues.slice(0, 4).map((place, index) => `
                        <div class="analogue-card">
                            <span class="result-badge ${escapeHtml(place.badgeClass)}">${escapeHtml(place.relationshipLabel)}</span>
                            <strong style="margin-top:4px;">${escapeHtml(place.name)}</strong>
                            <p>Earth Coords: <code>${place.lat.toFixed(4)}°, ${place.lon.toFixed(4)}°E</code> (EPSG:4326)</p>
                            ${place.deltaDeg ? `<p>Supplied Δ°: <strong>${escapeHtml(place.deltaDeg)}°</strong></p>` : ''}
                            <p>${place.srtmAvailable ? 'NASA SRTM 1″ DEM available' : 'Outside SRTM (60°N–56°S); uses polar reference / local DEM'}</p>
                            <p>${escapeHtml(place.rationale)}</p>
                            <button type="button" class="btn btn-small btn-primary" data-select-analogue="${index}" style="margin-top:6px;">⚖ Compare 3D</button>
                        </div>
                    `).join('');
                    choices.querySelectorAll('[data-select-analogue]').forEach(button => {
                        button.addEventListener('click', () => {
                            const analogue = STATE.recommendedAnalogues[Number(button.dataset.selectAnalogue)];
                            if (analogue) {
                                loadSideBySideComparison(STATE.currentDem, analogue, {
                                    targetBody: STATE.body,
                                    targetLandmark: lm,
                                    deltaDeg: analogue.deltaDeg,
                                    relationshipLabel: analogue.relationshipLabel,
                                });
                            }
                        });
                    });
                }
                detailEl.querySelector('#btnManualCompare')?.addEventListener('click', () => {
                    const index = Number(detailEl.querySelector('#manualEarthAnalogueSelect')?.value);
                    const analogue = PROVIDERS.Earth.landmarks[index];
                    if (analogue) {
                        const rec = STATE.recommendedAnalogues?.find(r => r.name === analogue.name);
                        loadSideBySideComparison(STATE.currentDem, rec || analogue, {
                            targetBody: STATE.body,
                            targetLandmark: lm,
                            deltaDeg: rec?.deltaDeg || null,
                            relationshipLabel: rec?.relationshipLabel || (analogue.pairingStatus === 'table_pairing' ? 'Table Pairing / Candidate Comparison' : 'Candidate Comparison'),
                        });
                    }
                });
            }
        }
    }

    function switchBody(bodyKey, selectFirstLandmark = true) {
        if (!PROVIDERS[bodyKey]) return;
        STATE.body = bodyKey;
        CacheManager.saveWorkspaceState({ body: bodyKey });
        applyBodyBasemap(bodyKey);
        renderLandmarksList(bodyKey, document.getElementById('locationSearchInput')?.value || '');
        const filterTarget = document.getElementById('filterTarget');
        if (filterTarget && (bodyKey === 'Moon' || bodyKey === 'Mars')) {
            filterTarget.value = bodyKey;
        }
        if (selectFirstLandmark) {
            const first = PROVIDERS[bodyKey].landmarks[0];
            if (first) selectLocation(first.lat, first.lon, { focusCamera: true, distance: 2.75, landmark: first });
        }
    }

    function setViewMode(mode) {
        STATE.mode = mode;
        document.querySelectorAll('[data-view-mode]').forEach(b => {
            b.classList.toggle('active', b.dataset.viewMode === mode);
        });
        stageWrapper.dataset.mode = mode;
        if (mode === 'globe') {
            globeContainer.style.display = 'block';
            flatMapContainer.style.display = 'none';
        } else if (mode === 'map') {
            globeContainer.style.display = 'none';
            flatMapContainer.style.display = 'block';
        } else {
            globeContainer.style.display = 'block';
            flatMapContainer.style.display = 'block';
        }
        requestAnimationFrame(() => {
            const w = Math.max(1, globeContainer.clientWidth);
            const h = Math.max(1, globeContainer.clientHeight);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            if (leafletMap) {
                leafletMap.invalidateSize();
                STATE.syncingMap = true;
                leafletMap.setView([STATE.lat, STATE.lon], zoomFromGlobeDistance(camera.position.length()), { animate: false });
                setTimeout(() => { STATE.syncingMap = false; }, 120);
            }
        });
    }

    // 3D Globe Raycasting (Click to select landmark or surface coordinate)
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let downPos = null;
    renderer.domElement.addEventListener('pointerdown', e => { downPos = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', e => {
        if (!downPos) return;
        const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
        downPos = null;
        if (moved > 5) return;

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const markerHits = raycaster.intersectObjects(landmarkMeshes, false);
        if (markerHits.length > 0) {
            const { landmark } = markerHits[0].object.userData;
            selectLocation(landmark.lat, landmark.lon, { focusCamera: true, distance: 2.15, landmark });
            return;
        }
        const globeHits = raycaster.intersectObject(globeMesh, false);
        if (globeHits.length > 0) {
            const localPt = globeMesh.worldToLocal(globeHits[0].point.clone());
            const { lat, lon } = vector3ToLatLon(localPt);
            selectLocation(lat, lon, { focusCamera: false, sourceNote: 'Selected via 3D Globe raycast' });
        }
    });

    // Wire UI Controls
    document.querySelectorAll('.body-pill').forEach(btn => {
        btn.addEventListener('click', () => switchBody(btn.dataset.body, true));
    });

    document.querySelectorAll('[data-view-mode]').forEach(btn => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.viewMode));
    });

    // Flexible Coordinate Input Navigation (supports combined string or separate Lat/Lon in Decimal, DMS, N/S/E/W, negative, 0-360)
    function navigateToEnteredCoordinates() {
        const combinedVal = document.getElementById('coordCombinedInput').value.trim();
        const latVal = document.getElementById('coordLatInput').value.trim();
        const lonVal = document.getElementById('coordLonInput').value.trim();

        let pair = parsePlanetCoordinatePair(latVal, lonVal);
        if (!pair && combinedVal) {
            pair = parsePlanetCoordinatePair(combinedVal);
        }
        if (!pair) {
            setCoordStatus('Invalid coordinate format. Supported: decimal (-43.31, -11.36), hemisphere (29.5578°N, 95.0867°W), DMS (26°07′56″N 3°38′02″E), or 0–360°E (348.64E).', 'error');
            showToast('Could not parse coordinates. Check format.', 'warning');
            return;
        }
        const fmt = formatPlanetCoordinate(pair.lat, pair.lon);
        setCoordStatus(`Navigated to ${fmt.summary} [${fmt.dmsLat}, ${fmt.dmsLon}]`, 'ok');
        selectLocation(pair.lat, pair.lon, { focusCamera: true, distance: 2.15, sourceNote: 'Entered via Flexible Coordinate Input' });

        // Center a body-appropriate bounding box around the entered location (±0.5° Earth, ±5° Moon/Mars)
        const halfSpan = STATE.body === 'Earth' ? 0.5 : 5;
        const autoBox = sanitizeBbox(
            Math.min(90, pair.lat + halfSpan),
            Math.max(-90, pair.lat - halfSpan),
            normalizeLon180(pair.lon - halfSpan),
            normalizeLon180(pair.lon + halfSpan)
        );
        if (autoBox) setRegionBbox(autoBox);
    }

    document.getElementById('btnGoCoordinates')?.addEventListener('click', navigateToEnteredCoordinates);
    ['coordLatInput', 'coordLonInput', 'coordCombinedInput'].forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                if (id === 'coordCombinedInput') {
                    const p = parsePlanetCoordinatePair(el.value);
                    if (p) {
                        document.getElementById('coordLatInput').value = p.lat;
                        document.getElementById('coordLonInput').value = p.lon;
                    }
                }
                navigateToEnteredCoordinates();
            }
        });
    });

    // Location Search (Catalog + Live Earth Gazetteer)
    const searchInput = document.getElementById('locationSearchInput');
    searchInput?.addEventListener('input', () => {
        renderLandmarksList(STATE.body, searchInput.value);
    });
    document.getElementById('btnSearchGazetteer')?.addEventListener('click', async () => {
        const q = searchInput?.value.trim() || '';
        if (!q) return;
        // First check if query is itself a coordinate pair
        const asCoord = parsePlanetCoordinatePair(q);
        if (asCoord) {
            selectLocation(asCoord.lat, asCoord.lon, { focusCamera: true, distance: 2.1, sourceNote: 'Parsed from search bar' });
            return;
        }
        renderLandmarksList(STATE.body, q);
        if (STATE.body === 'Earth') {
            showLoading('Searching Earth Gazetteer (Nominatim)…');
            const hits = await geocodeEarthLocation(q);
            hideLoading();
            if (hits.length > 0) {
                const top = hits[0];
                selectLocation(top.lat, top.lon, {
                    focusCamera: true,
                    distance: 2.0,
                    landmark: { name: top.name, lat: top.lat, lon: top.lon, type: top.type, mission: 'Earth Gazetteer', source: top.source, desc: `Geocoded Earth location for "${q}".` },
                });
                if (top.bbox) setRegionBbox(sanitizeBbox(top.bbox.north, top.bbox.south, top.bbox.west, top.bbox.east));
                showToast(`Located: ${top.name}`, 'success');
            }
        }
    });

    // Zoom, Reset, Auto-Rotate, Region Selection
    document.getElementById('btnGlobeZoomIn')?.addEventListener('click', () => {
        if (STATE.mode === 'map' && leafletMap) leafletMap.zoomIn();
        else {
            camera.position.setLength(Math.max(controls.minDistance, camera.position.length() * 0.8));
            controls.update();
        }
    });
    document.getElementById('btnGlobeZoomOut')?.addEventListener('click', () => {
        if (STATE.mode === 'map' && leafletMap) leafletMap.zoomOut();
        else {
            camera.position.setLength(Math.min(controls.maxDistance, camera.position.length() * 1.25));
            controls.update();
        }
    });
    document.getElementById('btnGlobeReset')?.addEventListener('click', () => {
        moveGlobeCamera(STATE.lat, STATE.lon, 2.8);
        if (leafletMap) leafletMap.setView([STATE.lat, STATE.lon], 1);
    });
    document.getElementById('chkAutoRotate')?.addEventListener('change', e => {
        controls.autoRotate = e.target.checked;
        controls.autoRotateSpeed = 0.75;
    });
    document.getElementById('btnToggleRegionSelect')?.addEventListener('click', e => {
        STATE.regionSelecting = !STATE.regionSelecting;
        e.currentTarget.classList.toggle('active', STATE.regionSelecting);
        if (STATE.regionSelecting && STATE.mode === 'globe') {
            setViewMode('split');
        }
        showToast(STATE.regionSelecting ? 'Drag on the 2D Map to draw a bounding box.' : 'Region drag mode disabled.', 'info');
    });

    // Bounding Box & Surface Crop Controls
    function readAndApplyBboxInputs() {
        const n = parsePlanetCoordinate(document.getElementById('bboxNorth').value, 'lat');
        const s = parsePlanetCoordinate(document.getElementById('bboxSouth').value, 'lat');
        const w = parsePlanetCoordinate(document.getElementById('bboxWest').value, 'lon');
        const e = parsePlanetCoordinate(document.getElementById('bboxEast').value, 'lon');
        const b = sanitizeBbox(n, s, w, e);
        if (!b) {
            showToast('Enter valid North, South, West, East bounds.', 'warning');
            return null;
        }
        setRegionBbox(b);
        return b;
    }

    document.getElementById('btnApplyBbox')?.addEventListener('click', () => {
        const b = readAndApplyBboxInputs();
        if (b && leafletMap && !b.wrapsAntimeridian) {
            leafletMap.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [18, 18] });
        }
    });

    document.getElementById('btnPreviewSurfaceCrop')?.addEventListener('click', () => {
        const bbox = readAndApplyBboxInputs();
        if (!bbox) return;
        updateSurfaceCropPreview(bbox, { silent: false });
    });

    const cropCanvas = document.getElementById('regionCropCanvas');
    if (cropCanvas) {
        cropCanvas.title = 'Click to open this cropped region in the 3D Terrain Viewer';
        cropCanvas.style.cursor = 'pointer';
        cropCanvas.addEventListener('click', async () => {
            if (STATE.bbox) await buildRealDemForRegion(STATE.body, STATE.bbox);
        });
    }
    document.getElementById('btnCropTo3D')?.addEventListener('click', async () => {
        if (STATE.bbox) await buildRealDemForRegion(STATE.body, STATE.bbox);
    });

    document.getElementById('btnBuildRegionTerrain')?.addEventListener('click', async () => {
        const b = readAndApplyBboxInputs();
        if (!b) return;
        await buildRealDemForRegion(STATE.body, b);
    });

    document.getElementById('btnSearchPdsForLocation')?.addEventListener('click', () => {
        executePdsArchiveSearch();
    });

    // Animation & Resize
    new ResizeObserver(() => {
        const w = Math.max(1, globeContainer.clientWidth);
        const h = Math.max(1, globeContainer.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (leafletMap) leafletMap.invalidateSize();
    }).observe(stageWrapper);

    function animate() {
        requestAnimationFrame(animate);
        const explorerVisible = document.getElementById('tab-explorer')?.classList.contains('active');
        if (explorerVisible && STATE.mode !== 'map' && globeContainer.clientWidth > 0 && globeContainer.clientHeight > 0) {
            controls.update();
            renderer.render(scene, camera);
        }
    }
    animate();

    initLeafletMap();
    switchBody(STATE.body, false);
    const startupLandmark = STATE.selectedLandmark || PROVIDERS[STATE.body].landmarks.find(
        lm => Math.abs(lm.lat - STATE.lat) < 1e-4 && Math.abs(normalizeLon180(lm.lon) - normalizeLon180(STATE.lon)) < 1e-4
    ) || PROVIDERS[STATE.body].landmarks[0];
    selectLocation(STATE.lat, STATE.lon, {
        focusCamera: true,
        distance: 2.75,
        landmark: startupLandmark,
        preserveBbox: hasRestoredBbox,
    });
    if (STATE.bbox) setRegionBbox(STATE.bbox);
}

// ==================== REAL DEM → 3D TERRAIN PIPELINE ====================

async function buildRealDemForRegion(bodyKey, bbox) {
    const key = String(bodyKey || STATE.body).toLowerCase();
    const label = key === 'earth' ? 'Earth SRTM 1″' : key === 'mars' ? 'Mars MOLA 4 ppd' : 'Moon LOLA 4 ppd';
    showLoading(`Loading ${label} numerical elevation grid…`);
    try {
        const regionKey = `regional-dem:${key}:${bbox ? [bbox.north, bbox.south, bbox.west, bbox.east].join(':') : 'global'}`;
        let dem = await CacheManager.getRaster(regionKey);
        if (!dem) {
            if (key === 'earth') {
                dem = await fetchEarthSrtmDem(bbox, msg => showLoading(msg));
            } else {
                const globalDem = await fetchPlanetaryGlobalDem(bodyKey, msg => showLoading(msg));
                dem = bbox ? cropGeographicGrid(globalDem, bbox, 512) : downsampleGeographicGrid(globalDem, 512);
            }
            await CacheManager.setRaster(regionKey, dem);
        } else {
            showLoading(`Using cached ${label} regional DEM…`);
        }
        STATE.currentDem = dem;
        renderDemInTerrainTab(dem);
        showToast(`Rendered 3D terrain from ${label} (${dem.ncols}×${dem.nrows} cells).`, 'success');
    } catch (err) {
        showToast(`Terrain generation failed: ${err.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function getCustomHeatmapStops() {
    return {
        low: document.getElementById('customColorLow')?.value || '#1a3366',
        mid: document.getElementById('customColorMid')?.value || '#2eb872',
        high: document.getElementById('customColorHigh')?.value || '#f7e695',
    };
}

function updateTerrainLegendGradient(displayMode, bodyKey, customStops) {
    const gradEl = document.getElementById('legendGradient');
    if (!gradEl) return;
    const effectiveMap = displayMode === 'satellite' ? 'grayscale' : displayMode;
    const stops = [];
    for (let i = 0; i <= 10; i++) {
        const rgb = TextureManager.getColorFromMap(i / 10, effectiveMap, bodyKey, customStops);
        stops.push(`rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`);
    }
    gradEl.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
}

function renderDemInTerrainTab(dem) {
    STATE.currentDem = dem;
    switchTab('terrain');
    if (!STATE.terrainRenderer) {
        STATE.terrainRenderer = new TerrainRenderer(document.getElementById('terrainCanvasWrapper'));
    }
    const displayMode = document.getElementById('terrainDisplayMode')?.value || 'heatmap';
    const customStops = getCustomHeatmapStops();
    const exaggeration = Number(document.getElementById('terrainExaggeration')?.value) || 1.0;
    const wireframe = Boolean(document.getElementById('terrainWireframe')?.checked);
    const targetBody = dem.body || STATE.body;
    const targetBbox = dem.bbox || STATE.bbox;

    let surfaceTexture = STATE.textureManager?.buildCroppedRegionTexture(targetBody, targetBbox, dem) || null;
    const applyRegionalImageryMeta = tex => {
        const metaRow = document.getElementById('terrainImageryMetaCell');
        if (!metaRow || !tex?.userData) return;
        const { sourceName, resolution, date, coverageStatus } = tex.userData;
        metaRow.textContent = `${sourceName} · ${resolution} (${date}) [${coverageStatus}]`;
    };
    if (STATE.textureManager) {
        STATE.textureManager.fetchRegionalWmtsTexture(targetBody, targetBbox, dem).then(wmtsTex => {
            if (STATE.currentDem !== dem || !STATE.terrainRenderer || !wmtsTex) return;
            STATE.terrainRenderer.setSurfaceTexture(wmtsTex);
            applyRegionalImageryMeta(wmtsTex);
            if (document.getElementById('terrainDisplayMode')?.value === 'satellite') {
                STATE.terrainRenderer.setDisplayMode('satellite', getCustomHeatmapStops());
            }
        });
    }

    const metrics = STATE.comparison.computeDatasetMetrics(dem);
    STATE.terrainRenderer.renderDem(dem, {
        displayMode,
        customStops,
        exaggeration,
        wireframe,
        surfaceTexture,
        widthKm: metrics?.widthKm,
        heightKm: metrics?.heightKm,
        onCursorSample: ({ elevation, lat, lon }) => {
            document.getElementById('cursorElevation').textContent = `Elevation: ${elevation.toFixed(1)} m`;
            document.getElementById('cursorCoords').textContent = `Lat: ${lat.toFixed(3)}° · Lon: ${lon.toFixed(3)}°`;
        },
    });

    // Update Legend & Provenance Table
    document.getElementById('legendMin').textContent = `${Math.round(dem.minElev).toLocaleString()} m`;
    document.getElementById('legendMax').textContent = `${Math.round(dem.maxElev).toLocaleString()} m`;
    updateTerrainLegendGradient(displayMode, dem.body, customStops);

    const tbody = document.querySelector('#terrainMetaTable tbody');
    if (tbody) {
        const spanText = metrics ? `${metrics.widthKm.toLocaleString()} km × ${metrics.heightKm.toLocaleString()} km` : '—';
        const reliefText = `${Math.round(dem.maxElev - dem.minElev).toLocaleString()} m`;
        tbody.innerHTML = [
            ['Body', String(dem.body || '').toUpperCase()],
            ['Source Dataset', dem.source],
            ['Mission / Instrument', `${dem.mission} · ${dem.instrument}`],
            ['Grid Dimensions', `${dem.ncols} × ${dem.nrows} samples`],
            ['Physical Footprint (1:1)', spanText],
            ['Elevation Range', `${Math.round(dem.minElev).toLocaleString()} m to ${Math.round(dem.maxElev).toLocaleString()} m (Relief: ${reliefText})`],
            ['Vertical Datum', dem.units],
            ['Coordinate System', dem.coordSystem],
            ['Cell Size', `${Number(dem.cellsize).toFixed(4)}° (${metrics?.cellResolutionM || 'native'})`],
        ].map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('') + (() => {
            const providerKey = Object.keys(PROVIDERS).find(k => k.toLowerCase() === String(targetBody || '').toLowerCase()) || 'Moon';
            const regMeta = PROVIDERS[providerKey]?.regionalImagery?.primary;
            const initialImageryText = surfaceTexture?.userData
                ? `${surfaceTexture.userData.sourceName} · ${surfaceTexture.userData.resolution} (${surfaceTexture.userData.date})`
                : regMeta
                    ? `${regMeta.name} · ${regMeta.resolution} (${regMeta.date})`
                    : 'Global Equirectangular Mosaic';
            return `<tr><td><strong>Orbital Imagery Layer</strong></td><td id="terrainImageryMetaCell">${escapeHtml(initialImageryText)}</td></tr>`;
        })();
    }

    // Record snapshot for Cross-Body Comparison
    const snaps = STATE.comparison.recordDemSnapshot(dem);
    renderDemComparisonTable(snaps);
}

function renderDemComparisonTable(snaps) {
    const tbody = document.querySelector('#demComparisonTable tbody');
    if (!tbody || !snaps?.length) return;
    tbody.innerHTML = snaps.map(s => `
        <tr>
            <td><strong>${escapeHtml(s.body)}</strong></td>
            <td>${escapeHtml(s.source)}</td>
            <td class="mono">${escapeHtml(s.grid)}</td>
            <td class="mono">${s.minElev.toLocaleString()} m</td>
            <td class="mono">${s.maxElev.toLocaleString()} m</td>
            <td class="mono">${(s.reliefM ?? s.relief ?? 0).toLocaleString()} m</td>
            <td class="mono">${s.meanElev.toLocaleString()} m</td>
        </tr>
    `).join('');
}

// ==================== SIDE-BY-SIDE PLANETARY / EARTH COMPARISON ====================

function loadBodyTextureAsync(bodyKey) {
    return new Promise(resolve => {
        if (!STATE.textureManager) STATE.textureManager = new TextureManager(null);
        STATE.textureManager.loadBodyTexture(bodyKey, (texture) => resolve(texture || null), () => {});
    });
}

async function loadSideBySideComparison(primaryDem, earthAnalogue, options = {}) {
    const targetBody = options.targetBody || (primaryDem?.body && String(primaryDem.body).toLowerCase() !== 'earth'
        ? (String(primaryDem.body).toLowerCase() === 'mars' ? 'Mars' : 'Moon')
        : (STATE.body !== 'Earth' ? STATE.body : 'Moon'));
    const targetProvider = PROVIDERS[targetBody] || PROVIDERS.Moon;
    const targetLandmark = options.targetLandmark || (STATE.body === targetBody ? STATE.selectedLandmark : null) || targetProvider.landmarks[0];
    const resolvedEarth = earthAnalogue || STATE.selectedEarthAnalogue || PROVIDERS.Earth.landmarks[0];
    if (!resolvedEarth || !targetLandmark) {
        showToast('Select an Earth location and a Moon or Mars target to compare.', 'warning');
        return;
    }

    // Keep each body's bounding box strictly independent (±5° Moon/Mars, ±0.5° Earth)
    const targetBbox = targetLandmark.bbox
        ? sanitizeBbox(targetLandmark.bbox.north, targetLandmark.bbox.south, targetLandmark.bbox.west, targetLandmark.bbox.east)
        : sanitizeBbox(Math.min(90, targetLandmark.lat + 5), Math.max(-90, targetLandmark.lat - 5), targetLandmark.lon - 5, targetLandmark.lon + 5);
    const earthBbox = resolvedEarth.bbox
        ? sanitizeBbox(resolvedEarth.bbox.north, resolvedEarth.bbox.south, resolvedEarth.bbox.west, resolvedEarth.bbox.east)
        : sanitizeBbox(Math.min(90, resolvedEarth.lat + 0.5), Math.max(-90, resolvedEarth.lat - 0.5), resolvedEarth.lon - 0.5, resolvedEarth.lon + 0.5);

    showLoading(`Loading independent ${targetBody} and Earth 3D DEM grids…`);
    try {
        const demMatchesTargetBbox = (dem, bbox) => {
            if (!dem || String(dem.body || '').toLowerCase() !== targetBody.toLowerCase()) return false;
            const source = dem.croppedFrom || dem.bbox;
            if (!source) return false;
            const lonDelta = (a, b) => Math.abs(normalizeLon180(Number(a) - Number(b)));
            return Math.abs(Number(source.north) - bbox.north) <= 0.05 &&
                Math.abs(Number(source.south) - bbox.south) <= 0.05 &&
                lonDelta(source.west, bbox.west) <= 0.05 &&
                lonDelta(source.east, bbox.east) <= 0.05;
        };
        let resolvedPrimaryDem = demMatchesTargetBbox(primaryDem, targetBbox) ? primaryDem : null;
        const pKey = `regional-dem:${targetBody.toLowerCase()}:${[targetBbox.north, targetBbox.south, targetBbox.west, targetBbox.east].join(':')}`;
        if (!resolvedPrimaryDem) {
            const cachedDem = await CacheManager.getRaster(pKey);
            resolvedPrimaryDem = demMatchesTargetBbox(cachedDem, targetBbox) ? cachedDem : null;
        }
        if (!resolvedPrimaryDem) {
            const globalDem = await fetchPlanetaryGlobalDem(targetBody, msg => showLoading(msg));
            resolvedPrimaryDem = cropGeographicGrid(globalDem, targetBbox, 512);
            resolvedPrimaryDem.body = targetBody;
            await CacheManager.setRaster(pKey, resolvedPrimaryDem);
        }
        const earthDem = await fetchEarthSrtmDem(earthBbox, message => showLoading(message));
        await Promise.all([loadBodyTextureAsync(targetBody), loadBodyTextureAsync('Earth')]);

        switchTab('comparison');
        const primaryHost = document.getElementById('compViewportPrimary');
        const earthHost = document.getElementById('compViewportEarth');
        if (!STATE.comparisonRenderers.primary) STATE.comparisonRenderers.primary = new TerrainRenderer(primaryHost);
        if (!STATE.comparisonRenderers.earth) STATE.comparisonRenderers.earth = new TerrainRenderer(earthHost);

        const displayMode = document.getElementById('compSurfaceMode')?.value || 'heatmap';
        const scaleMode = document.getElementById('compScaleMode')?.value || 'physical';
        const exaggeration = Number(document.getElementById('compExaggeration')?.value) || 1.0;
        const wireframe = Boolean(document.getElementById('chkCompWireframe')?.checked);
        const customStops = getCustomHeatmapStops();

        const snaps = STATE.comparison.recordDemSnapshot(resolvedPrimaryDem);
        const allSnaps = STATE.comparison.recordDemSnapshot(earthDem);
        renderDemComparisonTable(allSnaps || snaps);

        const scaleContext = STATE.comparison.getPhysicalScaleContext([resolvedPrimaryDem, earthDem]);
        const primaryStats = STATE.comparison.computeDatasetMetrics(resolvedPrimaryDem);
        const earthStats = STATE.comparison.computeDatasetMetrics(earthDem);

        // Render immediately with the already-loaded global mosaic. Regional WMTS
        // imagery is fetched afterwards so slow tile services cannot block the DEM.
        const primaryOverview = STATE.textureManager
            ? STATE.textureManager.buildCroppedRegionTexture(targetBody, resolvedPrimaryDem.bbox || targetBbox, resolvedPrimaryDem)
            : null;
        const earthOverview = STATE.textureManager
            ? STATE.textureManager.buildCroppedRegionTexture('Earth', earthDem.bbox || earthBbox, earthDem)
            : null;

        STATE.comparisonRenderers.primary.renderDem(resolvedPrimaryDem, {
            displayMode, customStops, exaggeration, wireframe, surfaceTexture: primaryOverview,
            scaleMode, scaleContext, widthKm: primaryStats?.widthKm, heightKm: primaryStats?.heightKm,
            onCursorSample: ({ elevation, lat, lon }) => {
                const el = document.getElementById('compPrimaryCursor');
                if (el) el.textContent = `Elev: ${elevation.toFixed(1)} m · ${lat.toFixed(3)}°, ${lon.toFixed(3)}°E`;
            },
        });
        STATE.comparisonRenderers.earth.renderDem(earthDem, {
            displayMode, customStops, exaggeration, wireframe, surfaceTexture: earthOverview,
            scaleMode, scaleContext, widthKm: earthStats?.widthKm, heightKm: earthStats?.heightKm,
            onCursorSample: ({ elevation, lat, lon }) => {
                const el = document.getElementById('compEarthCursor');
                if (el) el.textContent = `Elev: ${elevation.toFixed(1)} m · ${lat.toFixed(3)}°, ${lon.toFixed(3)}°E`;
            },
        });

        const comparisonPrimaryRenderer = STATE.comparisonRenderers.primary;
        const comparisonEarthRenderer = STATE.comparisonRenderers.earth;
        if (STATE.textureManager) {
            Promise.all([
                STATE.textureManager.fetchRegionalWmtsTexture(targetBody, resolvedPrimaryDem.bbox || targetBbox, resolvedPrimaryDem),
                STATE.textureManager.fetchRegionalWmtsTexture('Earth', earthDem.bbox || earthBbox, earthDem),
            ]).then(([primaryRegional, earthRegional]) => {
                if (comparisonPrimaryRenderer?.data === resolvedPrimaryDem && primaryRegional) {
                    comparisonPrimaryRenderer.setSurfaceTexture(primaryRegional);
                    if (document.getElementById('compSurfaceMode')?.value === 'satellite') {
                        comparisonPrimaryRenderer.setDisplayMode('satellite', getCustomHeatmapStops());
                    }
                }
                if (comparisonEarthRenderer?.data === earthDem && earthRegional) {
                    comparisonEarthRenderer.setSurfaceTexture(earthRegional);
                    if (document.getElementById('compSurfaceMode')?.value === 'satellite') {
                        comparisonEarthRenderer.setDisplayMode('satellite', getCustomHeatmapStops());
                    }
                }
                const pMeta = document.getElementById('compPrimaryMeta');
                const eMeta = document.getElementById('compEarthMeta');
                if (pMeta && primaryRegional?.userData) pMeta.insertAdjacentHTML('beforeend',
                    `<br><strong>Imagery:</strong> ${escapeHtml(primaryRegional.userData.sourceName || 'Regional imagery')} — ${escapeHtml(primaryRegional.userData.coverageStatus || 'Coverage unknown')}`);
                if (eMeta && earthRegional?.userData) eMeta.insertAdjacentHTML('beforeend',
                    `<br><strong>Imagery:</strong> ${escapeHtml(earthRegional.userData.sourceName || 'Regional imagery')} — ${escapeHtml(earthRegional.userData.coverageStatus || 'Coverage unknown')}`);
            }).catch(error => console.warn('Regional comparison imagery upgrade failed:', error));
        }

        const pFmt = formatPlanetCoordinate(targetLandmark.lat, targetLandmark.lon);
        const eFmt = formatPlanetCoordinate(resolvedEarth.lat, resolvedEarth.lon);
        const scaleLabel = scaleMode === 'physical' ? 'Shared Horizontal Scale (km-unified)' : 'Normalized Fit';

        document.getElementById('compPrimaryTitle').textContent = `${targetBody} · ${targetLandmark.name}`;
        document.getElementById('compPrimaryBadge').textContent = `${targetBody} · ${targetProvider.crs.code}`;
        document.getElementById('compPrimaryMeta').innerHTML = `
            <strong>Coords:</strong> <code>${escapeHtml(targetLandmark.coordText || pFmt.summary)}</code> · <strong>Bbox:</strong> <code>${targetBbox.south.toFixed(2)}°…${targetBbox.north.toFixed(2)}°N, ${targetBbox.west.toFixed(2)}°…${targetBbox.east.toFixed(2)}°E</code><br>
            <strong>DEM Resolution:</strong> ${escapeHtml(primaryStats?.cellResolutionM || '—')} (${resolvedPrimaryDem.ncols}×${resolvedPrimaryDem.nrows}) · <strong>Footprint:</strong> ~${primaryStats?.widthKm.toLocaleString()}×${primaryStats?.heightKm.toLocaleString()} km<br>
            <strong>Scale:</strong> ${scaleLabel} · <strong>Exaggeration:</strong> <span class="comp-exag-readout">${exaggeration.toFixed(1)}×</span> · <strong>Relief:</strong> ${Math.round(primaryStats?.reliefM || 0).toLocaleString()} m
        `;

        document.getElementById('compEarthTitle').textContent = `Earth · ${resolvedEarth.name}`;
        document.getElementById('compEarthBadge').textContent = `Earth · ${PROVIDERS.Earth.crs.code}`;
        document.getElementById('compEarthMeta').innerHTML = `
            <strong>Coords:</strong> <code>${escapeHtml(resolvedEarth.coordText || eFmt.summary)}</code> · <strong>Bbox:</strong> <code>${earthBbox.south.toFixed(2)}°…${earthBbox.north.toFixed(2)}°N, ${earthBbox.west.toFixed(2)}°…${earthBbox.east.toFixed(2)}°E</code><br>
            <strong>DEM Resolution:</strong> ${escapeHtml(earthStats?.cellResolutionM || '—')} (${earthDem.ncols}×${earthDem.nrows}) · <strong>Footprint:</strong> ~${earthStats?.widthKm.toLocaleString()}×${earthStats?.heightKm.toLocaleString()} km<br>
            <strong>Scale:</strong> ${scaleLabel} · <strong>Exaggeration:</strong> <span class="comp-exag-readout">${exaggeration.toFixed(1)}×</span> · <strong>Relief:</strong> ${Math.round(earthStats?.reliefM || 0).toLocaleString()} m
        `;

        let syncing = false;
        STATE.comparisonRenderers.primary.onCameraChange = source => {
            if (syncing || !document.getElementById('chkCompSyncCameras')?.checked) return;
            syncing = true;
            try { STATE.comparisonRenderers.earth?.applyCameraSphericalState(source.getCameraSphericalState()); }
            finally { syncing = false; }
        };
        STATE.comparisonRenderers.earth.onCameraChange = source => {
            if (syncing || !document.getElementById('chkCompSyncCameras')?.checked) return;
            syncing = true;
            try { STATE.comparisonRenderers.primary?.applyCameraSphericalState(source.getCameraSphericalState()); }
            finally { syncing = false; }
        };

        // Determine relationship status & preserved Δ°
        const refRows = STATE.comparison.getReferencePairingsForLocation('Earth', resolvedEarth);
        const matchedRow = refRows.find(r =>
            targetBody === 'Moon'
                ? Math.abs(r.moonLat - targetLandmark.lat) < 0.05 && Math.abs(r.moonLon - targetLandmark.lon) < 0.05
                : Math.abs(r.marsLat - targetLandmark.lat) < 0.05 && Math.abs(r.marsLon - targetLandmark.lon) < 0.05
        );
        const deltaDeg = options.deltaDeg || (matchedRow ? (targetBody === 'Moon' ? matchedRow.moonDeltaDeg : matchedRow.marsDeltaDeg) : null);
        const isVerified = Boolean(
            resolvedEarth.pairingStatus !== 'table_pairing' &&
            targetLandmark.pairingStatus !== 'table_pairing' &&
            (String(resolvedEarth.targetPair || '').toLowerCase().includes(targetLandmark.name.split('—')[0].trim().toLowerCase()) ||
             String(targetLandmark.targetPair || '').toLowerCase().includes(resolvedEarth.name.split('—')[0].trim().toLowerCase()))
        );
        const relLabel = options.relationshipLabel || (isVerified
            ? 'Verified Analogue (Documented Relationship)'
            : matchedRow || deltaDeg
                ? 'Table Pairing / Candidate Comparison (Unverified)'
                : 'Candidate Comparison');
        const relBadge = isVerified ? 'meas' : 'der';

        const cards = document.getElementById('compAnalogueCardsContainer');
        if (cards) {
            cards.innerHTML = `
                <div class="analogue-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <strong>${escapeHtml(resolvedEarth.name)} ↔ ${escapeHtml(targetLandmark.name)} (${escapeHtml(targetBody)})</strong>
                        <span class="result-badge ${relBadge}">${escapeHtml(relLabel)}</span>
                    </div>
                    <p style="margin-top:4px;">
                        <strong>Earth (${escapeHtml(PROVIDERS.Earth.crs.code)}):</strong> <code>${escapeHtml(resolvedEarth.coordText || eFmt.summary)}</code> ·
                        <strong>${escapeHtml(targetBody)} (${escapeHtml(targetProvider.crs.code)}):</strong> <code>${escapeHtml(targetLandmark.coordText || pFmt.summary)}</code>
                        ${deltaDeg ? ` · <strong>Supplied Δ°:</strong> <code>${escapeHtml(deltaDeg)}°</code> (preserved from reference table)` : ''}
                    </p>
                    <p>${escapeHtml(resolvedEarth.rationale || resolvedEarth.desc || 'Independent regional DEM comparison.')}</p>
                </div>
            `;
        }

        const conflicts = [
            ...STATE.comparison.getSourceConflicts(resolvedEarth.name),
            ...STATE.comparison.getSourceConflicts(targetLandmark.name),
        ];
        const conflictBanner = document.getElementById('compConflictBanner');
        if (conflictBanner) {
            if (conflicts.length) {
                conflictBanner.style.display = 'block';
                conflictBanner.innerHTML = `<strong>Source Coordinate Conflict Report (All Variants Preserved):</strong> ${escapeHtml([...new Set(conflicts.map(c => c.note))].join(' | '))}`;
            } else {
                conflictBanner.style.display = 'none';
            }
        }

        STATE.selectedEarthAnalogue = resolvedEarth;
        STATE.comparisonTarget = { body: targetBody, landmark: targetLandmark, primaryDem: resolvedPrimaryDem, deltaDeg, relationshipLabel: relLabel };
        CacheManager.saveWorkspaceState({
            compEarthName: resolvedEarth.name,
            compTargetBody: targetBody,
            compTargetName: targetLandmark.name,
        });
    } catch (error) {
        showToast(`Comparison failed: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function initComparisonControls() {
    const earthSel = document.getElementById('compEarthSelect');
    const bodySel = document.getElementById('compTargetBodySelect');
    const targetSel = document.getElementById('compTargetSelect');

    function populateTargetSelect(bodyKey, preferredName = '') {
        if (!targetSel) return;
        const list = PROVIDERS[bodyKey]?.landmarks || [];
        targetSel.innerHTML = list.map((lm, i) => `<option value="${i}">${escapeHtml(lm.name)} (${lm.coordText || `${lm.lat.toFixed(2)}°, ${lm.lon.toFixed(2)}°E`})</option>`).join('');
        if (preferredName) {
            const idx = list.findIndex(lm => lm.name.toLowerCase().includes(preferredName.replace('*', '').split('/')[0].trim().toLowerCase()) &&
                (!preferredName.includes('*') || lm.name.includes('*')));
            const fallbackIdx = idx !== -1 ? idx : list.findIndex(lm => lm.name.toLowerCase().includes(preferredName.replace('*', '').split('/')[0].trim().toLowerCase()));
            if (fallbackIdx !== -1) targetSel.value = String(fallbackIdx);
        }
    }

    if (earthSel) {
        earthSel.innerHTML = PROVIDERS.Earth.landmarks.map((lm, i) =>
            `<option value="${i}">${escapeHtml(lm.name)} (${lm.coordText || `${lm.lat.toFixed(2)}°, ${lm.lon.toFixed(2)}°E`})</option>`
        ).join('');
        earthSel.addEventListener('change', () => {
            const earthLm = PROVIDERS.Earth.landmarks[Number(earthSel.value)];
            const tBody = bodySel?.value || 'Moon';
            const pair = tBody === 'Moon' ? earthLm?.moonPairing : earthLm?.marsPairing;
            if (pair) populateTargetSelect(tBody, pair.name);
        });
    }
    if (bodySel) {
        bodySel.addEventListener('change', () => {
            const earthLm = PROVIDERS.Earth.landmarks[Number(earthSel?.value || 0)];
            const tBody = bodySel.value || 'Moon';
            const pair = tBody === 'Moon' ? earthLm?.moonPairing : earthLm?.marsPairing;
            populateTargetSelect(tBody, pair?.name || '');
        });
    }
    populateTargetSelect(bodySel?.value || 'Moon');

    // Restore saved comparison selection if available
    const saved = CacheManager.loadWorkspaceState();
    if (saved.compEarthName && earthSel) {
        const eIdx = PROVIDERS.Earth.landmarks.findIndex(l => l.name === saved.compEarthName);
        if (eIdx !== -1) earthSel.value = String(eIdx);
    }
    if (saved.compTargetBody && bodySel && PROVIDERS[saved.compTargetBody]) {
        bodySel.value = saved.compTargetBody;
        populateTargetSelect(saved.compTargetBody, saved.compTargetName || '');
    }

    document.getElementById('btnRunComparison')?.addEventListener('click', () => {
        const earthLm = PROVIDERS.Earth.landmarks[Number(earthSel?.value || 0)];
        const tBody = bodySel?.value || 'Moon';
        const targetLm = PROVIDERS[tBody]?.landmarks[Number(targetSel?.value || 0)];
        if (earthLm && targetLm) {
            loadSideBySideComparison(null, earthLm, { targetBody: tBody, targetLandmark: targetLm });
        }
    });

    document.getElementById('btnSendTerrainToCompare')?.addEventListener('click', () => {
        if (STATE.body === 'Earth') {
            const earthLm = STATE.selectedLandmark || PROVIDERS.Earth.landmarks[0];
            const mp = earthLm?.moonPairing;
            const targetLm = mp
                ? PROVIDERS.Moon.landmarks.find(l => Math.abs(l.lat - mp.lat) < 0.05 && Math.abs(l.lon - mp.lon) < 0.05) || PROVIDERS.Moon.landmarks[0]
                : PROVIDERS.Moon.landmarks[0];
            loadSideBySideComparison(null, earthLm, { targetBody: 'Moon', targetLandmark: targetLm, deltaDeg: mp?.deltaDeg });
            return;
        }
        const analogue = STATE.selectedEarthAnalogue || STATE.recommendedAnalogues?.[0] || PROVIDERS.Earth.landmarks[0];
        loadSideBySideComparison(STATE.currentDem, analogue, {
            targetBody: STATE.body,
            targetLandmark: STATE.selectedLandmark || PROVIDERS[STATE.body].landmarks[0],
            deltaDeg: analogue?.deltaDeg,
            relationshipLabel: analogue?.relationshipLabel,
        });
    });

    document.querySelectorAll('[data-comp-cam]').forEach(button => {
        button.addEventListener('click', () => {
            const view = button.dataset.compCam;
            for (const renderer of Object.values(STATE.comparisonRenderers)) {
                if (!renderer) continue;
                if (view === 'fit') renderer.fitCamera(false);
                else renderer.setCameraView(view, false);
            }
        });
    });

    document.getElementById('btnResetPrimaryCam')?.addEventListener('click', () => STATE.comparisonRenderers.primary?.setCameraView('reset', false));
    document.getElementById('btnFitPrimaryCam')?.addEventListener('click', () => STATE.comparisonRenderers.primary?.fitCamera(false));
    document.getElementById('btnResetEarthCam')?.addEventListener('click', () => STATE.comparisonRenderers.earth?.setCameraView('reset', false));
    document.getElementById('btnFitEarthCam')?.addEventListener('click', () => STATE.comparisonRenderers.earth?.fitCamera(false));

    document.getElementById('chkCompSyncCameras')?.addEventListener('change', event => {
        STATE.comparison.syncEnabled = Boolean(event.target.checked);
        if (event.target.checked) {
            const cameraState = STATE.comparisonRenderers.primary?.getCameraSphericalState();
            if (cameraState) STATE.comparisonRenderers.earth?.applyCameraSphericalState(cameraState);
        }
    });

    document.getElementById('compSurfaceMode')?.addEventListener('change', event => {
        const mode = event.target.value;
        const stops = getCustomHeatmapStops();
        Object.entries(STATE.comparisonRenderers).forEach(([slotKey, renderer]) => {
            if (!renderer) return;
            renderer.setDisplayMode(mode, stops);
            if (mode === 'satellite' && !renderer.surfaceTexture && renderer.data && STATE.textureManager) {
                const bodyKey = renderer.data.body || (slotKey === 'earth' ? 'Earth' : (STATE.comparisonTarget?.body || 'Moon'));
                STATE.textureManager.fetchRegionalWmtsTexture(bodyKey, renderer.data.bbox, renderer.data)
                    .then(texture => {
                        if (!texture || renderer.data == null) return;
                        renderer.setSurfaceTexture(texture);
                        if (document.getElementById('compSurfaceMode')?.value === 'satellite') {
                            renderer.setDisplayMode('satellite', getCustomHeatmapStops());
                        }
                    })
                    .catch(error => console.warn(`Could not load ${slotKey} comparison imagery:`, error));
            }
        });
    });

    document.getElementById('compExaggeration')?.addEventListener('input', event => {
        const v = Number(event.target.value) || 1.0;
        const lbl = document.getElementById('compExagLabel');
        if (lbl) lbl.textContent = `${v.toFixed(1)}×`;
        document.querySelectorAll('.comp-exag-readout').forEach(el => { el.textContent = `${v.toFixed(1)}×`; });
        Object.values(STATE.comparisonRenderers).forEach(renderer => renderer?.updateExaggeration(v));
    });

    document.getElementById('chkCompWireframe')?.addEventListener('change', event => {
        Object.values(STATE.comparisonRenderers).forEach(renderer => renderer?.setWireframe(event.target.checked));
    });

    document.getElementById('compScaleMode')?.addEventListener('change', () => {
        if (STATE.comparisonTarget && STATE.selectedEarthAnalogue) {
            loadSideBySideComparison(STATE.comparisonTarget.primaryDem, STATE.selectedEarthAnalogue, {
                targetBody: STATE.comparisonTarget.body,
                targetLandmark: STATE.comparisonTarget.landmark,
                deltaDeg: STATE.comparisonTarget.deltaDeg,
                relationshipLabel: STATE.comparisonTarget.relationshipLabel,
            });
        }
    });
}

// ==================== PDS ARCHIVE SEARCH ====================

async function executePdsArchiveSearch() {
    const target = document.getElementById('filterTarget').value;
    const mission = document.getElementById('filterMission').value;
    const instrument = document.getElementById('filterInstrument').value;
    const processingLevel = document.getElementById('filterProcessingLevel').value;
    const keyword = document.getElementById('filterKeyword').value.trim();
    const productId = document.getElementById('filterProductId').value.trim();

    // PDS requests run in the background. Do not use the full-screen loading
    // overlay here: a slow/unavailable registry must never block the interface.
    const summaryEl = document.getElementById('pdsResultsSummary');
    if (summaryEl) summaryEl.textContent = 'Searching the NASA PDS4 Registry…';
    try {
        if (productId) {
            const res = await searchPDSByLidvid(productId);
            if (res.ok && res.data) {
                renderPdsSearchResults({ summary: { hits: 1 }, data: [res.data] });
            } else {
                if (summaryEl) summaryEl.textContent = 'PDS product lookup could not be completed.';
                showToast(`Product lookup failed: ${res.statusText || 'Registry unavailable'}`, 'error');
            }
            return;
        }
        const res = await searchPDS({
            target,
            mission,
            instrument,
            processingLevel,
            keyword,
            defaultMoonMars: !target,
            limit: 20,
        });
        if (res.ok && res.data) {
            renderPdsSearchResults(res.data);
        } else {
            if (summaryEl) summaryEl.textContent = 'PDS search unavailable. Other explorer controls remain usable.';
            showToast(`PDS search error: ${res.error || res.statusText || 'Registry unavailable'}`, 'error');
        }
    } catch (err) {
        if (summaryEl) summaryEl.textContent = 'PDS search unavailable. Other explorer controls remain usable.';
        showToast(`PDS search failed: ${err.message}`, 'error');
    }
}

function renderPdsSearchResults(data) {
    const container = document.getElementById('pdsResultsContainer');
    const summaryEl = document.getElementById('pdsResultsSummary');
    const products = data.data || [];
    const hits = data.summary?.hits ?? products.length;
    summaryEl.textContent = `Found ${hits.toLocaleString()} NASA PDS4 products — showing ${products.length}`;

    if (!products.length) {
        container.innerHTML = `<div class="results-placeholder">No matching PDS4 products found.</div>`;
        return;
    }

    container.innerHTML = products.map((product, idx) => {
        const props = product.properties || product;
        const lidvid = getPropertyValue(props, 'lidvid') || product.id || `product-${idx}`;
        const title = getPropertyValue(props, 'pds:Identification_Area.pds:title') || lidvid;
        const target = getPropertyValue(props, 'pds:Target_Identification.pds:name') || '—';
        const mission = getPropertyValue(props, 'pds:Investigation_Area.pds:name') || '—';
        const inst = getPropertyValue(props, 'pds:Observing_System.pds:Observing_System_Component.pds:name') || '—';
        const level = getPropertyValue(props, 'pds:Primary_Result_Summary.pds:processing_level') || '';
        const badge = classifyProduct(level, getExplicitProductType(props));
        const desc = getPropertyValue(props, 'pds:Primary_Result_Summary.pds:description') || '';

        const west = Number(getPropertyValue(props, 'cart:west_bounding_coordinate'));
        const east = Number(getPropertyValue(props, 'cart:east_bounding_coordinate'));
        const south = Number(getPropertyValue(props, 'cart:south_bounding_coordinate'));
        const north = Number(getPropertyValue(props, 'cart:north_bounding_coordinate'));
        const hasFootprint = [west, east, south, north].every(Number.isFinite) && getPropertyValue(props, 'cart:west_bounding_coordinate') !== '';
        const overlaps = hasFootprint && STATE.bbox ? bboxIntersects({ west, east, south, north }, STATE.bbox) : null;

        return `
            <article class="result-item product-card">
                <div class="result-item-header">
                    <div>
                        <h4 class="result-title">${escapeHtml(title)}</h4>
                        <code class="result-subtitle">${escapeHtml(lidvid)}</code>
                    </div>
                    <div class="product-badges">
                        ${badge.label !== '—' ? `<span class="result-badge ${badge.class}">${escapeHtml(badge.label)}</span>` : ''}
                        ${level ? `<span class="result-badge level-badge">${escapeHtml(level)}</span>` : ''}
                    </div>
                </div>
                ${desc ? `<p class="result-description">${escapeHtml(desc.slice(0, 240))}</p>` : ''}
                <div class="product-meta-grid">
                    <div class="meta-cell"><span class="meta-label">Target</span><span class="meta-val">${escapeHtml(target)}</span></div>
                    <div class="meta-cell"><span class="meta-label">Mission</span><span class="meta-val">${escapeHtml(mission)}</span></div>
                    <div class="meta-cell"><span class="meta-label">Instrument</span><span class="meta-val">${escapeHtml(inst)}</span></div>
                    <div class="meta-cell"><span class="meta-label">Spatial Overlap</span><span class="meta-val mono">${
                        hasFootprint
                            ? `${south}°…${north}°N, ${west}°…${east}°E (${overlaps ? 'Overlaps Region' : 'Outside Region'})`
                            : 'Coverage bounds not indexed'
                    }</span></div>
                </div>
            </article>
        `;
    }).join('');
}

// ==================== NAVIGATION & TERRAIN CONTROLS ====================

function switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
    const terrainSelect = document.getElementById('terrainSourceSelect');
    if (terrainSelect) {
        terrainSelect.value = STATE.body === 'Earth' ? 'earth-srtm' : STATE.body === 'Mars' ? 'mars-mola' : 'moon-lola';
    }
    CacheManager.saveWorkspaceState({
        body: STATE.body,
        lat: STATE.lat,
        lon: STATE.lon,
        bbox: STATE.bbox,
        landmarkName: STATE.selectedLandmark?.name || null,
    });
}

function initTerrainTabControls() {
    document.getElementById('btnLoadTerrainSource')?.addEventListener('click', async () => {
        const src = document.getElementById('terrainSourceSelect').value;
        if (src === 'moon-lola') await buildRealDemForRegion('Moon', STATE.bbox);
        else if (src === 'mars-mola') await buildRealDemForRegion('Mars', STATE.bbox);
        else if (src === 'earth-srtm') await buildRealDemForRegion('Earth', STATE.bbox);
    });

    document.getElementById('terrainFileInput')?.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const dem = file.name.toLowerCase().endsWith('.asc') ? parseESRIASCII(text) : parseCSVElevation(text);
            dem.source = `Uploaded File: ${file.name}`;
            renderDemInTerrainTab(dem);
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        }
    });

    document.getElementById('terrainExaggeration')?.addEventListener('input', e => {
        const v = Number(e.target.value) || 1;
        document.getElementById('exaggerationLabel').textContent = `${v.toFixed(1)}×`;
        STATE.terrainRenderer?.updateExaggeration(v);
    });

    document.getElementById('terrainDisplayMode')?.addEventListener('change', e => {
        const mode = e.target.value;
        const customGroup = document.getElementById('customHeatmapControls');
        if (customGroup) customGroup.style.display = mode === 'custom-heatmap' ? 'block' : 'none';
        const stops = getCustomHeatmapStops();
        if (mode === 'satellite' && STATE.currentDem && STATE.textureManager && !STATE.terrainRenderer?.surfaceTexture) {
            const targetBody = STATE.currentDem.body || STATE.body;
            const targetBbox = STATE.currentDem.bbox || STATE.bbox;
            loadBodyTextureAsync(targetBody).then(() => {
                const tex = STATE.textureManager.buildCroppedRegionTexture(targetBody, targetBbox, STATE.currentDem);
                if (tex && STATE.terrainRenderer) {
                    STATE.terrainRenderer.setSurfaceTexture(tex);
                    STATE.terrainRenderer.setDisplayMode('satellite', stops);
                }
            });
        }
        STATE.terrainRenderer?.setDisplayMode(mode, stops);
        updateTerrainLegendGradient(mode, STATE.currentDem?.body || STATE.body, stops);
    });

    ['customColorLow', 'customColorMid', 'customColorHigh'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            const stops = getCustomHeatmapStops();
            const terrainMode = document.getElementById('terrainDisplayMode')?.value || 'heatmap';
            if (terrainMode === 'custom-heatmap') {
                STATE.terrainRenderer?.setDisplayMode('custom-heatmap', stops);
                updateTerrainLegendGradient('custom-heatmap', STATE.currentDem?.body || STATE.body, stops);
            }
            if (document.getElementById('compSurfaceMode')?.value === 'custom-heatmap') {
                Object.values(STATE.comparisonRenderers).forEach(renderer => renderer?.setDisplayMode('custom-heatmap', stops));
            }
        });
    });

    document.getElementById('terrainWireframe')?.addEventListener('change', e => {
        STATE.terrainRenderer?.setWireframe(e.target.checked);
    });

    document.querySelectorAll('[data-cam-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.camView === 'fit') STATE.terrainRenderer?.fitCamera();
            else STATE.terrainRenderer?.setCameraView(btn.dataset.camView);
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    onApiCallCountChange(count => {
        const el = document.getElementById('statApiCalls');
        if (el) el.textContent = String(count);
    });

    initPlanetaryExplorer();
    initTerrainTabControls();
    initComparisonControls();

    // Populate live PDS counts & initial search
    executePdsArchiveSearch();
    const [moonHits, marsHits] = await Promise.all([getPDSProductCount('Moon'), getPDSProductCount('Mars')]);
    if (moonHits !== null) document.getElementById('statMoonCount').textContent = moonHits.toLocaleString();
    if (marsHits !== null) document.getElementById('statMarsCount').textContent = marsHits.toLocaleString();
    document.getElementById('apiStatusDot')?.classList.add('online');
    document.getElementById('apiStatusText').textContent = 'PDS & Proxy Ready';
});

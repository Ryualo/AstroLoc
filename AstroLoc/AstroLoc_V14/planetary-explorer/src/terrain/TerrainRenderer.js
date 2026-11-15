// src/terrain/TerrainRenderer.js
// Three.js 3D numerical DEM mesh renderer, GLB model viewer, camera presets, and memory disposal.

import { normalizeLon180, computeRegionSpanKm } from '../core/CoordinateEngine.js';
import { TextureManager } from './TextureManager.js';

export class TerrainRenderer {
    constructor(wrapperEl) {
        this.wrapper = wrapperEl;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.mesh = null;
        this.grid = null;
        this.data = null;
        this.glbInfo = null;
        this.animationId = null;
        this.resizeObserver = null;
        this.surfaceTexture = null;
        this.surfaceMode = 'elevation';
        this.displayMode = 'heatmap';
        this.customStops = null;
        this.exaggeration = 1.0;
        this.physicalSpanKm = null;
        this.worldUnitsPerKm = 1;
        this.baseHeightWorld = 1;
        this.onCameraChange = null;
        this._suppressSync = false;
        this._lastRaycastAt = 0;
        this.boundingRadius = 5;
        this.boundingCenter = null;
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.controls) {
            this.controls.dispose?.();
            this.controls = null;
        }
        this.glbInfo = null;
        if (this.scene) {
            this.scene.traverse(obj => {
                obj.geometry?.dispose?.();
                const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
                mats.forEach(m => m.dispose?.());
            });
            this.scene = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement?.remove();
            this.renderer = null;
        }
    }

    renderDem(data, options = {}) {
        if (!this.wrapper || !data || data.ncols < 2 || data.nrows < 2) {
            throw new Error('Invalid elevation grid dimensions.');
        }
        this.dispose();
        this.wrapper.innerHTML = '';

        const THREE = window.THREE;
        const width = Math.max(320, this.wrapper.clientWidth || 680);
        const height = Math.max(260, this.wrapper.clientHeight || 480);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050810);
        const camera = new THREE.PerspectiveCamera(48, width / height, 0.001, 10000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.wrapper.appendChild(renderer.domElement);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.maxPolarAngle = Math.PI * 0.49;
        controls.addEventListener('change', () => {
            if (!this._suppressSync && this.onCameraChange) this.onCameraChange(this);
        });

        scene.add(new THREE.AmbientLight(0xffffff, 0.74));
        const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.15);
        keyLight.position.set(-4, 8, 6);
        scene.add(keyLight);
        scene.add(new THREE.HemisphereLight(0x9bb8e8, 0x252b38, 0.42));

        const bbox = data.bbox || {};
        const bodyKey = ['Earth', 'Moon', 'Mars'].find(
            k => k.toLowerCase() === String(data.body || 'moon').toLowerCase()
        ) || 'Moon';
        const spanKm = computeRegionSpanKm(
            Number.isFinite(bbox.north) && Number.isFinite(bbox.south) && Number.isFinite(bbox.west) && Number.isFinite(bbox.east)
                ? bbox
                : {
                    west: Number(data.xllcorner ?? -5),
                    south: Number(data.yllcorner ?? -5),
                    east: Number(data.xllcorner ?? -5) + data.ncols * Number(data.cellsizeX || data.cellsize || 0.25),
                    north: Number(data.yllcorner ?? -5) + data.nrows * Number(data.cellsizeY || data.cellsize || 0.25),
                },
            bodyKey
        );
        const widthKm = Math.max(0.5, Number(options.widthKm) || spanKm.widthKm || 100);
        const heightKm = Math.max(0.5, Number(options.heightKm) || spanKm.heightKm || 100);
        const maxHorizontalKm = Math.max(widthKm, heightKm);
        const groundAspect = Math.max(0.125, Math.min(8, widthKm / Math.max(0.5, heightKm)));

        let planeWidth = groundAspect >= 1 ? 10 : 10 * groundAspect;
        let planeHeight = groundAspect >= 1 ? 10 / groundAspect : 10;
        if (options.scaleMode === 'physical' && options.scaleContext) {
            const refSpanKm = Math.max(0.001, Number(options.scaleContext.maxSpanKm) || maxHorizontalKm);
            // Both viewports use the same horizontal world-units-per-kilometre ratio.
            // Do not clamp each plane independently: that would destroy scale parity.
            const sharedWorldUnitsPerKm = 12 / refSpanKm;
            planeWidth = Math.max(0.001, widthKm * sharedWorldUnitsPerKm);
            planeHeight = Math.max(0.001, heightKm * sharedWorldUnitsPerKm);
        }

        const worldUnitsPerKm = Math.max(planeWidth / widthKm, planeHeight / heightKm);
        const minElev = Number(data.minElev);
        const maxElev = Number(data.maxElev);
        const elevRangeM = Math.max(1e-6, maxElev - minElev);
        const reliefKm = elevRangeM / 1000;
        // 1:1 physical vertical height in world units (clamped to [0.18, 3.2] so regional relief is neither flat-lined nor spiked)
        const baseHeightWorld = Math.max(0.18, Math.min(3.2, reliefKm * worldUnitsPerKm * 4.0));

        const positions = new Float32Array(data.ncols * data.nrows * 3);
        const colors = new Float32Array(data.ncols * data.nrows * 3);
        const uvs = new Float32Array(data.ncols * data.nrows * 2);
        const indices = new Uint32Array((data.ncols - 1) * (data.nrows - 1) * 6);
        let indexOffset = 0;
        const displayMode = options.displayMode || options.colorMap || 'heatmap';
        const customStops = options.customStops || this.customStops;
        const exaggeration = Math.max(0.5, Number(options.exaggeration) || 1.0);
        const valid = new Uint8Array(data.ncols * data.nrows);

        for (let row = 0; row < data.nrows; row++) {
            for (let col = 0; col < data.ncols; col++) {
                const i = row * data.ncols + col;
                const raw = Number(data.values[i]);
                const isValid = Number.isFinite(raw) && raw !== Number(data.nodata);
                valid[i] = isValid ? 1 : 0;
                const x = -planeWidth / 2 + (col / (data.ncols - 1)) * planeWidth;
                const z = -planeHeight / 2 + (row / (data.nrows - 1)) * planeHeight;
                const normalized = isValid ? Math.max(0, Math.min(1, (raw - minElev) / elevRangeM)) : 0;
                positions[i * 3] = x;
                positions[i * 3 + 1] = normalized * baseHeightWorld;
                positions[i * 3 + 2] = z;
                const rgb = TextureManager.getColorFromMap(
                    isValid ? normalized : 0,
                    displayMode === 'satellite' ? 'grayscale' : displayMode,
                    data.body,
                    customStops
                );
                colors[i * 3] = rgb[0];
                colors[i * 3 + 1] = rgb[1];
                colors[i * 3 + 2] = rgb[2];
                uvs[i * 2] = col / (data.ncols - 1);
                uvs[i * 2 + 1] = 1 - row / (data.nrows - 1);
            }
        }

        for (let row = 0; row < data.nrows - 1; row++) {
            for (let col = 0; col < data.ncols - 1; col++) {
                const a = row * data.ncols + col;
                const b = a + 1;
                const c = a + data.ncols;
                const d = c + 1;
                if (valid[a] && valid[b] && valid[c]) {
                    indices[indexOffset++] = a; indices[indexOffset++] = c; indices[indexOffset++] = b;
                }
                if (valid[b] && valid[c] && valid[d]) {
                    indices[indexOffset++] = b; indices[indexOffset++] = c; indices[indexOffset++] = d;
                }
            }
        }
        if (indexOffset < 6) {
            throw new Error('Insufficient adjacent valid elevation samples to build a 3D mesh.');
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexOffset), 1));
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            map: options.surfaceTexture || null,
            roughness: 0.92,
            metalness: 0.02,
            wireframe: Boolean(options.wireframe),
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        const grid = new THREE.GridHelper(Math.max(planeWidth, planeHeight) * 1.15, 20, 0x26354a, 0x172235);
        grid.position.y = -0.025;
        scene.add(grid);

        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.controls = controls;
        this.mesh = mesh;
        this.grid = grid;
        this.data = data;
        this.physicalSpanKm = { widthKm, heightKm, reliefM: elevRangeM };
        this.worldUnitsPerKm = worldUnitsPerKm;
        this.baseHeightWorld = baseHeightWorld;
        this.surfaceTexture = options.surfaceTexture || null;
        this.customStops = customStops;
        this.displayMode = displayMode;
        this.exaggeration = exaggeration;
        this.mesh.scale.y = exaggeration;
        this.mesh.updateMatrixWorld(true);
        if (options.displayMode) {
            this.setDisplayMode(options.displayMode, customStops);
        } else {
            this.setSurfaceMode(options.surfaceMode || 'elevation');
        }

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        renderer.domElement.addEventListener('mousemove', event => {
            const now = performance.now();
            if (now - this._lastRaycastAt < 50) return;
            this._lastRaycastAt = now;
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const hit = raycaster.intersectObject(mesh)[0];
            if (!hit) return;
            const gx = Math.max(0, Math.min(1, (hit.point.x + planeWidth / 2) / planeWidth));
            const gz = Math.max(0, Math.min(1, (hit.point.z + planeHeight / 2) / planeHeight));
            const col = Math.min(data.ncols - 1, Math.round(gx * (data.ncols - 1)));
            const row = Math.min(data.nrows - 1, Math.round(gz * (data.nrows - 1)));
            const elevation = Number(data.values[row * data.ncols + col]);
            if (!Number.isFinite(elevation)) return;
            // Sample against the exact geographic extent used to build this mesh.
            // Do not prefer xllcorner here: some source grids retain an unwrapped
            // raster origin while the cropped DEM bbox has already been normalized.
            const west = Number.isFinite(Number(bbox.west)) ? Number(bbox.west) : Number(data.xllcorner ?? -180);
            const east = Number.isFinite(Number(bbox.east)) ? Number(bbox.east) : west + Number(data.lonSpan || ((data.ncols - 1) * Number(data.cellsizeX || data.cellsize || 1)));
            const north = Number.isFinite(Number(bbox.north)) ? Number(bbox.north) : Number(data.yllcorner) + (data.nrows - 1) * Number(data.cellsizeY || data.cellsize || 1);
            const south = Number.isFinite(Number(bbox.south)) ? Number(bbox.south) : north - (data.nrows - 1) * Number(data.cellsizeY || data.cellsize || 1);
            const lonSpan = Number(data.lonSpan) || (east >= west ? east - west : east + 360 - west);
            const lon = normalizeLon180(west + (col / Math.max(1, data.ncols - 1)) * lonSpan);
            const lat = north - (row / Math.max(1, data.nrows - 1)) * (north - south);
            options.onCursorSample?.({ elevation, lat, lon, col, row });
        });

        const animate = () => {
            if (this.renderer !== renderer) return;
            this.animationId = requestAnimationFrame(animate);
            if (!this.wrapper || this.wrapper.clientWidth <= 0 || this.wrapper.clientHeight <= 0) return;
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        this.resizeObserver = new ResizeObserver(() => {
            const w = Math.max(1, this.wrapper.clientWidth);
            const h = Math.max(1, this.wrapper.clientHeight);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });
        this.resizeObserver.observe(this.wrapper);
        this.fitCamera();
    }

    updateExaggeration(exaggeration) {
        if (!this.mesh || !this.data) return;
        const next = Math.max(0.5, Math.min(20, Number(exaggeration) || 1));
        this.exaggeration = next;
        this.mesh.scale.y = next;
        this.mesh.updateMatrixWorld(true);
    }

    setSurfaceTexture(texture) {
        this.surfaceTexture = texture || null;
        if (this.displayMode === 'satellite' || this.surfaceMode === 'imagery' || this.surfaceMode === 'hybrid') {
            if (this.mesh?.material) {
                this.mesh.material.map = this.surfaceTexture;
                this.mesh.material.needsUpdate = true;
            }
        }
    }

    setDisplayMode(mode, customStops = null) {
        if (!this.mesh || !this.data) return;
        if (customStops) this.customStops = customStops;
        this.displayMode = mode || 'heatmap';
        const material = this.mesh.material;

        if (this.displayMode === 'satellite') {
            this.surfaceMode = 'imagery';
            if (this.surfaceTexture) {
                material.map = this.surfaceTexture;
                material.color.setHex(0xffffff);
                material.vertexColors = false;
            } else {
                // Fallback to raw grayscale height until orbital imagery texture finishes loading
                this.updateColorMap('grayscale', this.customStops);
                material.map = null;
                material.vertexColors = true;
            }
            material.roughness = 0.9;
            material.needsUpdate = true;
            return;
        }

        this.surfaceMode = 'elevation';
        material.map = null;
        material.color.setHex(0xffffff);
        material.vertexColors = true;
        material.roughness = this.displayMode === 'clay' ? 0.85 : 0.92;
        this.updateColorMap(this.displayMode, this.customStops);
        material.needsUpdate = true;
    }

    updateColorMap(colorMap, customStops = null) {
        if (!this.mesh || !this.data) return;
        if (customStops) this.customStops = customStops;
        const colors = this.mesh.geometry.attributes.color.array;
        const elevRange = Math.max(1e-6, this.data.maxElev - this.data.minElev);
        for (let i = 0; i < this.data.values.length && i * 3 + 2 < colors.length; i++) {
            const raw = Number(this.data.values[i]);
            const elev = Number.isFinite(raw) && raw !== Number(this.data.nodata) ? raw : this.data.minElev;
            const t = Math.max(0, Math.min(1, (elev - this.data.minElev) / elevRange));
            const rgb = TextureManager.getColorFromMap(t, colorMap, this.data.body, this.customStops);
            colors[i * 3] = rgb[0];
            colors[i * 3 + 1] = rgb[1];
            colors[i * 3 + 2] = rgb[2];
        }
        this.mesh.geometry.attributes.color.needsUpdate = true;
        if (this.surfaceMode === 'imagery' && this.surfaceTexture) this.mesh.material.vertexColors = false;
        else this.mesh.material.vertexColors = true;
        this.mesh.material.needsUpdate = true;
    }

    setWireframe(enabled) {
        if (this.mesh?.material) this.mesh.material.wireframe = Boolean(enabled);
    }

    setSurfaceMode(mode) {
        if (!this.mesh?.material) return;
        this.surfaceMode = ['hybrid', 'imagery', 'elevation'].includes(mode) ? mode : 'elevation';
        const material = this.mesh.material;
        if (this.surfaceMode === 'imagery') {
            material.map = this.surfaceTexture || null;
            material.color.setHex(0xffffff);
            material.vertexColors = !this.surfaceTexture;
        } else if (this.surfaceMode === 'hybrid') {
            material.map = this.surfaceTexture || null;
            material.color.setHex(0xffffff);
            material.vertexColors = true;
        } else {
            material.map = null;
            material.color.setHex(0xffffff);
            material.vertexColors = true;
        }
        material.needsUpdate = true;
    }

    getCameraSphericalState() {
        if (!this.camera || !this.controls) return null;
        const THREE = window.THREE;
        const center = this.boundingCenter || new THREE.Vector3(0, 0, 0);
        const refRadius = Math.max(0.01, this.boundingRadius || 5);
        const offset = this.camera.position.clone().sub(this.controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        const targetOffset = this.controls.target.clone().sub(center).divideScalar(refRadius);
        return {
            normalizedRadius: spherical.radius / refRadius,
            phi: spherical.phi,
            theta: spherical.theta,
            normalizedTargetOffset: targetOffset.toArray(),
            radius: spherical.radius,
            target: this.controls.target.toArray(),
        };
    }

    applyCameraSphericalState(state) {
        if (!state || !this.camera || !this.controls) return;
        const THREE = window.THREE;
        const previousSuppress = this._suppressSync;
        this._suppressSync = true;
        try {
            const center = this.boundingCenter || new THREE.Vector3(0, 0, 0);
            const refRadius = Math.max(0.01, this.boundingRadius || 5);
            const target = Array.isArray(state.normalizedTargetOffset)
                ? center.clone().add(new THREE.Vector3(...state.normalizedTargetOffset).multiplyScalar(refRadius))
                : new THREE.Vector3(...(state.target || [0, 0, 0]));
            const radius = Number.isFinite(state.normalizedRadius)
                ? Math.max(0.01, state.normalizedRadius * refRadius)
                : Math.max(0.01, Number(state.radius) || 10);
            const spherical = new THREE.Spherical(radius, state.phi, state.theta);
            this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));
            this.controls.target.copy(target);
            this.controls.update();
        } finally {
            this._suppressSync = previousSuppress;
        }
    }

    fitCamera(notifySync = false) {
        if (!this.camera || !this.controls || !this.scene) return;
        const THREE = window.THREE;
        const box = new THREE.Box3().setFromObject(this.mesh || this.scene);
        if (box.isEmpty()) return;
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 0.01);
        this.boundingRadius = radius;
        this.boundingCenter = sphere.center.clone();
        const fov = (this.camera.fov * Math.PI) / 180;
        const distance = (radius / Math.sin(fov / 2)) * 1.25;
        const previousSuppress = this._suppressSync;
        this._suppressSync = !notifySync;
        try {
            this.controls.target.copy(sphere.center);
            this.camera.position.copy(sphere.center).add(
                new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(distance)
            );
            this.camera.near = Math.max(radius / 1000, 0.001);
            this.camera.far = Math.max(distance + radius * 20, 100);
            this.camera.updateProjectionMatrix();
            this.controls.update();
        } finally {
            this._suppressSync = previousSuppress;
        }
    }

    setCameraView(view, notifySync = false) {
        if (!this.camera || !this.controls) return;
        const THREE = window.THREE;
        const box = new THREE.Box3().setFromObject(this.mesh || this.scene);
        const sphere = box.isEmpty() ? null : box.getBoundingSphere(new THREE.Sphere());
        const center = sphere ? sphere.center : (this.boundingCenter || new THREE.Vector3(0, 0, 0));
        const radius = Math.max(sphere ? sphere.radius : (this.boundingRadius || 5), 0.01);
        this.boundingRadius = radius;
        this.boundingCenter = center.clone();
        const fov = (this.camera.fov * Math.PI) / 180;
        const distance = (radius / Math.sin(fov / 2)) * 1.25;
        const directions = {
            reset: [0, 0.65, 1],
            nadir: [0, 1, 0.001],
            oblique: [0, 0.7, 0.8],
            north: [0, 0.45, -1],
            south: [0, 0.45, 1],
            east: [1, 0.45, 0],
            west: [-1, 0.45, 0],
        };
        const direction = new THREE.Vector3(...(directions[view] || directions.reset)).normalize();
        const previousSuppress = this._suppressSync;
        this._suppressSync = !notifySync;
        try {
            this.controls.target.copy(center);
            this.camera.position.copy(center).add(direction.multiplyScalar(distance));
            this.camera.near = Math.max(radius / 1000, 0.001);
            this.camera.far = Math.max(distance + radius * 20, 100);
            this.camera.updateProjectionMatrix();
            this.controls.update();
        } finally {
            this._suppressSync = previousSuppress;
        }
    }
}

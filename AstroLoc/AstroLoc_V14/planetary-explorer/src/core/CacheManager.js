// src/core/CacheManager.js
// Persistent workspace state (localStorage) + IndexedDB binary raster cache + in-memory cache.

const STORAGE_KEY = 'planetary_explorer_v2_state';
const IDB_NAME = 'PlanetaryExplorerV2Cache';
const IDB_STORE = 'rasters';

class CacheManagerService {
    constructor() {
        this.memory = new Map();
        this.maxMemoryEntries = 36;
        this.dbPromise = null;
    }

    getMemory(key) {
        if (!this.memory.has(key)) return null;
        const value = this.memory.get(key);
        this.memory.delete(key);
        this.memory.set(key, value);
        return value;
    }

    setMemory(key, value) {
        if (this.memory.has(key)) this.memory.delete(key);
        else if (this.memory.size >= this.maxMemoryEntries) {
            const oldestKey = this.memory.keys().next().value;
            if (oldestKey !== undefined) this.memory.delete(oldestKey);
        }
        this.memory.set(key, value);
        return value;
    }

    saveWorkspaceState(partialState) {
        try {
            const current = this.loadWorkspaceState();
            const merged = { ...current, ...partialState, updatedAt: new Date().toISOString() };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            return merged;
        } catch {
            return partialState;
        }
    }

    loadWorkspaceState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    _openDB() {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) return resolve(null);
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
        return this.dbPromise;
    }

    async getRaster(key) {
        if (this.memory.has(key)) return this.getMemory(key);
        const db = await this._openDB();
        if (!db) return null;
        return new Promise(resolve => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => {
                if (req.result) this.setMemory(key, req.result);
                resolve(req.result || null);
            };
            req.onerror = () => resolve(null);
        });
    }

    async setRaster(key, value) {
        this.setMemory(key, value);
        const db = await this._openDB();
        if (!db) return value;
        return new Promise(resolve => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(value, key);
            tx.oncomplete = () => resolve(value);
            tx.onerror = () => resolve(value);
        });
    }
}

export const CacheManager = new CacheManagerService();

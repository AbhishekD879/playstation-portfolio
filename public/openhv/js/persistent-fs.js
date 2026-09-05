window.PersistentFS = (() => {
    const mountPoints = [
        '/openra-support/Saves',
        '/openra-support/Replays'
    ];
    const dbName = 'openra-web-storage';
    const storeName = 'files';
    const dirMode = 0x4000;

    let initialized = false;
    let syncInFlight = null;
    let autoSyncTimer = null;
    let nativeMounted = false;

    function runtimeFS() {
        if (typeof Module !== 'undefined' && Module.FS)
            return Module.FS;

        if (typeof FS !== 'undefined')
            return FS;

        return null;
    }

    function idbfsBackend() {
        if (typeof Module !== 'undefined' && Module.IDBFS)
            return Module.IDBFS;

        if (typeof IDBFS !== 'undefined')
            return IDBFS;

        const fs = runtimeFS();
        if (fs && fs.filesystems && fs.filesystems.IDBFS)
            return fs.filesystems.IDBFS;

        return null;
    }

    function canUseNativeIdbfs() {
        const fs = runtimeFS();
        const idbfs = idbfsBackend();
        return !!fs
            && !!idbfs
            && typeof fs.mount === 'function'
            && typeof fs.syncfs === 'function';
    }

    function canUseCustomIndexedDb() {
        return !!runtimeFS() && typeof indexedDB !== 'undefined';
    }

    function supportsPersistence() {
        return canUseNativeIdbfs() || canUseCustomIndexedDb();
    }

    function ensureDir(path) {
        const fs = runtimeFS();
        if (!fs)
            throw new Error('Filesystem is unavailable');

        const parts = path.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
            current += '/' + part;
            if (fs.analyzePath && fs.analyzePath(current).exists)
                continue;

            fs.mkdir(current);
        }
    }

    function mountNativeIdbfs() {
        if (nativeMounted)
            return;

        const fs = runtimeFS();
        const idbfs = idbfsBackend();
        for (const path of mountPoints) {
            ensureDir(path);
            try {
                fs.mount(idbfs, {}, path);
            } catch (error) {
                if (!String(error).includes('already mounted'))
                    throw error;
            }
        }

        nativeMounted = true;
    }

    function openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(storeName))
                    db.createObjectStore(storeName, { keyPath: 'path' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function transact(mode, action) {
        return openDb().then((db) => new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            let result;

            transaction.oncomplete = () => {
                db.close();
                resolve(result);
            };
            transaction.onerror = () => {
                db.close();
                reject(transaction.error);
            };

            result = action(store);
        }));
    }

    function requestResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function isDirectory(mode) {
        const fs = runtimeFS();
        if (fs && typeof fs.isDir === 'function')
            return fs.isDir(mode);

        return (mode & dirMode) === dirMode;
    }

    function joinPath(parent, child) {
        return parent === '/' ? `/${child}` : `${parent}/${child}`;
    }

    function collectFiles(path, files) {
        const fs = runtimeFS();
        ensureDir(path);
        const entries = fs.readdir(path).filter((name) => name !== '.' && name !== '..');

        for (const entry of entries) {
            const fullPath = joinPath(path, entry);
            const stat = fs.stat(fullPath);
            if (isDirectory(stat.mode))
                collectFiles(fullPath, files);
            else {
                const data = fs.readFile(fullPath, { encoding: 'binary' });
                const copy = new Uint8Array(data.length);
                copy.set(data);
                files.push({
                    path: fullPath,
                    data: copy.buffer,
                });
            }
        }
    }

    async function customSyncToIndexedDb() {
        const files = [];
        for (const path of mountPoints)
            collectFiles(path, files);

        await transact('readwrite', (store) => {
            store.clear();
            for (const file of files)
                store.put(file);
        });

        return true;
    }

    async function customSyncFromIndexedDb() {
        const fs = runtimeFS();
        const files = await transact('readonly', (store) => requestResult(store.getAll()));

        for (const mountPoint of mountPoints)
            ensureDir(mountPoint);

        for (const file of files) {
            const parent = file.path.split('/').slice(0, -1).join('/') || '/';
            ensureDir(parent);
            const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
            fs.writeFile(file.path, data, { encoding: 'binary' });
        }

        return true;
    }

    function sync(populate) {
        if (!supportsPersistence())
            return Promise.resolve(false);

        if (syncInFlight)
            return syncInFlight;

        if (canUseNativeIdbfs()) {
            mountNativeIdbfs();
            const fs = runtimeFS();
            syncInFlight = new Promise((resolve, reject) => {
                fs.syncfs(!!populate, (error) => {
                    syncInFlight = null;
                    if (error)
                        reject(error);
                    else
                        resolve(true);
                });
            });
            return syncInFlight;
        }

        syncInFlight = (populate ? customSyncFromIndexedDb() : customSyncToIndexedDb())
            .finally(() => { syncInFlight = null; });
        return syncInFlight;
    }

    async function init() {
        if (initialized)
            return supportsPersistence();

        initialized = true;

        if (!supportsPersistence())
            return false;

        await sync(true);

        if (autoSyncTimer === null) {
            autoSyncTimer = window.setInterval(() => {
                sync(false).catch((error) => console.warn('[PersistentFS] autosync failed', error));
            }, 5000);
        }

        const flush = () => {
            if (!supportsPersistence())
                return;

            sync(false).catch((error) => console.warn('[PersistentFS] flush failed', error));
        };

        window.addEventListener('pagehide', flush);
        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden)
                flush();
        });

        return true;
    }

    return {
        init,
        supportsPersistence,
        syncFromIndexedDb: () => sync(true),
        syncToIndexedDb: () => sync(false),
        mountPoints: [...mountPoints]
    };
})();

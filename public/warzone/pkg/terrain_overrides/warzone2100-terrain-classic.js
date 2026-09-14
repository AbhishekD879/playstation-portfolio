
  var Module = typeof Module != 'undefined' ? Module : {};

  Module['expectedDataFileDownloads'] ??= 0;
  Module['expectedDataFileDownloads']++;
  (() => {
    // Do not attempt to redownload the virtual filesystem data when in a pthread or a Wasm Worker context.
    var isPthread = typeof ENVIRONMENT_IS_PTHREAD != 'undefined' && ENVIRONMENT_IS_PTHREAD;
    var isWasmWorker = typeof ENVIRONMENT_IS_WASM_WORKER != 'undefined' && ENVIRONMENT_IS_WASM_WORKER;
    if (isPthread || isWasmWorker) return;
    function loadPackage(metadata) {

      var PACKAGE_PATH = '';
      if (typeof window === 'object') {
        PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/');
      } else if (typeof process === 'undefined' && typeof location !== 'undefined') {
        // web worker
        PACKAGE_PATH = encodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')) + '/');
      }
      var PACKAGE_NAME = 'warzone2100-terrain-classic.data';
      var REMOTE_PACKAGE_BASE = 'warzone2100-terrain-classic.data';
      var REMOTE_PACKAGE_NAME = Module['locateFile'] ? Module['locateFile'](REMOTE_PACKAGE_BASE, '') : REMOTE_PACKAGE_BASE;
var REMOTE_PACKAGE_SIZE = metadata['remote_package_size'];

      function fetchRemotePackage(packageName, packageSize, callback, errback) {
        
        Module['dataFileDownloads'] ??= {};
        fetch(packageName)
          .catch((cause) => Promise.reject(new Error(`Network Error: ${packageName}`, {cause}))) // If fetch fails, rewrite the error to include the failing URL & the cause.
          .then((response) => {
            if (!response.ok) {
              return Promise.reject(new Error(`${response.status}: ${response.url}`));
            }

            if (!response.body && response.arrayBuffer) { // If we're using the polyfill, readers won't be available...
              return response.arrayBuffer().then(callback);
            }

            const reader = response.body.getReader();
            const iterate = () => reader.read().then(handleChunk).catch((cause) => {
              return Promise.reject(new Error(`Unexpected error while handling : ${response.url} ${cause}`, {cause}));
            });

            const chunks = [];
            const headers = response.headers;
            const total = Number(headers.get('Content-Length') ?? packageSize);
            let loaded = 0;

            const handleChunk = ({done, value}) => {
              if (!done) {
                chunks.push(value);
                loaded += value.length;
                Module['dataFileDownloads'][packageName] = {loaded, total};

                let totalLoaded = 0;
                let totalSize = 0;

                for (const download of Object.values(Module['dataFileDownloads'])) {
                  totalLoaded += download.loaded;
                  totalSize += download.total;
                }

                Module['setStatus']?.(`Downloading data... (${totalLoaded}/${totalSize})`);
                return iterate();
              } else {
                const packageData = new Uint8Array(chunks.map((c) => c.length).reduce((a, b) => a + b, 0));
                let offset = 0;
                for (const chunk of chunks) {
                  packageData.set(chunk, offset);
                  offset += chunk.length;
                }
                callback(packageData.buffer);
              }
            };

            Module['setStatus']?.('Downloading data...');
            return iterate();
          });
      };

      function handleError(error) {
        console.error('package error:', error);
      };

    function runWithFS(Module) {

      function assert(check, msg) {
        if (!check) throw msg + new Error().stack;
      }
Module['FS_createPath']("/", "data", true, true);
Module['FS_createPath']("/data", "terrain_overrides", true, true);
Module['FS_createPath']("/data/terrain_overrides", "classic", true, true);
Module['FS_createPath']("/data/terrain_overrides/classic", "texpages", true, true);
Module['FS_createPath']("/data/terrain_overrides/classic/texpages", "tertilesc1hw-128", true, true);
Module['FS_createPath']("/data/terrain_overrides/classic/texpages", "tertilesc2hw-128", true, true);
Module['FS_createPath']("/data/terrain_overrides/classic/texpages", "tertilesc3hw-128", true, true);
Module['FS_createPath']("/data/terrain_overrides/classic", "tileset", true, true);

      /** @constructor */
      function DataRequest(start, end, audio) {
        this.start = start;
        this.end = end;
        this.audio = audio;
      }
      DataRequest.prototype = {
        requests: {},
        open: function(mode, name) {
          this.name = name;
          this.requests[name] = this;
          Module['addRunDependency'](`fp ${this.name}`);
        },
        send: function() {},
        onload: function() {
          var byteArray = this.byteArray.subarray(this.start, this.end);
          this.finish(byteArray);
        },
        finish: function(byteArray) {
          var that = this;
          // canOwn this data in the filesystem, it is a slide into the heap that will never change
          Module['FS_createDataFile'](this.name, null, byteArray, true, true, true);
          Module['removeRunDependency'](`fp ${that.name}`);
          this.requests[this.name] = null;
        }
      };

      var files = metadata['files'];
      for (var i = 0; i < files.length; ++i) {
        new DataRequest(files[i]['start'], files[i]['end'], files[i]['audio'] || 0).open('GET', files[i]['filename']);
      }

        var PACKAGE_UUID = metadata['package_uuid'];
        var IDB_RO = "readonly";
        var IDB_RW = "readwrite";
        var DB_NAME = "EM_PRELOAD_TERRAIN_CLASSIC_CACHE";
        var DB_VERSION = 1;
        var METADATA_STORE_NAME = 'METADATA';
        var PACKAGE_STORE_NAME = 'PACKAGES';
        function openDatabase(callback, errback) {
          var indexedDB;
          if (typeof window === 'object') {
            indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
          } else if (typeof location !== 'undefined') {
            // worker
            indexedDB = self.indexedDB;
          } else {
            throw 'using IndexedDB to cache data can only be done on a web page or in a web worker';
          }
          try {
            var openRequest = indexedDB.open(DB_NAME, DB_VERSION);
          } catch (e) {
            return errback(e);
          }
          openRequest.onupgradeneeded = (event) => {
            var db = /** @type {IDBDatabase} */ (event.target.result);

            if (db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
              db.deleteObjectStore(PACKAGE_STORE_NAME);
            }
            var packages = db.createObjectStore(PACKAGE_STORE_NAME);

            if (db.objectStoreNames.contains(METADATA_STORE_NAME)) {
              db.deleteObjectStore(METADATA_STORE_NAME);
            }
            var metadata = db.createObjectStore(METADATA_STORE_NAME);
          };
          openRequest.onsuccess = (event) => {
            var db = /** @type {IDBDatabase} */ (event.target.result);
            callback(db);
          };
          openRequest.onerror = (error) => errback(error);
        };

        // This is needed as chromium has a limit on per-entry files in IndexedDB
        // https://cs.chromium.org/chromium/src/content/renderer/indexed_db/webidbdatabase_impl.cc?type=cs&sq=package:chromium&g=0&l=177
        // https://cs.chromium.org/chromium/src/out/Debug/gen/third_party/blink/public/mojom/indexeddb/indexeddb.mojom.h?type=cs&sq=package:chromium&g=0&l=60
        // We set the chunk size to 64MB to stay well-below the limit
        var CHUNK_SIZE = 64 * 1024 * 1024;

        function cacheRemotePackage(
          db,
          packageName,
          packageData,
          packageMeta,
          callback,
          errback
        ) {
          var transactionPackages = db.transaction([PACKAGE_STORE_NAME], IDB_RW);
          var packages = transactionPackages.objectStore(PACKAGE_STORE_NAME);
          var chunkSliceStart = 0;
          var nextChunkSliceStart = 0;
          var chunkCount = Math.ceil(packageData.byteLength / CHUNK_SIZE);
          var finishedChunks = 0;
          for (var chunkId = 0; chunkId < chunkCount; chunkId++) {
            nextChunkSliceStart += CHUNK_SIZE;
            var putPackageRequest = packages.put(
              packageData.slice(chunkSliceStart, nextChunkSliceStart),
              `package/${packageName}/${chunkId}`
            );
            chunkSliceStart = nextChunkSliceStart;
            putPackageRequest.onsuccess = (event) => {
              finishedChunks++;
              if (finishedChunks == chunkCount) {
                var transaction_metadata = db.transaction(
                  [METADATA_STORE_NAME],
                  IDB_RW
                );
                var metadata = transaction_metadata.objectStore(METADATA_STORE_NAME);
                var putMetadataRequest = metadata.put(
                  {
                    'uuid': packageMeta.uuid,
                    'chunkCount': chunkCount
                  },
                  `metadata/${packageName}`
                );
                putMetadataRequest.onsuccess = (event) =>  callback(packageData);
                putMetadataRequest.onerror = (error) => errback(error);
              }
            };
            putPackageRequest.onerror = (error) => errback(error);
          }
        }

        /* Check if there's a cached package, and if so whether it's the latest available */
        function checkCachedPackage(db, packageName, callback, errback) {
          var transaction = db.transaction([METADATA_STORE_NAME], IDB_RO);
          var metadata = transaction.objectStore(METADATA_STORE_NAME);
          var getRequest = metadata.get(`metadata/${packageName}`);
          getRequest.onsuccess = (event) => {
            var result = event.target.result;
            if (!result) {
              return callback(false, null);
            } else {
              return callback(PACKAGE_UUID === result['uuid'], result);
            }
          };
          getRequest.onerror = (error) => errback(error);
        }

        function fetchCachedPackage(db, packageName, metadata, callback, errback) {
          var transaction = db.transaction([PACKAGE_STORE_NAME], IDB_RO);
          var packages = transaction.objectStore(PACKAGE_STORE_NAME);

          var chunksDone = 0;
          var totalSize = 0;
          var chunkCount = metadata['chunkCount'];
          var chunks = new Array(chunkCount);

          for (var chunkId = 0; chunkId < chunkCount; chunkId++) {
            var getRequest = packages.get(`package/${packageName}/${chunkId}`);
            getRequest.onsuccess = (event) => {
              if (!event.target.result) {
                errback(new Error(`CachedPackageNotFound for: ${packageName}`));
                return;
              }
              // If there's only 1 chunk, there's nothing to concatenate it with so we can just return it now
              if (chunkCount == 1) {
                callback(event.target.result);
              } else {
                chunksDone++;
                totalSize += event.target.result.byteLength;
                chunks.push(event.target.result);
                if (chunksDone == chunkCount) {
                  if (chunksDone == 1) {
                    callback(event.target.result);
                  } else {
                    var tempTyped = new Uint8Array(totalSize);
                    var byteOffset = 0;
                    for (var chunkId in chunks) {
                      var buffer = chunks[chunkId];
                      tempTyped.set(new Uint8Array(buffer), byteOffset);
                      byteOffset += buffer.byteLength;
                      buffer = undefined;
                    }
                    chunks = undefined;
                    callback(tempTyped.buffer);
                    tempTyped = undefined;
                  }
                }
              }
            };
            getRequest.onerror = (error) => errback(error);
          }
        }

      function processPackageData(arrayBuffer) {
        assert(arrayBuffer, 'Loading data file failed.');
        assert(arrayBuffer.constructor.name === ArrayBuffer.name, 'bad input to processPackageData');
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;
        // Reuse the bytearray from the XHR as the source for file reads.
          DataRequest.prototype.byteArray = byteArray;
          var files = metadata['files'];
          for (var i = 0; i < files.length; ++i) {
            DataRequest.prototype.requests[files[i].filename].onload();
          }          Module['removeRunDependency']('datafile_warzone2100-terrain-classic.data');

      };
      Module['addRunDependency']('datafile_warzone2100-terrain-classic.data');

      Module['preloadResults'] ??= {};

        function preloadFallback(error) {
          console.error(error);
          console.error('falling back to default preload behavior');
          fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE, processPackageData, handleError);
        };

        openDatabase(
          (db) => checkCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME,
              (useCached, metadata) => {
                Module['preloadResults'][PACKAGE_NAME] = {fromCache: useCached};
                if (useCached) {
                  fetchCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME, metadata, processPackageData, preloadFallback);
                } else {
                  fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE,
                    (packageData) => {
                      cacheRemotePackage(db, PACKAGE_PATH + PACKAGE_NAME, packageData, {uuid:PACKAGE_UUID}, processPackageData,
                        (error) => {
                          console.error(error);
                          processPackageData(packageData);
                        });
                    }
                  , preloadFallback);
                }
              }, preloadFallback)
        , preloadFallback);

        Module['setStatus']?.('Downloading...');

    }
    if (Module['calledRun']) {
      runWithFS(Module);
    } else {
      (Module['preRun'] ??= []).push(runWithFS); // FS is not initialized yet, wait for it
    }

    }
    loadPackage({"files": [{"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-00.png", "start": 0, "end": 3501}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-01.png", "start": 3501, "end": 6811}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-02.png", "start": 6811, "end": 10258}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-03.png", "start": 10258, "end": 13479}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-04.png", "start": 13479, "end": 16860}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-05.png", "start": 16860, "end": 20155}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-06.png", "start": 20155, "end": 23239}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-07.png", "start": 23239, "end": 26409}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-08.png", "start": 26409, "end": 29433}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-09.png", "start": 29433, "end": 32952}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-10.png", "start": 32952, "end": 36397}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-11.png", "start": 36397, "end": 39865}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-12.png", "start": 39865, "end": 43035}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-13.png", "start": 43035, "end": 46164}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-14.png", "start": 46164, "end": 48390}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-15.png", "start": 48390, "end": 51732}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-16.png", "start": 51732, "end": 52433}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-17.png", "start": 52433, "end": 53704}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-18.png", "start": 53704, "end": 57596}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-19.png", "start": 57596, "end": 60840}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-20.png", "start": 60840, "end": 65036}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-21.png", "start": 65036, "end": 69060}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-22.png", "start": 69060, "end": 72155}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-23.png", "start": 72155, "end": 74768}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-24.png", "start": 74768, "end": 77703}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-25.png", "start": 77703, "end": 80459}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-26.png", "start": 80459, "end": 83352}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-27.png", "start": 83352, "end": 87255}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-28.png", "start": 87255, "end": 90879}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-29.png", "start": 90879, "end": 94765}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-30.png", "start": 94765, "end": 96581}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-31.png", "start": 96581, "end": 98289}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-32.png", "start": 98289, "end": 100902}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-33.png", "start": 100902, "end": 101892}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-34.png", "start": 101892, "end": 105544}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-35.png", "start": 105544, "end": 109322}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-36.png", "start": 109322, "end": 112540}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-37.png", "start": 112540, "end": 115615}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-38.png", "start": 115615, "end": 119160}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-39.png", "start": 119160, "end": 122507}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-40.png", "start": 122507, "end": 126052}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-41.png", "start": 126052, "end": 130007}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-42.png", "start": 130007, "end": 133597}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-43.png", "start": 133597, "end": 137468}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-44.png", "start": 137468, "end": 141612}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-45.png", "start": 141612, "end": 145510}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-46.png", "start": 145510, "end": 149499}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-47.png", "start": 149499, "end": 153131}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-48.png", "start": 153131, "end": 157021}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-49.png", "start": 157021, "end": 160962}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-50.png", "start": 160962, "end": 164918}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-51.png", "start": 164918, "end": 168947}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-52.png", "start": 168947, "end": 172952}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-53.png", "start": 172952, "end": 176829}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-54.png", "start": 176829, "end": 180883}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-55.png", "start": 180883, "end": 185186}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-56.png", "start": 185186, "end": 189354}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-57.png", "start": 189354, "end": 192016}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-58.png", "start": 192016, "end": 195727}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-59.png", "start": 195727, "end": 198415}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-60.png", "start": 198415, "end": 202209}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-61.png", "start": 202209, "end": 206056}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-62.png", "start": 206056, "end": 209323}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-63.png", "start": 209323, "end": 212919}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-64.png", "start": 212919, "end": 216698}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-65.png", "start": 216698, "end": 220423}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-66.png", "start": 220423, "end": 224042}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-67.png", "start": 224042, "end": 227634}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-68.png", "start": 227634, "end": 231385}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-69.png", "start": 231385, "end": 235187}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-70.png", "start": 235187, "end": 238914}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-71.png", "start": 238914, "end": 242935}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-72.png", "start": 242935, "end": 246992}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-73.png", "start": 246992, "end": 251090}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-74.png", "start": 251090, "end": 255564}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-75.png", "start": 255564, "end": 259668}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-76.png", "start": 259668, "end": 263676}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw-128/tile-77.png", "start": 263676, "end": 266764}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc1hw.radar", "start": 266764, "end": 267394}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-00.png", "start": 267394, "end": 270254}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-01.png", "start": 270254, "end": 273452}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-02.png", "start": 273452, "end": 276563}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-03.png", "start": 276563, "end": 279802}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-04.png", "start": 279802, "end": 283448}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-05.png", "start": 283448, "end": 287022}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-06.png", "start": 287022, "end": 290689}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-07.png", "start": 290689, "end": 294308}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-08.png", "start": 294308, "end": 297949}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-09.png", "start": 297949, "end": 301584}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-10.png", "start": 301584, "end": 305315}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-11.png", "start": 305315, "end": 307298}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-12.png", "start": 307298, "end": 309091}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-13.png", "start": 309091, "end": 311899}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-14.png", "start": 311899, "end": 314570}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-15.png", "start": 314570, "end": 317840}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-16.png", "start": 317840, "end": 319086}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-17.png", "start": 319086, "end": 320357}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-18.png", "start": 320357, "end": 321367}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-19.png", "start": 321367, "end": 324311}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-20.png", "start": 324311, "end": 328165}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-21.png", "start": 328165, "end": 331971}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-22.png", "start": 331971, "end": 335818}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-23.png", "start": 335818, "end": 338563}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-24.png", "start": 338563, "end": 341225}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-25.png", "start": 341225, "end": 342595}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-26.png", "start": 342595, "end": 346437}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-27.png", "start": 346437, "end": 350314}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-28.png", "start": 350314, "end": 353443}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-29.png", "start": 353443, "end": 357435}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-30.png", "start": 357435, "end": 360536}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-31.png", "start": 360536, "end": 364453}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-32.png", "start": 364453, "end": 367612}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-33.png", "start": 367612, "end": 371291}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-34.png", "start": 371291, "end": 375282}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-35.png", "start": 375282, "end": 378674}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-36.png", "start": 378674, "end": 382764}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-37.png", "start": 382764, "end": 386572}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-38.png", "start": 386572, "end": 390534}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-39.png", "start": 390534, "end": 394433}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-40.png", "start": 394433, "end": 396498}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-41.png", "start": 396498, "end": 399302}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-42.png", "start": 399302, "end": 401341}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-43.png", "start": 401341, "end": 404670}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-44.png", "start": 404670, "end": 408238}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-45.png", "start": 408238, "end": 411264}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-46.png", "start": 411264, "end": 413399}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-47.png", "start": 413399, "end": 416617}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-48.png", "start": 416617, "end": 420401}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-49.png", "start": 420401, "end": 422531}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-50.png", "start": 422531, "end": 426082}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-51.png", "start": 426082, "end": 428521}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-52.png", "start": 428521, "end": 432313}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-53.png", "start": 432313, "end": 435404}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-54.png", "start": 435404, "end": 438592}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-55.png", "start": 438592, "end": 441861}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-56.png", "start": 441861, "end": 445090}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-57.png", "start": 445090, "end": 447727}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-58.png", "start": 447727, "end": 451652}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-59.png", "start": 451652, "end": 455456}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-60.png", "start": 455456, "end": 459327}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-61.png", "start": 459327, "end": 462822}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-62.png", "start": 462822, "end": 465467}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-63.png", "start": 465467, "end": 468003}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-64.png", "start": 468003, "end": 470750}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-65.png", "start": 470750, "end": 473263}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-66.png", "start": 473263, "end": 475787}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-67.png", "start": 475787, "end": 478191}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-68.png", "start": 478191, "end": 482285}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-69.png", "start": 482285, "end": 486265}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-70.png", "start": 486265, "end": 490226}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-71.png", "start": 490226, "end": 494115}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-72.png", "start": 494115, "end": 498080}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-73.png", "start": 498080, "end": 501913}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-74.png", "start": 501913, "end": 505292}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-75.png", "start": 505292, "end": 508846}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-76.png", "start": 508846, "end": 512800}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-77.png", "start": 512800, "end": 516744}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-78.png", "start": 516744, "end": 520641}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-79.png", "start": 520641, "end": 524420}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw-128/tile-80.png", "start": 524420, "end": 527608}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc2hw.radar", "start": 527608, "end": 528239}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-00.png", "start": 528239, "end": 530833}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-01.png", "start": 530833, "end": 534460}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-02.png", "start": 534460, "end": 538346}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-03.png", "start": 538346, "end": 541820}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-04.png", "start": 541820, "end": 545907}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-05.png", "start": 545907, "end": 550094}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-06.png", "start": 550094, "end": 554157}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-07.png", "start": 554157, "end": 558239}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-08.png", "start": 558239, "end": 562638}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-09.png", "start": 562638, "end": 566924}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-10.png", "start": 566924, "end": 571155}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-11.png", "start": 571155, "end": 575188}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-12.png", "start": 575188, "end": 579360}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-13.png", "start": 579360, "end": 581777}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-14.png", "start": 581777, "end": 583743}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-15.png", "start": 583743, "end": 586444}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-16.png", "start": 586444, "end": 587320}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-17.png", "start": 587320, "end": 588958}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-18.png", "start": 588958, "end": 593068}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-19.png", "start": 593068, "end": 596612}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-20.png", "start": 596612, "end": 600366}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-21.png", "start": 600366, "end": 604185}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-22.png", "start": 604185, "end": 607486}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-23.png", "start": 607486, "end": 611792}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-24.png", "start": 611792, "end": 616129}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-25.png", "start": 616129, "end": 619824}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-26.png", "start": 619824, "end": 623873}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-27.png", "start": 623873, "end": 627642}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-28.png", "start": 627642, "end": 631466}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-29.png", "start": 631466, "end": 635817}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-30.png", "start": 635817, "end": 640147}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-31.png", "start": 640147, "end": 642167}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-32.png", "start": 642167, "end": 642820}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-33.png", "start": 642820, "end": 645987}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-34.png", "start": 645987, "end": 649555}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-35.png", "start": 649555, "end": 652483}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-36.png", "start": 652483, "end": 656108}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-37.png", "start": 656108, "end": 659026}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-38.png", "start": 659026, "end": 663247}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-39.png", "start": 663247, "end": 667291}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-40.png", "start": 667291, "end": 671455}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-41.png", "start": 671455, "end": 675690}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-42.png", "start": 675690, "end": 679781}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-43.png", "start": 679781, "end": 684153}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-44.png", "start": 684153, "end": 688485}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-45.png", "start": 688485, "end": 692540}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-46.png", "start": 692540, "end": 696692}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-47.png", "start": 696692, "end": 700932}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-48.png", "start": 700932, "end": 705215}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-49.png", "start": 705215, "end": 709076}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-50.png", "start": 709076, "end": 713057}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-51.png", "start": 713057, "end": 717029}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-52.png", "start": 717029, "end": 720972}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-53.png", "start": 720972, "end": 724966}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-54.png", "start": 724966, "end": 728087}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-55.png", "start": 728087, "end": 731679}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-56.png", "start": 731679, "end": 735281}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-57.png", "start": 735281, "end": 739313}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-58.png", "start": 739313, "end": 742617}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-59.png", "start": 742617, "end": 745228}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-60.png", "start": 745228, "end": 748574}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-61.png", "start": 748574, "end": 752524}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-62.png", "start": 752524, "end": 756143}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-63.png", "start": 756143, "end": 759806}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-64.png", "start": 759806, "end": 761065}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-65.png", "start": 761065, "end": 763231}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-66.png", "start": 763231, "end": 767235}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-67.png", "start": 767235, "end": 770350}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-68.png", "start": 770350, "end": 774695}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-69.png", "start": 774695, "end": 779139}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-70.png", "start": 779139, "end": 781813}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-71.png", "start": 781813, "end": 785833}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-72.png", "start": 785833, "end": 789891}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-73.png", "start": 789891, "end": 793648}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-74.png", "start": 793648, "end": 797675}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-75.png", "start": 797675, "end": 801658}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-76.png", "start": 801658, "end": 805821}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-77.png", "start": 805821, "end": 810125}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-78.png", "start": 810125, "end": 814472}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw-128/tile-79.png", "start": 814472, "end": 817825}, {"filename": "/data/terrain_overrides/classic/texpages/tertilesc3hw.radar", "start": 817825, "end": 818456}, {"filename": "/data/terrain_overrides/classic/tileset/arizonadecals.txt", "start": 818456, "end": 818698}, {"filename": "/data/terrain_overrides/classic/tileset/rockiedecals.txt", "start": 818698, "end": 818945}, {"filename": "/data/terrain_overrides/classic/tileset/urbandecals.txt", "start": 818945, "end": 819194}], "remote_package_size": 819194, "package_uuid": "sha256-7d34e5ad2a36096bcddc09cfecc1be387a9932039ad36f524017b0a28ffcba48"});

  })();

"use strict";

(function (exports) {
  // A simple key value store using IndexedDB because it allows storage of
  // large amounts of data.
  class KeyValueStore {
    constructor(dbName, storeName) {
      this.storeName = storeName;
      this.dbPromise = new Promise((resolve, reject) => {
        const dbRequest = indexedDB.open(dbName, 1);
        dbRequest.onerror = () => reject(dbRequest.error);
        dbRequest.onsuccess = () => resolve(dbRequest.result);
        dbRequest.onupgradeneeded = () => {
          dbRequest.result.createObjectStore(storeName);
        };
      });
    }
    get(key) {
      return this.dbPromise.then(
        (db) =>
          new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const req = transaction.objectStore(this.storeName).get(key);
            transaction.oncomplete = () => resolve(req.result);
            transaction.onabort = transaction.onerror = () => {
              reject(transaction.error);
            };
          })
      );
    }
    set(key, value) {
      return this.dbPromise.then(
        (db) =>
          new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readwrite");
            const req = transaction.objectStore(this.storeName).put(value, key);
            transaction.oncomplete = () => resolve(req.result);
            transaction.onabort = transaction.onerror = () => {
              reject(transaction.error);
            };
          })
      );
    }
  }

  const kvstore = new KeyValueStore("data", "store");

  // Caches a single version of a resource
  class CachedResource {
    constructor(resourceUrl, key, keySuffix) {
      if (keySuffix === undefined) keySuffix = "";
      this.resourceUrl = resourceUrl;
      this.cacheKey = key + keySuffix;
    }
    async get(length, version, progressCallback = () => {}) {
      const cachedData = await kvstore.get(this.cacheKey);
      const cachedVersion = await kvstore.get(this.cacheKey + "-version");
      if (cachedData) {
        if (version === cachedVersion) {
          console.log(
            "Using cached resource",
            this.cacheKey,
            "originally downloaded from",
            this.resourceUrl
          );
          progressCallback(cachedData.byteLength, cachedData.byteLength, true);
          console.log("cached data:", cachedData);
          return cachedData;
        }
        console.log(
          "Out of date resource",
          this.cacheKey,
          "so redownloading from",
          this.resourceUrl
        );
        console.log(
          "required version",
          version,
          "but had version",
          cachedVersion,
          "stored"
        );
      }
      let data;

      // ——— split resources (this console's change to upstream) ———————————
      // Wrangler refuses to upload an R2 object over 300 MiB and has no
      // multipart mode, so scripts/r2-sync.mjs stores anything bigger as
      // <key>.part0, <key>.part1, … of 200 MiB each. Endless Sky's data
      // package is 383 MiB and hits this.
      //
      // Stitching the parts back together in a Pages Function does NOT work:
      // a Worker cannot stream a 400 MiB response to the end. It gets cut off
      // part-way while still sending a 200 and the full Content-Length, so the
      // truncation is invisible to the browser, to curl, and to the loader —
      // only a checksum against the original catches it. Measured twice, at
      // 209,833,984 and 160,234,240 bytes of the expected 401,639,029.
      //
      // So the parts are fetched here instead, straight into the buffer this
      // function was going to allocate anyway. No Worker in the path, no
      // concatenation step, no extra copy.
      //
      // MAX_PUT and PART must match the constants in scripts/r2-sync.mjs —
      // they are what decides whether a file was split, and into how many.
      const MAX_PUT = 300 * 1024 * 1024;
      const PART = 200 * 1024 * 1024;
      const urls =
        length > MAX_PUT
          ? Array.from({ length: Math.ceil(length / PART) }, (_, i) => this.resourceUrl + ".part" + i)
          : [this.resourceUrl];

      // response.body is missing in Pale Moon, a Firefox fork that someone on the Endless Sky Discord server uses
      if (length) {
        // use a progress bar
        let offset = 0;
        data = new ArrayBuffer(length);
        const view = new Uint8Array(data);
        progressCallback(offset, length);
        for (const url of urls) {
          const response = await fetch(url);
          if (!response.ok) throw new Error("failed to fetch " + url + ": " + response.status);
          if (response.body) {
            const reader = response.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              view.set(value, offset);
              offset += value.length;
              progressCallback(offset, length);
            }
          } else {
            const part = new Uint8Array(await response.arrayBuffer());
            view.set(part, offset);
            offset += part.length;
            progressCallback(offset, length);
          }
        }
        // A short body is the exact failure that cost a deploy today: it is
        // not an error anywhere else in the stack, so check it here.
        if (offset !== length) {
          throw new Error("expected " + length + " bytes from " + this.resourceUrl + ", assembled " + offset);
        }
        progressCallback(offset, length);
      } else {
        // length unknown, so it cannot have been split: one fetch, no progress bar
        const response = await fetch(this.resourceUrl);
        // ContentLength header is not reliable: it might be the length of the compressed resource.
        progressCallback(0, parseInt(response.headers.get("Content-Length")));
        data = await response.arrayBuffer();
      }

      console.log("downloaded", this.resourceUrl, data);
      try {
        await kvstore.set(this.cacheKey, data);
        await kvstore.set(this.cacheKey + "-version", version);
      } catch (e) {
        console.log(
          "Failure writing to IndexedDB, maybe private browsing / incognito mode or low on disk space"
        );
      }
      return data;
    }
  }

  window.CachedResource = CachedResource;
})();

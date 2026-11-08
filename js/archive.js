/*
 * pmtiles' SharedPromiseCache keeps the promise of each header and directory
 * read, a rejected one too, for the life of its reader: one network blip on
 * an archive's first read would fail every later read until a reload. The
 * page's readers use this cache instead, which drops the entry a failed read
 * added, so the next read asks the archive again.
 */

/** @type {(new () => import("pmtiles").SharedPromiseCache) | null} */
let ForgetfulCache = null;

/** A pmtiles cache that forgets a failed header or directory read. */
export function forgetfulCache() {
  ForgetfulCache ??= class extends globalThis.pmtiles.SharedPromiseCache {
    /** @param {import("pmtiles").Source} source */
    getHeader(source) {
      return this.forget(() => super.getHeader(source));
    }

    /**
     * @param {import("pmtiles").Source} source
     * @param {number} offset
     * @param {number} length
     * @param {import("pmtiles").Header} header
     * @param {AbortSignal} [signal]
     */
    getDirectory(source, offset, length, header, signal) {
      return this.forget(() => super.getDirectory(source, offset, length, header, signal));
    }

    /**
     * A miss adds its entry before the read's first await, as the newest in
     * the map. A hit adds none. If the read fails and the entry is still the
     * same one, it goes.
     *
     * @template T
     * @param {() => Promise<T>} read
     * @returns {Promise<T>}
     */
    forget(read) {
      const size = this.cache.size;
      const promise = read();
      if (this.cache.size > size) {
        const [key, entry] = [...this.cache].at(-1);
        promise.catch(() => {
          if (this.cache.get(key) === entry) this.cache.delete(key);
        });
      }
      return promise;
    }
  };
  return new ForgetfulCache();
}

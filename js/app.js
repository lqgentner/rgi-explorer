import { loadCatalog } from "./catalog.js";
import { resolveCatalogUrl } from "./config.js";
import { createMap } from "./map.js";
import { parseState } from "./state.js";
import { el } from "./ui.js";

/*
 * Startup. Reads the catalog, builds the map from it and registers the service worker.
 */

/*
 * Repeat visits read JSON from sw.js's cache while it revalidates. Skip localhost,
 * where the development server keeps JSON fresh.
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || ["localhost", "127.0.0.1"].includes(location.hostname)) {
    return;
  }
  navigator.serviceWorker
    .register("sw.js")
    .catch((error) => console.warn("service worker:", error.message));
}

registerServiceWorker();

async function start() {
  const catalog = await loadCatalog(resolveCatalogUrl(new URLSearchParams(location.search)));
  return createMap(el("map"), catalog, parseState(new URL(location.href)));
}

start().catch((error) => console.error("startup:", error));

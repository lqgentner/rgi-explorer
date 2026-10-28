/*
 * jsdom and a strict MapLibre fake. Duplicate layers, missing sources, and writes
 * to unadded layers throw to expose errors the real renderer may only warn about.
 */

import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

export const REPO = path.join(import.meta.dirname, "..", "..");

const PAGE_URL = "https://lqgentner.github.io/rgi-explorer/";

/* The page never exports its map, so the fake records each instance and the
 * harness hands the test the one the modules are using. */
let created = [];

export class FakeMap {
  constructor(options = {}) {
    created.push(this);
    this.options = options;
    this.rendered = [];
    this.sources = new Map(
      Object.entries(options.style?.sources ?? {}).map(([id, spec]) => [id, this.#source(spec)]),
    );
    queueMicrotask(() => this.fire("load"));
    this.layers = new Map();
    this.order = [];
    this.handlers = {};
    this.calls = [];
    this.terrain = null;
    this.center = { lng: options.center?.[0] ?? 0, lat: options.center?.[1] ?? 0 };
    this.zoom = options.zoom ?? 0;
    for (const layer of options.style?.layers ?? []) {
      if (this.layers.has(layer.id)) throw new Error(`layer '${layer.id}' added twice`);
      if (layer.source && !this.sources.has(layer.source)) {
        throw new Error(`layer '${layer.id}' names missing source '${layer.source}'`);
      }
      this.layers.set(layer.id, structuredClone(layer));
      this.order.push(layer.id);
    }
  }

  /** GeoJSON sources take new data; the fake keeps the latest as `data`. */
  #source(spec) {
    const source = { ...spec };
    if (spec.type === "geojson") {
      source.setData = (data) => {
        source.data = data;
        this.calls.push("setData");
      };
    }
    return source;
  }

  addSource(id, spec) {
    if (this.sources.has(id)) throw new Error(`source '${id}' added twice`);
    this.sources.set(id, this.#source(spec));
    this.calls.push(`+source ${id}`);
  }

  removeSource(id) {
    this.sources.delete(id);
    this.calls.push(`-source ${id}`);
  }

  getSource(id) {
    return this.sources.get(id);
  }

  addLayer(layer, before) {
    if (this.layers.has(layer.id)) throw new Error(`layer '${layer.id}' added twice`);
    if (layer.source && !this.sources.has(layer.source)) {
      throw new Error(`layer '${layer.id}' names missing source '${layer.source}'`);
    }
    this.layers.set(layer.id, structuredClone(layer));
    const at = before ? this.order.indexOf(before) : -1;
    if (at === -1) this.order.push(layer.id);
    else this.order.splice(at, 0, layer.id);
    this.calls.push(`+layer ${layer.id}`);
  }

  removeLayer(id) {
    this.layers.delete(id);
    this.order = this.order.filter((other) => other !== id);
    this.calls.push(`-layer ${id}`);
  }

  getLayer(id) {
    return this.layers.get(id);
  }

  /** The layer's layout object, empty when it has none. */
  layout(id) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`layout of missing layer '${id}'`);
    return layer.layout ?? {};
  }

  /** The features a test put in `rendered`, limited to the layers asked for. */
  queryRenderedFeatures(point, { layers = [] } = {}) {
    for (const id of layers) {
      if (!this.layers.has(id)) throw new Error(`query of missing layer '${id}'`);
    }
    return this.rendered.filter((feature) => layers.includes(feature.layer?.id));
  }

  setLayoutProperty(id, key, value) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`setLayoutProperty on missing layer '${id}'`);
    (layer.layout ??= {})[key] = value;
    this.calls.push(`layout ${id} ${key}`);
  }

  setPaintProperty(id, key, value) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`setPaintProperty on missing layer '${id}'`);
    (layer.paint ??= {})[key] = value;
    this.calls.push(`paint ${id} ${key}`);
  }

  setFilter(id, filter) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`setFilter on missing layer '${id}'`);
    layer.filter = filter ?? undefined;
    this.calls.push(`filter ${id}`);
  }

  setTerrain(spec) {
    if (spec && !this.sources.has(spec.source)) {
      throw new Error(`terrain names missing source '${spec.source}'`);
    }
    this.terrain = spec ?? null;
    this.calls.push(spec ? "+terrain" : "-terrain");
  }

  getTerrain() {
    return this.terrain;
  }

  fitBounds(bounds, options = {}) {
    this.calls.push(`fitBounds ${JSON.stringify(bounds)}`);
    this.lastFit = { bounds, options };
    this.fire("moveend");
  }

  jumpTo(options) {
    if (options.center) this.center = { lng: options.center[0], lat: options.center[1] };
    if (options.zoom !== undefined) this.zoom = options.zoom;
    this.calls.push(`jumpTo ${options.center} z${options.zoom}`);
    this.fire("moveend");
  }

  getCenter() {
    return this.center;
  }

  getZoom() {
    return this.zoom;
  }

  on(event, fn) {
    (this.handlers[event] ??= []).push(fn);
  }

  off(event, fn) {
    this.handlers[event] = (this.handlers[event] ?? []).filter((f) => f !== fn);
  }

  once(event, fn) {
    const wrapped = (e) => {
      this.off(event, wrapped);
      fn(e);
    };
    this.on(event, wrapped);
  }

  fire(event, payload = {}) {
    for (const fn of [...(this.handlers[event] ?? [])]) fn(payload);
  }

  zoomIn() {
    this.zoom += 1;
    this.calls.push("zoomIn");
  }

  zoomOut() {
    this.zoom -= 1;
    this.calls.push("zoomOut");
  }

  /** Index of a layer in draw order; -1 when it does not exist. */
  indexOf(id) {
    return this.order.indexOf(id);
  }
}

/**
 * Install a DOM and the library globals index.html sets before the modules run,
 * then resolve with the page's window, document and the fake map the modules build.
 *
 * @param {object} [options]
 * @param {string} [options.url]    the page address, query and hash included
 * @param {Function} [options.fetch]  replaces fetch(); the default answers 404
 * @param {boolean} [options.phone]  makes every media query match, as a phone does
 */
export async function loadPage({ url = PAGE_URL, fetch, phone = false } = {}) {
  created = [];
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, "index.html"), "utf8"), {
    url,
    runScripts: "outside-only",
  });
  const { window } = dom;

  for (const name of ["window", "document", "location", "history", "HTMLElement", "Node", "Event"]) {
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
      writable: true,
    });
  }

  /* jsdom has no matchMedia. The page asks one question, whether this is a
   * phone, so the stub answers every query alike (`phone`). */
  window.matchMedia = (media) => ({
    media,
    matches: phone,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.matchMedia = window.matchMedia;

  globalThis.maplibregl = {
    addProtocol() {},
    Map: FakeMap,
    NavigationControl: class {},
    ScaleControl: class {},
    AttributionControl: class {},
  };
  globalThis.pmtiles = {
    Protocol: class {
      tile() {}
    },
  };
  globalThis.hyparquet = {};

  globalThis.fetch =
    fetch ?? (async () => ({ ok: false, status: 404, json: async () => ({}) }));

  return {
    window,
    document: window.document,
    /** The map the modules built, once something has imported the code that makes it. */
    get map() {
      return created.at(-1);
    },
  };
}

/** Let every already-resolved promise chain run to completion. */
export async function settle(turns = 6) {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Import a module by repo-relative path, sharing one module graph per file. */
export function load(specifier) {
  return import(path.join(REPO, specifier));
}

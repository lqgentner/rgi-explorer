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

/* The map options the page may pass. Any other name is a typo MapLibre would ignore. */
const MAP_OPTIONS = new Set([
  "container",
  "style",
  "center",
  "zoom",
  "attributionControl",
  "transformCameraUpdate",
  "interactive",
  "pixelRatio",
  "canvasContextAttributes",
]);

export class FakeMap {
  constructor(options = {}) {
    for (const name of Object.keys(options)) {
      if (!MAP_OPTIONS.has(name)) throw new Error(`unknown map option '${name}'`);
    }
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
    /* What loaded() and isMoving() answer; a test sets them to stage a busy map. */
    this.tilesLoaded = true;
    this.moving = false;
    this.center = { lng: options.center?.[0] ?? 0, lat: options.center?.[1] ?? 0 };
    this.zoom = options.zoom ?? 0;
    this.pitch = 0;
    this.bearing = 0;
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

  /**
   * The features a test put in `rendered`, limited to the layers asked for. A
   * feature with Point geometry is drawn as a dot of `radius` pixels (default
   * 2) at `project()` of its coordinates, and only a query that touches the dot
   * finds it. A feature without geometry is under every point.
   */
  queryRenderedFeatures(geometry, { layers = [] } = {}) {
    for (const id of layers) {
      if (!this.layers.has(id)) throw new Error(`query of missing layer '${id}'`);
    }
    const xy = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p);
    const box = Array.isArray(geometry) && typeof geometry[0] !== "number";
    const [low, high] = box ? geometry.map(xy) : [xy(geometry), xy(geometry)];
    this.calls.push(`queryRenderedFeatures ${box ? "box" : "point"}`);
    return this.rendered.filter((feature) => {
      if (!layers.includes(feature.layer?.id)) return false;
      if (feature.geometry?.type !== "Point") return true;
      const at = this.project(feature.geometry.coordinates);
      const r = feature.radius ?? 2;
      return at.x >= low.x - r && at.x <= high.x + r && at.y >= low.y - r && at.y <= high.y + r;
    });
  }

  /** Screen pixels of a [lng, lat]. The fake's screen is the lon/lat plane, one pixel per degree. */
  project([lng, lat]) {
    return { x: lng, y: lat };
  }

  /**
   * The features a test put in `sourceFeatures` for a source and source layer.
   * Only an `["==", ["get", key], value]` filter is understood.
   */
  querySourceFeatures(id, { sourceLayer, filter } = {}) {
    if (!this.sources.has(id)) throw new Error(`query of missing source '${id}'`);
    let match = () => true;
    if (filter) {
      const [op, [get, key] = [], value] = filter;
      if (op !== "==" || get !== "get") throw new Error(`unsupported filter ${JSON.stringify(filter)}`);
      match = (feature) => feature.properties?.[key] === value;
    }
    this.calls.push(`querySourceFeatures ${id}`);
    return (this.sourceFeatures ?? []).filter(
      (feature) => (feature.source ?? id) === id && feature.sourceLayer === sourceLayer && match(feature),
    );
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

  /** An animated move; the fake ends it at once. */
  easeTo(options) {
    if (options.center) this.center = { lng: options.center[0], lat: options.center[1] };
    if (options.zoom !== undefined) this.zoom = options.zoom;
    if (options.pitch !== undefined) this.pitch = options.pitch;
    if (options.bearing !== undefined) this.bearing = options.bearing;
    this.calls.push(`easeTo ${JSON.stringify(options)}`);
    this.fire("moveend");
  }

  getPitch() {
    return this.pitch;
  }

  getBearing() {
    return this.bearing;
  }

  /** Whether the style and the tiles in view have loaded. */
  loaded() {
    return this.tilesLoaded;
  }

  /** Whether a camera animation or a gesture is under way. */
  isMoving() {
    return this.moving;
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

  /** The canvas; `toDataURL` names the view it would show. */
  getCanvas() {
    return {
      toDataURL: (type) => `data:${type};view=${this.zoom}/${this.center.lng}/${this.center.lat}`,
    };
  }

  /** A repaint ends at once in an idle map. */
  triggerRepaint() {
    this.calls.push("triggerRepaint");
    queueMicrotask(() => this.fire("idle"));
  }

  setPixelRatio(ratio) {
    this.options.pixelRatio = ratio;
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
   * phone, so the stub answers every query alike (`phone`), and setPhone()
   * changes the answer as a resize across the breakpoint does. */
  const queries = [];
  window.matchMedia = (media) => {
    const listeners = new Set();
    const query = {
      media,
      matches: phone,
      addEventListener(type, fn) {
        if (type === "change") listeners.add(fn);
      },
      removeEventListener(type, fn) {
        listeners.delete(fn);
      },
      listeners,
    };
    queries.push(query);
    return query;
  };
  globalThis.matchMedia = window.matchMedia;

  globalThis.maplibregl = {
    addProtocol() {},
    Map: FakeMap,
    NavigationControl: class {},
    ScaleControl: class {},
    AttributionControl: class {},
    LngLat: class {
      constructor(lng, lat) {
        Object.assign(this, { lng, lat });
      }
    },
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
    /** Cross the breakpoint: every query answers `on` and tells its listeners. */
    setPhone(on) {
      for (const query of queries) {
        if (query.matches === on) continue;
        query.matches = on;
        for (const fn of [...query.listeners]) fn({ matches: on, media: query.media });
      }
    },
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

/** Wait until `check()` is truthy, polling each turn; reject after `ms`. */
export async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`waitFor timed out: ${check}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Import a module by repo-relative path, sharing one module graph per file. */
export function load(specifier) {
  return import(path.join(REPO, specifier));
}

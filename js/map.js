/* The map: base maps, the RGI layers, the selection and the terminus pin. */

import { ESRI_TILES, GLYPHS, LIBERTY_STYLE, startView, TERRAIN_TILEJSON } from "./config.js";
import { installSky } from "./sky.js";
import { GLACIER_OPACITY, rgiStyle, TOGGLES } from "./styles.js";

const SELECTION_RED = "#d93025";
const COMPLEX_GREY = "#5f6368";
const MAX_LAT = 85.05;
/* How far from a click, in pixels, a glacier dot still counts as hit. */
const HIT_PX = 6;
const POINTS = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];
/* The camera tilt in 3D, in degrees from straight down. */
const TERRAIN_PITCH = 60;
const NONE = { visibility: "none" };
const EMPTY = { type: "FeatureCollection", features: [] };
const WORLD = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90],
        [-180, -90],
      ],
    ],
  },
};

let protocolRegistered = false;

function registerProtocol() {
  if (protocolRegistered) return;
  const protocol = new globalThis.pmtiles.Protocol();
  globalThis.maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

const isSymbol = (layer) => layer.type === "symbol";
const visibility = (on) => (on ? "visible" : "none");

/** The catalog layers that belong to a toggle, by source layer. */
function toggleOf(layer) {
  return Object.keys(TOGGLES).find((name) => TOGGLES[name].includes(layer["source-layer"]));
}

/** One style: Liberty, the imagery layer, the RGI layers and the selection layers. */
function buildStyle(liberty, rgi, state) {
  const base = liberty.layers.map((layer) => {
    const copy = structuredClone(layer);
    if (copy.id === "landcover_ice") copy.layout = { ...copy.layout, ...NONE };
    return copy;
  });
  const lastFlat = base.findLastIndex((layer) => !isSymbol(layer));
  const esri = {
    id: "esri",
    type: "raster",
    source: "esri",
    layout: { visibility: visibility(state.base === "imagery") },
  };

  const rgiLayers = rgi.layers.map((layer) => {
    const name = toggleOf(layer);
    if (name) layer.layout = { ...layer.layout, visibility: visibility(state.layers.has(name)) };
    return layer;
  });
  const glaciersFill = rgiLayers.find((layer) => layer.id === "glaciers-fill");
  if (glaciersFill) glaciersFill.paint["fill-opacity"] = GLACIER_OPACITY[state.base] ?? GLACIER_OPACITY.standard;

  const selection = [
    {
      id: "selection-dim",
      type: "fill",
      source: "world",
      layout: NONE,
      paint: { "fill-color": COMPLEX_GREY, "fill-opacity": 0.15 },
    },
    {
      id: "selection-fill",
      type: "fill",
      source: "data",
      "source-layer": "glaciers",
      layout: NONE,
      paint: structuredClone(glaciersFill?.paint ?? {}),
    },
    {
      id: "selection-outline",
      type: "line",
      source: "data",
      "source-layer": "glaciers",
      layout: NONE,
      paint: { "line-color": SELECTION_RED, "line-width": 2.5, "line-dasharray": [2, 1.2] },
    },
    {
      id: "selection-dot",
      type: "circle",
      source: "data",
      "source-layer": "glaciers",
      filter: POINTS,
      layout: NONE,
      paint: {
        "circle-color": SELECTION_RED,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 6, 5],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "selection-complex",
      type: "line",
      source: "data",
      "source-layer": "complexes",
      layout: NONE,
      paint: { "line-color": COMPLEX_GREY, "line-width": 2, "line-dasharray": [3, 2] },
    },
    {
      id: "terminus-pin",
      type: "circle",
      source: "pin",
      paint: {
        "circle-radius": 6,
        "circle-color": SELECTION_RED,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
  ];

  return {
    version: 8,
    /* MapLibre turns the globe into Mercator as it zooms in. */
    projection: { type: "globe" },
    ...(liberty.sprite ? { sprite: liberty.sprite } : {}),
    glyphs: GLYPHS,
    sources: {
      ...liberty.sources,
      ...rgi.sources,
      esri: { type: "raster", tiles: [ESRI_TILES], tileSize: 256 },
      world: { type: "geojson", data: WORLD },
      pin: { type: "geojson", data: EMPTY },
    },
    layers: [
      ...base.slice(0, lastFlat + 1),
      esri,
      ...rgiLayers.filter((layer) => !isSymbol(layer)),
      ...base.slice(lastFlat + 1),
      ...rgiLayers.filter(isSymbol),
      ...selection,
    ],
  };
}

const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/**
 * Builds the map and resolves once it has loaded. The RGI layers share one
 * source, the catalog's PMTiles file.
 */
export async function createMap(container, catalog, state) {
  const liberty = await fetchJson(LIBERTY_STYLE);
  const rgi = rgiStyle(catalog.collections.glaciers.pmtilesUrl);

  registerProtocol();
  const { maplibregl } = globalThis;
  const view = state.view ?? startView();
  /* The status line holds every credit, so MapLibre adds no attribution control. */
  const map = new maplibregl.Map({
    container,
    style: buildStyle(liberty, rgi, state),
    center: [view.lon, view.lat],
    zoom: view.zoom,
    attributionControl: false,
  });
  await new Promise((resolve, reject) => {
    const fail = (event) => {
      if (event?.sourceId || event?.tile) return;
      map.off("error", fail);
      reject(event?.error ?? new Error("The map failed to load"));
    };
    map.on("error", fail);
    map.once("load", () => {
      map.off("error", fail);
      resolve();
    });
  });
  installSky(map, container);

  const rgiToggles = rgi.layers.map((layer) => [layer.id, toggleOf(layer)]).filter(([, n]) => n);
  const idFilter = (id) => ["==", ["get", "rgi_id"], id];
  const SELECTION = ["selection-dim", "selection-fill", "selection-outline", "selection-dot"];
  const show = (id, on) => map.setLayoutProperty(id, "visibility", visibility(on));

  const api = {
    map,

    setBase(base) {
      show("esri", base === "imagery");
      for (const id of ["glaciers-fill", "selection-fill"]) map.setPaintProperty(id, "fill-opacity", GLACIER_OPACITY[base]);
    },

    setToggle(name, on) {
      for (const [id, owner] of rgiToggles) if (owner === name) show(id, on);
    },

    select(rgiId) {
      const on = rgiId !== null && rgiId !== undefined;
      if (on) {
        map.setFilter("selection-fill", idFilter(rgiId));
        map.setFilter("selection-outline", idFilter(rgiId));
        map.setFilter("selection-dot", ["all", POINTS, idFilter(rgiId)]);
      }
      for (const id of SELECTION) show(id, on);
      if (!on) {
        api.showComplex(null);
        api.pin(null);
      }
    },

    showComplex(complexId) {
      if (complexId) map.setFilter("selection-complex", idFilter(complexId));
      show("selection-complex", Boolean(complexId));
    },

    pin(lonLat) {
      map.getSource("pin").setData(
        lonLat
          ? {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: lonLat },
            }
          : EMPTY,
      );
    },

    setTerrain(on) {
      if (on && !map.getSource("terrain")) {
        map.addSource("terrain", {
          type: "raster-dem",
          url: TERRAIN_TILEJSON,
          tileSize: 512,
          encoding: "terrarium",
        });
      }
      map.setTerrain(on ? { source: "terrain", exaggeration: 1 } : null);
      map.easeTo(on ? { pitch: TERRAIN_PITCH } : { pitch: 0, bearing: 0 });
    },

    fitBbox({ xmin, ymin, xmax, ymax }, padding, center) {
      if (xmax - xmin >= 360 && center) {
        map.jumpTo({ center, zoom: 3 });
        return;
      }
      map.fitBounds(
        [
          [xmin, clampLat(ymin)],
          [xmax, clampLat(ymax)],
        ],
        { padding },
      );
    },

    /**
     * The properties of the glacier under a screen point, or null. A glacier
     * under the exact pixel wins. Otherwise the nearest dot within HIT_PX
     * pixels counts, because the low-zoom dots are only a few pixels wide.
     */
    glacierAt(point) {
      const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
      const [exact] = map.queryRenderedFeatures([x, y], { layers: ["glaciers-fill", "glaciers-dots"] });
      if (exact) return exact.properties;
      const near = map.queryRenderedFeatures(
        [
          [x - HIT_PX, y - HIT_PX],
          [x + HIT_PX, y + HIT_PX],
        ],
        { layers: ["glaciers-dots"] },
      );
      const distance = (feature) => {
        const { type, coordinates } = feature.geometry ?? {};
        const lngLat = type === "Point" ? coordinates : type === "MultiPoint" ? coordinates[0] : null;
        if (!lngLat) return Infinity;
        const at = map.project(lngLat);
        return Math.hypot(at.x - x, at.y - y);
      };
      let best = null;
      for (const feature of near) {
        const d = distance(feature);
        if (!best || d < best.d) best = { feature, d };
      }
      return best ? best.feature.properties : null;
    },

    onMove(callback) {
      map.on("moveend", () => {
        const { lng, lat } = map.getCenter();
        callback({ zoom: map.getZoom(), lat, lon: lng });
      });
    },
  };
  return api;
}

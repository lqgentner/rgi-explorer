/* The map: base maps, the RGI layers, the selection and the terminus pin. */

import { ESRI_TILES, GLYPHS, LIBERTY_STYLE, startView, TERRAIN_TILEJSON, TIMEOUT_MS } from "./config.js";
import { BASE_PAINT, rgiStyle, TOGGLES } from "./styles.js";
import { PREVIEW_SPAN } from "./viewpreview.js";

const SELECTION_RED = "#d93025";
const DIM_GREY = "#5f6368";
/*
 * How much a selection dims the map around it, per base map. A selection is
 * lifted out of the dimming by drawing its fill again, but over imagery the
 * fill is clear, so the dimming would cover the glacier too: imagery has none.
 */
const DIM_OPACITY = { standard: 0.15, imagery: 0 };
const SELECTION_LINE = { "line-color": SELECTION_RED, "line-width": 2, "line-dasharray": [2, 1.2] };
const SELECTION_DOT = {
  "circle-color": SELECTION_RED,
  "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 6, 5],
  "circle-stroke-color": "#ffffff",
  "circle-stroke-width": 1.5,
};
/*
 * MapLibre's own atmosphere around the globe, per base map: fainter over the
 * light standard map, which its haze pales. The sky and fog stay clear, as with
 * no sky at all, so a tilted view close in shows the space behind the canvas.
 */
const ATMOSPHERE = { standard: 0.5, imagery: 0.8 };
const sky = (base) => ({
  "sky-color": "transparent",
  "horizon-color": "transparent",
  "fog-color": "transparent",
  "fog-ground-blend": 1,
  "atmosphere-blend": ATMOSPHERE[base] ?? ATMOSPHERE.standard,
});
/* The background on imagery, where the imagery has not loaded yet. */
const IMAGERY_BACKGROUND = "#3c4043";
const MAX_LAT = 85.05;
const POINTS = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];
/* The camera tilt in 3D, in degrees from straight down. */
const TERRAIN_PITCH = 60;
const NONE = { visibility: "none" };
/*
 * The toggled layers that a selection's lift would hide, drawn again above it.
 * The divides are not: they run along the outline, which the lift leaves showing.
 */
const SELECTION_OVERLAYS = ["centerlines"];
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

/** Liberty's layers, with its own glacier fill hidden: RGI is the only glacier layer. */
function libertyLayers(liberty) {
  return liberty.layers.map((layer) => {
    const copy = structuredClone(layer);
    if (copy.id === "landcover_ice") copy.layout = { ...copy.layout, ...NONE };
    return copy;
  });
}

/**
 * Liberty's layers split where the imagery goes: above its fills and lines
 * but below its country borders, which Liberty draws last, and its labels.
 * `covered` names the layers the imagery hides, so they are switched off on
 * imagery and draw nothing and fetch nothing there. The background stays, as
 * it shows while the imagery loads; it turns dark grey there.
 */
function splitLiberty(liberty) {
  const base = libertyLayers(liberty);
  const lastFlat = base.findLastIndex((layer) => !isSymbol(layer));
  const firstBorder = base.findIndex((layer) => layer["source-layer"] === "boundary");
  const cut = firstBorder !== -1 && firstBorder <= lastFlat ? firstBorder : lastFlat + 1;
  const covered = base
    .slice(0, cut)
    .filter((layer) => layer.type !== "background" && layer.layout?.visibility !== "none")
    .map((layer) => layer.id);
  const background = base.find((layer) => layer.type === "background");
  return { base, cut, covered, background };
}

/**
 * One style: Liberty, the imagery layer, the RGI layers and the selection
 * layers. The imagery and the RGI fills and lines go between Liberty's flat
 * layers and its borders and labels (see splitLiberty).
 */
function buildStyle(liberty, rgi, state) {
  const { base, cut, covered, background } = splitLiberty(liberty);
  if (state.base === "imagery") {
    for (const layer of base) if (covered.includes(layer.id)) layer.layout = { ...layer.layout, ...NONE };
    if (background) background.paint = { ...background.paint, "background-color": IMAGERY_BACKGROUND };
  }
  const esri = {
    id: "esri",
    type: "raster",
    source: "esri",
    layout: { visibility: visibility(state.base === "imagery") },
  };

  const basePaint = BASE_PAINT[state.base] ?? BASE_PAINT.standard;
  const rgiLayers = rgi.layers.map((layer) => {
    const name = toggleOf(layer);
    if (name) layer.layout = { ...layer.layout, visibility: visibility(state.layers.has(name)) };
    if (basePaint[layer.id]) layer.paint = { ...layer.paint, ...basePaint[layer.id] };
    return layer;
  });
  const glaciersFill = rgiLayers.find((layer) => layer.id === "glaciers-fill");
  const glacierLabels = rgiLayers.find((layer) => layer.id === "glacier-labels");
  const glaciersOutline = rgiLayers.find((layer) => layer.id === "glaciers-outline");

  const selection = [
    {
      id: "selection-dim",
      type: "fill",
      source: "world",
      layout: NONE,
      paint: { "fill-color": DIM_GREY, "fill-opacity": DIM_OPACITY[state.base] ?? DIM_OPACITY.standard },
    },
    {
      id: "selection-fill",
      type: "fill",
      source: "data",
      "source-layer": "glaciers",
      layout: NONE,
      paint: structuredClone(glaciersFill?.paint ?? {}),
    },
    /*
     * A selected complex: lifted out of the dimming like a glacier, its member
     * glaciers' outlines and the glacier names drawn again above the lift, and
     * its own outline red. The label tiles do not name a glacier's complex, so
     * every glacier name is drawn again; the copy below gives way to it.
     */
    {
      id: "complex-fill",
      type: "fill",
      source: "data",
      "source-layer": "complexes",
      layout: NONE,
      paint: structuredClone(glaciersFill?.paint ?? {}),
    },
    {
      id: "complex-members",
      type: "line",
      source: "data",
      "source-layer": "glaciers",
      layout: NONE,
      paint: structuredClone(glaciersOutline?.paint ?? {}),
    },
    /* The selection's own centerlines, drawn again above its lift, which hides the plain ones. They show with their toggle. */
    ...SELECTION_OVERLAYS.map((id) => {
      const plain = rgiLayers.find((layer) => layer.id === id);
      return {
        ...structuredClone(plain),
        id: `selection-${id}`,
        layout: { ...structuredClone(plain?.layout ?? {}), ...NONE },
      };
    }),
    {
      id: "selection-outline",
      type: "line",
      source: "data",
      "source-layer": "glaciers",
      layout: NONE,
      paint: { ...SELECTION_LINE },
    },
    {
      id: "selection-dot",
      type: "circle",
      source: "data",
      "source-layer": "glaciers",
      filter: POINTS,
      layout: NONE,
      paint: { ...SELECTION_DOT },
    },
    {
      id: "complex-labels",
      type: "symbol",
      source: "data",
      "source-layer": "glacier-labels",
      ...(glacierLabels?.minzoom === undefined ? {} : { minzoom: glacierLabels.minzoom }),
      ...(glacierLabels?.filter ? { filter: structuredClone(glacierLabels.filter) } : {}),
      layout: { ...structuredClone(glacierLabels?.layout ?? {}), ...NONE },
      paint: structuredClone(glacierLabels?.paint ?? {}),
    },
    {
      id: "complex-outline",
      type: "line",
      source: "data",
      "source-layer": "complexes",
      layout: NONE,
      paint: { ...SELECTION_LINE },
    },
    {
      id: "complex-dot",
      type: "circle",
      source: "data",
      "source-layer": "complexes",
      filter: POINTS,
      layout: NONE,
      paint: { ...SELECTION_DOT },
    },
    /* The selected glacier's name, in red over its outline. It wins the label collisions, so the plain label of the same name gives way. */
    {
      id: "selection-label",
      type: "symbol",
      source: "data",
      "source-layer": "glacier-labels",
      layout: {
        ...structuredClone(glacierLabels?.layout ?? {}),
        "text-size": 13,
        "text-allow-overlap": true,
        ...NONE,
      },
      paint: { "text-color": SELECTION_RED, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
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
    sky: sky(state.base),
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
      ...base.slice(0, cut),
      esri,
      ...rgiLayers.filter((layer) => !isSymbol(layer)),
      ...base.slice(cut),
      ...rgiLayers.filter(isSymbol),
      ...selection,
    ],
  };
}

const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/**
 * The Standard map's picture of a view: a hidden map of OpenFreeMap's Liberty
 * as it comes, its own glaciers included, but without its symbol layers: no
 * labels, icons or shields. It is PREVIEW_SPAN CSS pixels square and made on
 * first use. It draws at the main map's zoom, so it asks for the tiles the
 * main map already holds, from the browser's cache; its pixel ratio shrinks
 * the drawing to the picture's size. `picture(view, px)`
 * resolves with a JPEG data URL, or null when the map fails or takes longer
 * than TIMEOUT_MS.
 */
function standardPictures(liberty) {
  let mini = null;
  let ready = null;
  let px = 0;

  function make(size) {
    const { maplibregl } = globalThis;
    const holder = document.createElement("div");
    holder.className = "picture-map";
    holder.setAttribute("aria-hidden", "true");
    Object.assign(holder.style, { width: `${PREVIEW_SPAN}px`, height: `${PREVIEW_SPAN}px` });
    document.body.append(holder);
    px = size;
    mini = new maplibregl.Map({
      container: holder,
      style: {
        version: 8,
        ...(liberty.sprite ? { sprite: liberty.sprite } : {}),
        sources: liberty.sources,
        layers: liberty.layers.filter((layer) => !isSymbol(layer)),
      },
      center: [0, 0],
      zoom: 0,
      interactive: false,
      attributionControl: false,
      pixelRatio: size / PREVIEW_SPAN,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    ready = new Promise((resolve) => mini.once("load", resolve));
  }

  /* Resolve on the map's next idle, or with false after TIMEOUT_MS. */
  const idle = () =>
    new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        mini.off("idle", onIdle);
        resolve(value);
      };
      const onIdle = () => done(true);
      const timer = setTimeout(() => done(false), TIMEOUT_MS);
      mini.on("idle", onIdle);
    });

  return async function picture({ center, zoom }, size) {
    try {
      if (!mini) make(size);
      else if (size !== px) {
        px = size;
        mini.setPixelRatio(size / PREVIEW_SPAN);
      }
      await ready;
      const settled = idle();
      mini.jumpTo({ center, zoom, bearing: 0, pitch: 0 });
      mini.triggerRepaint();
      return (await settled) ? mini.getCanvas().toDataURL("image/jpeg", 0.85) : null;
    } catch (error) {
      console.warn("standard picture:", error.message);
      return null;
    }
  };
}

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
  /*
   * The status line holds every credit, so MapLibre adds no attribution
   * control. The centre stops at the Mercator edge, as the tiles do: the
   * globe would otherwise turn on a pole.
   */
  const map = new maplibregl.Map({
    container,
    style: buildStyle(liberty, rgi, state),
    center: [view.lon, clampLat(view.lat)],
    zoom: view.zoom,
    attributionControl: false,
    /*
     * Past a source's maxzoom MapLibre cuts the deepest tile into smaller ones
     * by default, keeping only the source layers a visible style layer reads,
     * and caches the cut. A layer shown later, such as the complex selection,
     * then finds its source layer missing at those zooms. Undefined stretches
     * the deepest tile instead, with every source layer in it.
     */
    zoomLevelsToOverscale: undefined,
    transformCameraUpdate: ({ center }) =>
      Math.abs(center.lat) > MAX_LAT ? { center: new maplibregl.LngLat(center.lng, clampLat(center.lat)) } : {},
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

  const rgiToggles = rgi.layers.map((layer) => [layer.id, toggleOf(layer)]).filter(([, n]) => n);
  const idFilter = (id) => ["==", ["get", "rgi_id"], id];
  const SELECTION = ["selection-dim", "selection-fill", "selection-outline", "selection-dot", "selection-label"];
  const COMPLEX = ["complex-fill", "complex-members", "complex-labels", "complex-outline", "complex-dot"];
  const show = (id, on) => map.setLayoutProperty(id, "visibility", visibility(on));
  /* The toggles that are on, and the glaciers whose centerlines the selection draws again. */
  const toggles = new Set(state.layers);
  let picked = null;
  const OVERLAY_FILTERS = {
    centerlines: (ids) => ["in", ["get", "rgi_g_id"], ["literal", ids]],
  };
  const showOverlays = () => {
    for (const id of SELECTION_OVERLAYS) {
      if (picked !== null) map.setFilter(`selection-${id}`, OVERLAY_FILTERS[id](picked));
      show(`selection-${id}`, picked !== null && rgiToggles.some(([layer, name]) => layer === id && toggles.has(name)));
    }
  };
  const { covered, background } = splitLiberty(liberty);
  const picture = standardPictures(liberty);
  /* The bearing the arrows' last turn eases to, while it runs. */
  let turnTo = null;
  map.on("moveend", () => {
    if (!map.isMoving()) turnTo = null;
  });

  const api = {
    map,

    /* Each base map's plain background, which shows before its tiles arrive. */
    backgrounds: { standard: background?.paint?.["background-color"], imagery: IMAGERY_BACKGROUND },

    /** A JPEG data URL of the Standard map around the view's centre, `px` pixels square, or null. */
    standardPicture(px) {
      const { lng, lat } = map.getCenter();
      return picture({ center: [lng, lat], zoom: map.getZoom() }, px);
    },

    setBase(base) {
      show("esri", base === "imagery");
      for (const id of covered) show(id, base !== "imagery");
      if (background) {
        const color = base === "imagery" ? IMAGERY_BACKGROUND : background.paint?.["background-color"];
        map.setPaintProperty(background.id, "background-color", color);
      }
      const paint = BASE_PAINT[base];
      for (const [id, properties] of Object.entries(paint)) {
        for (const [key, value] of Object.entries(properties)) map.setPaintProperty(id, key, value);
      }
      /* The selections redraw the glacier fill, and a complex its members' outlines, above the dimming. */
      map.setPaintProperty("selection-dim", "fill-opacity", DIM_OPACITY[base]);
      map.setSky(sky(base));
      map.setPaintProperty("selection-fill", "fill-opacity", paint["glaciers-fill"]["fill-opacity"]);
      map.setPaintProperty("complex-fill", "fill-opacity", paint["glaciers-fill"]["fill-opacity"]);
      map.setPaintProperty("complex-members", "line-color", paint["glaciers-outline"]["line-color"]);
    },

    setToggle(name, on) {
      for (const [id, owner] of rgiToggles) if (owner === name) show(id, on);
      if (on) toggles.add(name);
      else toggles.delete(name);
      showOverlays();
    },

    select(rgiId) {
      const on = rgiId !== null && rgiId !== undefined;
      if (on) {
        map.setFilter("selection-fill", idFilter(rgiId));
        map.setFilter("selection-outline", idFilter(rgiId));
        map.setFilter("selection-dot", ["all", POINTS, idFilter(rgiId)]);
        map.setFilter("selection-label", idFilter(rgiId));
      }
      for (const id of COMPLEX) show(id, false);
      for (const id of SELECTION) show(id, on);
      picked = on ? [rgiId] : null;
      showOverlays();
      if (!on) api.pin(null);
    },

    /**
     * Select a complex as a glacier is selected, or clear it with null. Its
     * centerlines show once `glacierIds`, its glaciers, are given.
     */
    selectComplex(complexId, glacierIds = []) {
      const on = complexId !== null && complexId !== undefined;
      if (on) {
        map.setFilter("complex-fill", idFilter(complexId));
        map.setFilter("complex-members", ["==", ["get", "complex_id"], complexId]);
        map.setFilter("complex-outline", idFilter(complexId));
        map.setFilter("complex-dot", ["all", POINTS, idFilter(complexId)]);
      }
      for (const id of SELECTION) show(id, on && id === "selection-dim");
      for (const id of COMPLEX) show(id, on);
      picked = on ? glacierIds : null;
      showOverlays();
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

    /**
     * Add or remove the terrain. By default the camera tilts to 3D, or levels
     * and faces north for 2D; with `move: false` it stays where it is.
     */
    setTerrain(on, { move = true } = {}) {
      if (on && !map.getSource("terrain")) {
        map.addSource("terrain", {
          type: "raster-dem",
          url: TERRAIN_TILEJSON,
          tileSize: 512,
          encoding: "terrarium",
        });
      }
      map.setTerrain(on ? { source: "terrain", exaggeration: 1 } : null);
      if (move) map.easeTo(on ? { pitch: TERRAIN_PITCH } : { pitch: 0, bearing: 0 });
    },

    /**
     * Turn the map by `degrees`; a positive turn is counter-clockwise. A turn
     * asked for while the last one runs adds to its target, so quick clicks
     * add up to whole steps.
     */
    rotateBy(degrees) {
      const from = turnTo !== null && map.isMoving() ? turnTo : map.getBearing();
      map.easeTo({ bearing: from + degrees });
      turnTo = from + degrees;
    },

    /** Face north and level the camera. */
    faceNorth() {
      map.easeTo({ bearing: 0, pitch: 0 });
    },

    /** Level the camera and keep its bearing. */
    level() {
      map.easeTo({ pitch: 0 });
    },

    fitBbox({ xmin, ymin, xmax, ymax }, padding, center, options = {}) {
      if (xmax - xmin >= 360 && center) {
        map.jumpTo({ center, zoom: 3 });
        return;
      }
      map.fitBounds(
        [
          [xmin, clampLat(ymin)],
          [xmax, clampLat(ymax)],
        ],
        { padding, ...options },
      );
    },

    /**
     * The properties of the glacier outline under a screen point, or null. The
     * low-zoom dots are not clickable: each stands for the largest of the
     * glaciers in its pixel, so a click there picks one at random.
     */
    glacierAt(point) {
      const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
      const [hit] = map.queryRenderedFeatures([x, y], { layers: ["glaciers-fill"] });
      return hit ? hit.properties : null;
    },

    onMove(callback) {
      map.on("moveend", () => {
        const { lng, lat } = map.getCenter();
        callback({ zoom: map.getZoom(), lat, lon: lng });
      });
    },

    /** Follow the camera's bearing and pitch through every move, gestures and animations alike. */
    onCamera(callback) {
      map.on("move", () => callback({ bearing: map.getBearing(), pitch: map.getPitch() }));
    },

    /**
     * Hear the tilts the reader makes, with the pitch the camera ends at.
     * MapLibre marks a gesture's or a key's events with the input event; the
     * page's own camera moves carry none and are not heard. The callback waits
     * until MapLibre has finished the gesture and the camera is at rest: an
     * ease started inside pitchend would be cut off by the bearing snap that
     * follows it, or would stop the gesture's glide, and a touch tilt ends
     * with a second pitchend after its glide. The last tilt wins.
     */
    onTilt(callback) {
      let latest = 0;
      map.on("pitchend", (event) => {
        if (!event?.originalEvent) return;
        const tilt = ++latest;
        const atRest = () => {
          if (tilt !== latest) return;
          if (map.isMoving()) map.once("moveend", () => setTimeout(atRest, 0));
          else callback(map.getPitch());
        };
        setTimeout(atRest, 0);
      });
    },
  };
  return api;
}

/* The map: base maps, the RGI layers, the selection and the terminus pin. */

import { fetchJson } from "./catalog.js";
import {
  clampLat,
  ESRI_TILES,
  GLYPHS,
  LIBERTY_STYLE,
  MAX_LAT,
  MIN_PICK_PX,
  MIN_VISIBLE_FRACTION,
  startView,
  TERRAIN_TILEJSON,
  TIMEOUT_MS,
} from "./config.js";
import { BASE_PAINT, PALETTE, rgiStyle, TOGGLES } from "./styles.js";
import { PREVIEW_SPAN } from "./viewpreview.js";

/** @typedef {import("maplibre-gl").ExpressionSpecification} ExpressionSpecification */

const SELECTION_RED = "#cc3311";
const DIM_GREY = "#5f6368";
/*
 * How much a selection dims the map around it, per base map. A selection is
 * lifted out of the dimming by drawing its fill again, but over imagery the
 * fill is clear, so the dimming would cover the glacier too: imagery has none.
 */
const DIM_OPACITY = { standard: 0.15, imagery: 0 };
/*
 * A selection's outline: short red dashes over a solid white line, so that the
 * gaps show white and not the glacier's own outline below. It is the same on
 * both base maps, as the outlines are, and wider than an outline or a divide
 * (OUTLINE_WIDTH and DIVIDE_WIDTH in js/styles.js) at every zoom, so that it
 * covers them and a small glacier's selection reads at a glance.
 */
const SELECTION_WIDTH = ["interpolate", ["linear"], ["zoom"], 0, 2.2, 8, 1.8, 10, 2.4, 12, 2.5];
const SELECTION_UNDER = { "line-color": "#ffffff" };
const SELECTION_LINE = { "line-color": SELECTION_RED, "line-dasharray": [1, 0.8] };
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
/*
 * Over imagery each label's colours turn round in lightness, hue kept: dark
 * text in a white halo becomes white text in a dark halo. The text goes into
 * the light half and takes more saturation, so a grey name is a light grey and
 * a water label's blue a light, clear blue. The selection's label and the
 * road shields keep theirs. MapLibre draws text black and halos clear when a
 * style gives none.
 */
const LABEL_DEFAULTS = { "text-color": "#000000", "text-halo-color": "rgba(0, 0, 0, 0)" };

/** The [r, g, b, a] of a CSS hex, rgb() or hsl() colour, 0-1; null for any other value. */
function parseColor(value) {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(color);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
    if (digits.length !== 6 && digits.length !== 8) return null;
    const [r, g, b, a = 255] = digits.match(/../g).map((pair) => parseInt(pair, 16));
    return [r / 255, g / 255, b / 255, a / 255];
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(color);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const number = (part, scale) => (part.endsWith("%") ? parseFloat(part) / 100 : parseFloat(part) / scale);
  const alpha = parts[3] === undefined ? 1 : number(parts[3], 1);
  if (fn[1].startsWith("rgb")) return [number(parts[0], 255), number(parts[1], 255), number(parts[2], 255), alpha];
  const [h, sat, l] = [parseFloat(parts[0]) / 360, number(parts[1], 100), number(parts[2], 100)];
  return [...hslToRgb(h, sat, l), alpha];
}

function hslToRgb(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/* The least lightness of lifted text: a river's blue then sits near Mapbox's satellite water labels'. */
const LIFT_MIN = 0.75;

/**
 * A colour with its HSL lightness turned round, l to 1 - l, as rgba(); an
 * expression with each colour in it turned round; any other value as it is.
 * With `lift`, for text, the lightness goes into the light half, 1 - l / 2 but
 * at least LIFT_MIN, and the saturation half again, so grey and blue names
 * stand out of dark ground.
 */
export function invertLightness(value, lift = false) {
  if (Array.isArray(value)) return value.map((item) => invertLightness(item, lift));
  const rgba = parseColor(value);
  if (!rgba) return value;
  const [r, g, b, a] = rgba;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const [r2, g2, b2] = (lift ? hslToRgb(h, Math.min(1, s * 1.5), Math.max(LIFT_MIN, 1 - l / 2)) : hslToRgb(h, s, 1 - l)).map((c) =>
    Math.round(c * 255),
  );
  return `rgba(${r2}, ${g2}, ${b2}, ${Math.round(a * 1000) / 1000})`;
}

/*
 * The glacier names over imagery take their own blues, not their standard
 * ones turned round: a light step of the ramp on a soft shadow of its darkest,
 * as wide and as soft as their halo on the standard map.
 */
const GLACIER_NAMES_ON_IMAGERY = {
  "text-color": PALETTE.glacierLabelOnImagery,
  "text-halo-color": PALETTE.glacierShadow,
  "text-halo-blur": 1,
};
const GLACIER_NAMES = new Set(["glacier-labels", "complex-labels"]);
/** A label's colours for `base`, from its standard map colours. */
const labelPaint = (id, paint, base) => {
  if (base !== "imagery") return paint;
  if (GLACIER_NAMES.has(id)) return GLACIER_NAMES_ON_IMAGERY;
  return {
    "text-color": invertLightness(paint["text-color"] ?? LABEL_DEFAULTS["text-color"], true),
    "text-halo-color": invertLightness(paint["text-halo-color"] ?? LABEL_DEFAULTS["text-halo-color"]),
    /* Hard over imagery, as Esri's and VersaTiles' halos: a soft one loses light text on snow. */
    "text-halo-blur": 0,
  };
};
const LABEL_KEYS = /** @type {const} */ (["text-color", "text-halo-color", "text-halo-blur"]);
/* A fit that would fly longer than this, in ms, jumps there: a far flight is a long wait. */
const FLY_MAX_MS = 2000;
/** @type {ExpressionSpecification} */
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
/*
 * The catalog's overview rule (rgi-catalog, tiles.py): below zoom 10 a glacier
 * or complex is its outline from the first zoom at which the longer side of its
 * Web Mercator bbox spans 3 pixels of a 512-pixel tile, and RGI's point before.
 * The tiles keep one point per cell of about a pixel, the largest glacier's, so
 * a small selection can be missing from them: the selection draws its own.
 */
const SHAPE_COMPLETE_ZOOM = 10;
const SHAPE_MIN_PX = 3;
const TILE_PX = 512;
const EARTH_RADIUS_M = 6378137;
const MERCATOR_MAX_LAT = 85.0511287798;

/**
 * The zoom from which the tiles hold a glacier or complex as its outline, by
 * the catalog's rule.
 *
 * @param {{ xmin: number, ymin: number, xmax: number, ymax: number }} bbox in degrees
 */
export function shapeMinzoom({ xmin, ymin, xmax, ymax }) {
  const x = (lon) => (EARTH_RADIUS_M * lon * Math.PI) / 180;
  const y = (lat) => {
    const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
    return EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  };
  const extent = Math.max(x(xmax) - x(xmin), y(ymax) - y(ymin));
  const pixel = (zoom) => (2 * Math.PI * EARTH_RADIUS_M) / (TILE_PX * 2 ** zoom);
  for (let zoom = 0; zoom < SHAPE_COMPLETE_ZOOM; zoom++) if (extent >= SHAPE_MIN_PX * pixel(zoom)) return zoom;
  return SHAPE_COMPLETE_ZOOM;
}
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

let protocol = null;

/**
 * The archive at `url`, read with `cache: "no-store"`. Every tile is a range
 * request to the same URL, and Chrome lets one request per URL write a cache
 * entry at a time, so a view's tiles would queue behind that lock instead of
 * loading at once. The data host marks its responses no-cache, so the cache
 * could at best revalidate a read: a round trip either way. pmtiles sets this
 * flag itself only for Chrome on Windows; the lock is not Windows-only. After
 * an ETag mismatch, an archive replaced mid-session, pmtiles reads with
 * cache: "reload" instead.
 */
function uncachedArchive(url) {
  const { FetchSource, PMTiles } = globalThis.pmtiles;
  const source = new FetchSource(url);
  if (!("chromeWindowsNoCache" in source)) console.warn("pmtiles: FetchSource has no chromeWindowsNoCache flag");
  source.chromeWindowsNoCache = true;
  return new PMTiles(source);
}

/** Serves pmtiles:// URLs, the archive at `url` past the HTTP cache. */
function registerProtocol(url) {
  if (!protocol) {
    protocol = new globalThis.pmtiles.Protocol();
    globalThis.maplibregl.addProtocol("pmtiles", protocol.tile);
  }
  if (!protocol.get(url)) protocol.add(uncachedArchive(url));
}

/** Liberty's style, which needs no catalog: start it early and pass the promise to createMap. */
export const fetchLiberty = () => fetchJson(LIBERTY_STYLE);

const isSymbol = (layer) => layer.type === "symbol";

/**
 * The standard map's colours of the text labels, Liberty's and RGI's, by
 * layer ID. A complex's member names copy the glacier labels.
 *
 * @returns {Map<string, Record<string, unknown>>}
 */
function labelColors(liberty, rgi) {
  const labels = new Map(
    [...libertyLayers(liberty), ...rgi.layers]
      /* A road shield's text sits on its own white icon, which it keeps on imagery. */
      .filter((layer) => isSymbol(layer) && layer.layout?.["text-field"] && !layer.id.includes("shield"))
      .map((layer) => [layer.id, Object.fromEntries(LABEL_KEYS.map((key) => [key, layer.paint?.[key]]))]),
  );
  if (labels.has("glacier-labels")) labels.set("complex-labels", labels.get("glacier-labels"));
  return labels;
}
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
 * `covered` names the layers switched off on imagery, which then draw and
 * fetch nothing: all but the labels, the borders too, which belong to the
 * standard map and not to a photo of the ground. The background stays, as
 * it shows while the imagery loads; it turns dark grey there.
 */
function splitLiberty(liberty) {
  const base = libertyLayers(liberty);
  const lastFlat = base.findLastIndex((layer) => !isSymbol(layer));
  const firstBorder = base.findIndex((layer) => layer["source-layer"] === "boundary");
  const cut = firstBorder !== -1 && firstBorder <= lastFlat ? firstBorder : lastFlat + 1;
  const covered = base
    .filter((layer, index) => (index < cut || !isSymbol(layer)) && layer.type !== "background" && layer.layout?.visibility !== "none")
    .map((layer) => layer.id);
  const background = base.find((layer) => layer.type === "background");
  return { base, cut, covered, background };
}

/**
 * One style: Liberty, the imagery layer, the RGI layers and the selection
 * layers. The imagery and the RGI fills and lines go between Liberty's flat
 * layers and its borders and labels (see splitLiberty).
 *
 * @returns {import("maplibre-gl").StyleSpecification}
 */
function buildStyle(liberty, rgi, state) {
  const labels = labelColors(liberty, rgi);
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
  const selectionWidth = { "line-width": SELECTION_WIDTH };
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
      id: "selection-under",
      type: "line",
      source: "data",
      "source-layer": "glaciers",
      layout: NONE,
      paint: { ...SELECTION_UNDER, ...selectionWidth },
    },
    {
      id: "selection-outline",
      type: "line",
      source: "data",
      "source-layer": "glaciers",
      layout: NONE,
      paint: { ...SELECTION_LINE, ...selectionWidth },
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
      id: "complex-under",
      type: "line",
      source: "data",
      "source-layer": "complexes",
      layout: NONE,
      paint: { ...SELECTION_UNDER, ...selectionWidth },
    },
    {
      id: "complex-outline",
      type: "line",
      source: "data",
      "source-layer": "complexes",
      layout: NONE,
      paint: { ...SELECTION_LINE, ...selectionWidth },
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
    /*
     * The selection's own dot at RGI's point, below the zoom at which the tiles
     * hold its outline: there whether or not the tiles kept its point. A filter
     * reads the zoom at whole zooms, as the tiles change.
     */
    {
      id: "selection-point",
      type: "circle",
      source: "selection-point",
      filter: ["<", ["zoom"], ["get", "outline_zoom"]],
      paint: { ...SELECTION_DOT },
    },
    /*
     * The selected glacier's name, in red: its plain name drawn again, on the
     * same line, so it shows only where and when the plain name would. It wins
     * the label collisions, so the plain name below gives way to it.
     */
    {
      id: "selection-label",
      type: "symbol",
      source: "data",
      "source-layer": "glacier-labels",
      ...(glacierLabels?.filter ? { filter: structuredClone(glacierLabels.filter) } : {}),
      layout: {
        ...structuredClone(glacierLabels?.layout ?? {}),
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
      "selection-point": { type: "geojson", data: EMPTY },
    },
    layers: [
      ...base.slice(0, cut),
      esri,
      ...rgiLayers.filter((layer) => !isSymbol(layer)),
      ...base.slice(cut),
      ...rgiLayers.filter(isSymbol),
      ...selection,
    ].map((layer) => (state.base === "imagery" && labels.has(layer.id) ? { ...layer, paint: { ...layer.paint, ...labelPaint(layer.id, labels.get(layer.id), "imagery") } } : layer)),
  };
}

/** MapLibre's padding, a number for every side or some of the sides, as four numbers. */
function sides(padding = 0) {
  if (typeof padding === "number") return { top: padding, right: padding, bottom: padding, left: padding };
  const { top = 0, right = 0, bottom = 0, left = 0 } = padding ?? {};
  return { top, right, bottom, left };
}

/*
 * How many screen pixels apart a place and the place unproject finds at its
 * screen point may be and still count as one: the terrain's depth is coarse.
 */
const SAME_PLACE_PX = 4;
/* A bbox is drawn on screen as the box around this many points along each side, corners included. */
const BBOX_SAMPLES = 5;

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

  /* The last picture, kept while the view and size it shows stay the same: an idle without a move asks again. */
  let last = null;
  return async function picture({ center, zoom }, size) {
    const key = `${center}|${zoom}|${size}`;
    if (last?.key === key) return last.url;
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
      const url = (await settled) ? mini.getCanvas().toDataURL("image/jpeg", 0.85) : null;
      last = url ? { key, url } : null;
      return url;
    } catch (error) {
      console.warn("standard picture:", error.message);
      return null;
    }
  };
}

/**
 * Builds the map and resolves once its style has loaded, while the first
 * view's tiles still arrive: the page's controls need the style's layers, not
 * the tiles. MapLibre's `load` waits for every tile in view, seconds on a slow
 * data host. The RGI layers share one source, the catalog's PMTiles file.
 * `liberty` is the promise of fetchLiberty.
 */
export async function createMap(container, catalog, state, liberty = fetchLiberty()) {
  liberty = await liberty;
  const rgi = rgiStyle(catalog.collections.glaciers.pmtilesUrl);
  const labels = labelColors(liberty, rgi);
  /** The plain glacier names' filter: their lines, one per zoom, which the selection's name follows. */
  const NAME_LINES = /** @type {ExpressionSpecification} */ (rgi.layers.find((layer) => layer.id === "glacier-labels")?.filter ?? true);

  registerProtocol(catalog.collections.glaciers.pmtilesUrl);
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
  /** @type {Promise<void>} */
  const loaded = new Promise((resolve, reject) => {
    const fail = (event) => {
      if (event?.sourceId || event?.tile) return;
      map.off("error", fail);
      reject(event?.error ?? new Error("The map failed to load"));
    };
    map.on("error", fail);
    map.once("style.load", () => {
      map.off("error", fail);
      resolve();
    });
  });
  await loaded;

  const rgiToggles = rgi.layers.map((layer) => [layer.id, toggleOf(layer)]).filter(([, n]) => n);
  /** @type {(id: string) => ExpressionSpecification} */
  const idFilter = (id) => ["==", ["get", "rgi_id"], id];
  const SELECTION = ["selection-dim", "selection-fill", "selection-under", "selection-outline", "selection-dot", "selection-label"];
  const COMPLEX = ["complex-fill", "complex-members", "complex-labels", "complex-under", "complex-outline", "complex-dot"];
  const show = (id, on) => map.setLayoutProperty(id, "visibility", visibility(on));
  /* The toggles that are on, and the glaciers whose centerlines the selection draws again. */
  const toggles = new Set(state.layers);
  let picked = null;
  /* The glacier or complex whose own dot the selection-point layer draws. */
  let pointId = null;
  const setPoint = (id, feature) => {
    pointId = id;
    /** @type {import("maplibre-gl").GeoJSONSource} */ (map.getSource("selection-point")).setData(feature ?? EMPTY);
  };
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
  /*
   * Each camera request takes the next number: every camera method below, and
   * each move by the reader, which MapLibre marks with its input event. A fit
   * that waits for a read moves the camera only if no request came after it.
   */
  let requests = 0;
  map.on("movestart", (event) => {
    if (event?.originalEvent) requests += 1;
  });

  /*
   * Whether `lonLat`, drawn at the screen `point`, is on the near side of the
   * globe. A place on the far side projects onto the near side's disc, so the
   * place must also come back from its screen point: unproject finds the
   * near-side place there.
   */
  const nearSide = ([lng, lat], { x, y }) => {
    const back = map.unproject([x, y]);
    /* Degrees per pixel along a parallel, and along a meridian in Mercator: both shrink with its cosine. */
    const cos = Math.abs(Math.cos((lat * Math.PI) / 180));
    const perPx = (360 / (512 * 2 ** map.getZoom())) * cos;
    const dLng = ((((back.lng - lng) % 360) + 540) % 360) - 180;
    return Math.hypot(dLng * cos, back.lat - lat) <= SAME_PLACE_PX * perPx;
  };

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
      /* A selection's centerlines and a complex's member outlines copy the plain layers' paint. */
      const copies = [["complex-members", "glaciers-outline"], ...SELECTION_OVERLAYS.map((id) => [`selection-${id}`, id])];
      for (const [id, plain] of [...Object.keys(paint).map((id) => [id, id]), ...copies]) {
        for (const [key, value] of Object.entries(paint[plain] ?? {})) {
          map.setPaintProperty(id, /** @type {Parameters<typeof map.setPaintProperty>[1]} */ (key), value);
        }
      }
      for (const [id, colors] of labels) {
        for (const [key, value] of Object.entries(labelPaint(id, colors, base))) {
          map.setPaintProperty(id, /** @type {Parameters<typeof map.setPaintProperty>[1]} */ (key), value);
        }
      }
      /* The selections redraw the glacier fill above the dimming. */
      map.setPaintProperty("selection-dim", "fill-opacity", DIM_OPACITY[base]);
      map.setSky(sky(base));
      map.setPaintProperty("selection-fill", "fill-opacity", paint["glaciers-fill"]["fill-opacity"]);
      map.setPaintProperty("complex-fill", "fill-opacity", paint["glaciers-fill"]["fill-opacity"]);
    },

    setToggle(name, on) {
      for (const [id, owner] of rgiToggles) if (owner === name) show(id, on);
      if (on) toggles.add(name);
      else toggles.delete(name);
      showOverlays();
    },

    select(rgiId) {
      const on = rgiId !== null && rgiId !== undefined;
      if (rgiId !== pointId) setPoint(null);
      if (on) {
        map.setFilter("selection-fill", idFilter(rgiId));
        map.setFilter("selection-under", idFilter(rgiId));
        map.setFilter("selection-outline", idFilter(rgiId));
        map.setFilter("selection-dot", ["all", POINTS, idFilter(rgiId)]);
        map.setFilter("selection-label", ["all", NAME_LINES, idFilter(rgiId)]);
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
      if (complexId !== pointId) setPoint(null);
      if (on) {
        map.setFilter("complex-fill", idFilter(complexId));
        map.setFilter("complex-members", ["==", ["get", "complex_id"], complexId]);
        map.setFilter("complex-under", idFilter(complexId));
        map.setFilter("complex-outline", idFilter(complexId));
        map.setFilter("complex-dot", ["all", POINTS, idFilter(complexId)]);
      }
      for (const id of SELECTION) show(id, on && id === "selection-dim");
      for (const id of COMPLEX) show(id, on);
      picked = on ? glacierIds : null;
      showOverlays();
    },

    /**
     * Draw the dot of the selected glacier or complex `id` from its row, at
     * RGI's point and below the zoom of its outline, as the catalog's tiles
     * do. A row without a point or bbox draws none. Selecting another ID or
     * none clears it.
     *
     * @param {string} id
     * @param {{ cenlon?: number, cenlat?: number, bbox?: { xmin: number, ymin: number, xmax: number, ymax: number } } | null} row
     */
    selectPoint(id, row) {
      const { cenlon, cenlat, bbox } = row ?? {};
      const known = [cenlon, cenlat].every(Number.isFinite) && bbox && ["xmin", "ymin", "xmax", "ymax"].every((key) => Number.isFinite(bbox[key]));
      setPoint(
        id,
        known
          ? {
              type: "Feature",
              properties: { outline_zoom: shapeMinzoom(bbox) },
              geometry: { type: "Point", coordinates: [cenlon, cenlat] },
            }
          : null,
      );
    },

    pin(lonLat) {
      /** @type {import("maplibre-gl").GeoJSONSource} */ (map.getSource("pin")).setData(
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
      if (!move) return;
      requests += 1;
      map.easeTo(on ? { pitch: TERRAIN_PITCH } : { pitch: 0, bearing: 0 });
    },

    /**
     * Turn the map by `degrees`; a positive turn is counter-clockwise. A turn
     * asked for while the last one runs adds to its target, so quick clicks
     * add up to whole steps.
     */
    rotateBy(degrees) {
      requests += 1;
      const from = turnTo !== null && map.isMoving() ? turnTo : map.getBearing();
      map.easeTo({ bearing: from + degrees });
      turnTo = from + degrees;
    },

    /** Face north and level the camera. */
    faceNorth() {
      requests += 1;
      map.easeTo({ bearing: 0, pitch: 0 });
    },

    /** Level the camera and keep its bearing. */
    level() {
      requests += 1;
      map.easeTo({ pitch: 0 });
    },

    /**
     * Whether `lonLat` shows on the canvas less `padding`, the edges that the
     * panels cover (MapLibre's padding: a number or `{ top, right, bottom, left }`),
     * on the near side of the globe.
     */
    inView(lonLat, padding) {
      const { top, right, bottom, left } = sides(padding);
      const canvas = map.getCanvas();
      const point = map.project(lonLat);
      const { x, y } = point;
      if (!(x >= left && x <= canvas.clientWidth - right && y >= top && y <= canvas.clientHeight - bottom)) return false;
      return nearSide(lonLat, point);
    },

    /**
     * How well `bbox` shows on the canvas less `padding` (as for inView), or
     * null where it shows nowhere: 360° or more wide, or with a part on the
     * globe's far side or where MapLibre cannot draw it. On screen the bbox is
     * the box around its projected edges. `fraction` is the share of that box
     * in the open map, `sizePx` its larger side in CSS pixels, and `fits`
     * whether it fits in the open map at all. A bbox across the antimeridian
     * runs on past 180°; it is measured at its copy next to the view's centre.
     */
    bboxVisibility({ xmin, ymin, xmax, ymax }, padding) {
      const east = xmax < xmin ? xmax + 360 : xmax;
      if (east - xmin >= 360) return null;
      const turn = Math.round((map.getCenter().lng - (xmin + east) / 2) / 360) * 360;
      const drawn = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const step = BBOX_SAMPLES - 1;
      for (let i = 0; i <= step; i += 1) {
        for (let j = 0; j <= step; j += 1) {
          /** @type {[number, number]} */
          const place = [xmin + turn + ((east - xmin) * i) / step, clampLat(ymin + ((ymax - ymin) * j) / step)];
          const point = map.project(place);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !nearSide(place, point)) return null;
          drawn.x0 = Math.min(drawn.x0, point.x);
          drawn.y0 = Math.min(drawn.y0, point.y);
          drawn.x1 = Math.max(drawn.x1, point.x);
          drawn.y1 = Math.max(drawn.y1, point.y);
        }
      }
      const { top, right, bottom, left } = sides(padding);
      const canvas = map.getCanvas();
      const open = { x0: left, y0: top, x1: canvas.clientWidth - right, y1: canvas.clientHeight - bottom };
      /* The share of the span a0..a1 inside b0..b1; a span of no length is in or out. */
      const share = (a0, a1, b0, b1) =>
        a1 > a0 ? Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / (a1 - a0) : Number(a0 >= b0 && a0 <= b1);
      const [width, height] = [drawn.x1 - drawn.x0, drawn.y1 - drawn.y0];
      return {
        fraction: share(drawn.x0, drawn.x1, open.x0, open.x1) * share(drawn.y0, drawn.y1, open.y0, open.y1),
        sizePx: Math.max(width, height),
        fits: width <= open.x1 - open.x0 && height <= open.y1 - open.y0,
      };
    },

    /**
     * Whether a picked glacier's or complex's `bbox` needs a fit to be seen
     * well on the canvas less `padding`: when less than MIN_VISIBLE_FRACTION
     * of it shows, when it is under MIN_PICK_PX across, too small to make out,
     * or when it is larger than the open map, which a fit zooms out to show.
     */
    needsFit(bbox, padding) {
      const seen = api.bboxVisibility(bbox, padding);
      return seen === null || seen.fraction < MIN_VISIBLE_FRACTION || seen.sizePx < MIN_PICK_PX || !seen.fits;
    },

    /**
     * Ease the map so `lonLat` lands in the middle of the canvas less `padding`,
     * at the same zoom, bearing and pitch. MapLibre's own `padding` would stay
     * on the map after the move, so the point is placed by an offset instead.
     */
    centerOn(lonLat, padding) {
      requests += 1;
      const { top, right, bottom, left } = sides(padding);
      map.easeTo({ center: lonLat, offset: [(left - right) / 2, (top - bottom) / 2] });
    },

    fitBbox({ xmin, ymin, xmax, ymax }, padding, options = {}) {
      requests += 1;
      map.fitBounds(
        [
          [xmin, clampLat(ymin)],
          [xmax, clampLat(ymax)],
        ],
        /*
         * MapLibre's fit faces north unless told otherwise; it keeps the
         * reader's turn instead. A flight longer than FLY_MAX_MS jumps.
         */
        { padding, bearing: map.getBearing(), maxDuration: FLY_MAX_MS, ...options },
      );
    },

    jumpTo(options) {
      requests += 1;
      map.jumpTo(options);
    },

    zoomIn() {
      requests += 1;
      map.zoomIn();
    },

    zoomOut() {
      requests += 1;
      map.zoomOut();
    },

    /**
     * Run `move` with what `read` resolves to, unless a camera request came
     * after this call; a later fitLater is one too. A failed read moves
     * nothing. The promise returned settles once `move` has run or been dropped.
     */
    fitLater(read, move) {
      const mine = ++requests;
      return read.then(
        (value) => {
          if (mine === requests) move(value);
        },
        () => {},
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

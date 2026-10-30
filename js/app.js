/*
 * Startup and wiring. Reads the page state and the catalog, builds the map,
 * and connects the search, the controls, the status line, the glacier card, the
 * complex panel and "Use this data". Every change of state is written back to the page address.
 */

import { mountCard } from "./card.js";
import { loadCatalog } from "./catalog.js";
import { mountComplexCard } from "./complexcard.js";
import { CATALOG_URL, resolveCatalogUrl, TIMEOUT_MS } from "./config.js";
import { mountLayers, mountTerrain, mountZoom } from "./layers.js";
import { createMap } from "./map.js";
import { groupOfKey, openParquet, readColumns, readRow, rowGroupOf, SEARCH_COLUMNS } from "./parquet.js";
import { findPhotos } from "./photo.js";
import { buildGlacierIndex } from "./search.js";
import { mountSearch } from "./searchbox.js";
import { initSheet, popupPadding, setSheetOpen } from "./sheet.js";
import { parseState, writeState } from "./state.js";
import { mountStatus } from "./status.js";
import { el, PHONE } from "./ui.js";
import { mountUseData } from "./usedata.js";

const CARD_WIDTH = 408;
const GAP = 24;
/* The phone's search bar covers the top of the map. */
const PHONE_TOP = 72;
const PLACE_ZOOM = 12;
/*
 * The imagery crop at twice the photo's CSS size. On desktop the search bar
 * covers the photo's top 72px, so the glacier sits in the rows below.
 */
const DESKTOP_CROP = { size: [816, 560], top: 144 };
const PHONE_CROP = { size: [816, 400], top: 0 };
const NOTICE_MS = 2000;
const REGION_COLUMNS = ["level", "o1region", "o2region", "full_name", "bbox"];
const FACT_COLUMNS = ["bbox", "glims_id"];
const COMPLEX_COLUMNS = ["rgi_id", "o1region", "o2region", "cenlon", "cenlat", "utm_zone", "area_km2", "glacier_ids", "bbox"];
const CATALOG_ERROR = "The catalog could not be loaded.";
const MAP_ERROR = "The map could not be loaded.";

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

const state = parseState(new URL(location.href));
const hadView = state.view !== null;

function save() {
  history.replaceState(null, "", writeState(state, new URL(location.href)));
}

const isBbox = (bbox) =>
  Boolean(bbox) && ["xmin", "ymin", "xmax", "ymax"].every((key) => Number.isFinite(bbox[key]));

/** Row objects from a table of columns. */
function rowsOf(columns) {
  const names = Object.keys(columns);
  return columns[names[0]].map((_, i) => Object.fromEntries(names.map((name) => [name, columns[name][i]])));
}

/** The regions table as row objects. */
async function loadRegions(url) {
  return rowsOf(await readColumns(await openParquet(url), REGION_COLUMNS));
}

/**
 * The glaciers GeoParquet, opened on first use, and its search index, read on
 * first use. A failed open or read is tried again on the next use.
 */
function glacierFile(url, regionNames) {
  let opening = null;
  let indexing = null;
  const file = {
    handle: null,
    open() {
      opening ??= openParquet(url).then(
        (handle) => {
          file.handle = handle;
          return handle;
        },
        (error) => {
          opening = null;
          throw error;
        },
      );
      return opening;
    },
    index() {
      indexing ??= file
        .open()
        .then((handle) => readColumns(handle, SEARCH_COLUMNS))
        .then((columns) => buildGlacierIndex(columns, regionNames))
        .catch((error) => {
          indexing = null;
          throw error;
        });
      return indexing;
    },
    /** The row of an RGI ID, or null when the index does not hold it or cannot be read. */
    async rowOf(rgiId) {
      try {
        return (await file.index()).byId.get(rgiId) ?? null;
      } catch {
        return null;
      }
    },
    /** The bbox and GLIMS ID of a glacier, `{}` when its row is unknown. */
    async factsOf(glacier) {
      const row = glacier.row ?? (await file.rowOf(glacier.rgiId));
      if (row === null || row === undefined) return {};
      return readRow(await file.open(), row, FACT_COLUMNS);
    },
  };
  return file;
}

/**
 * The complexes GeoParquet, opened on first use. The file is sorted by ID, so a
 * complex's row group comes from the ID statistics and one group is read.
 */
function complexFile(url) {
  let opening = null;
  const open = () => {
    opening ??= openParquet(url).catch((error) => {
      opening = null;
      throw error;
    });
    return opening;
  };
  return {
    /** The complex's row, null when the file does not hold it; rejects when the file cannot be read. */
    async read(complexId) {
      const handle = await open();
      const group = groupOfKey(handle, "rgi_id", complexId);
      if (group === -1) return null;
      const columns = await readColumns(handle, COMPLEX_COLUMNS, group);
      const at = columns.rgi_id.indexOf(complexId);
      return at === -1 ? null : Object.fromEntries(COMPLEX_COLUMNS.map((name) => [name, columns[name][at]]));
    },
  };
}

/**
 * The glaciers of a complex with their names and areas, largest first. Names
 * come from the search index; areas from the glaciers file, one read per row
 * group that holds a member. A glacier that cannot be placed keeps its ID only.
 */
async function membersOf(props, glaciers) {
  const ids = props.glacier_ids ?? [];
  let index = null;
  let handle = null;
  try {
    index = await glaciers.index();
    handle = await glaciers.open();
  } catch (error) {
    console.warn("complex members:", error.message);
  }
  const rows = ids.map((rgiId) => index?.byId.get(rgiId));
  const areas = new Map();
  const groups = handle ? new Set(rows.filter((row) => row !== undefined).map((row) => rowGroupOf(handle, row))) : [];
  await Promise.all(
    [...groups].map(async (group) => {
      try {
        const { area_km2: values } = await readColumns(handle, ["area_km2"], group);
        values.forEach((area, i) => areas.set(handle.groups[group].start + i, area));
      } catch (error) {
        console.warn("complex member areas:", error.message);
      }
    }),
  );
  const nameOf = (row) => index.cols.display_name[row] ?? index.cols.glac_name[row] ?? null;
  return ids
    .map((rgiId, i) => ({
      rgiId,
      name: rows[i] === undefined ? null : nameOf(rows[i]),
      area: areas.get(rows[i]) ?? null,
    }))
    .sort((a, b) => (b.area ?? -Infinity) - (a.area ?? -Infinity));
}

/** Resolve on the map's next idle, after TIMEOUT_MS, or on abort, whichever comes first. */
function nextIdle(map, signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      map.off("idle", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, TIMEOUT_MS);
    map.on("idle", done);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** A map with its tiles loaded and no camera move under way, which fires no further idle. */
const isSettled = (map) => map.loaded() && !map.isMoving();

/** Every ring of the glacier's rendered pieces, from all tiles that hold one; none on error. */
function ringsOf(map, rgiId) {
  let pieces;
  try {
    pieces = map.querySourceFeatures("data", {
      sourceLayer: "glaciers",
      filter: ["==", ["get", "rgi_id"], rgiId],
    });
  } catch (error) {
    console.warn("outline pieces:", error.message);
    return [];
  }
  return pieces.flatMap(({ geometry }) => {
    if (geometry?.type === "Polygon") return geometry.coordinates;
    if (geometry?.type === "MultiPolygon") return geometry.coordinates.flat();
    return [];
  });
}

/**
 * @param {string | null} customCatalog  the host of a catalog that ?catalog=
 *   chose instead of the published one, or null
 */
function wire(catalog, rgiMap, regions, customCatalog) {
  const phone = PHONE.matches;
  const { map } = rgiMap;
  const regionNames = new Map(
    regions.filter((region) => Number(region.level) === 1).map((region) => [region.o1region, region.full_name]),
  );
  const glaciers = glacierFile(catalog.collections.glaciers.dataUrl, regionNames);
  const complexes = complexFile(catalog.collections.complexes.dataUrl);
  if (state.terrain) rgiMap.setTerrain(true);

  const notice = el("notice");
  let noticeTimer = null;
  const announce = (text) => {
    notice.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.textContent = "";
    }, NOTICE_MS);
  };

  let status = null;
  const layers = mountLayers(el("layers"), {
    base: state.base,
    layers: state.layers,
    map,
    standardPicture: (px) => rgiMap.standardPicture(px),
    zoom: () => map.getZoom(),
    onBase(base) {
      state.base = base;
      rgiMap.setBase(base);
      save();
      status?.refresh();
    },
    onToggle(name, on) {
      if (on) state.layers.add(name);
      else state.layers.delete(name);
      rgiMap.setToggle(name, on);
      save();
    },
  });
  mountTerrain(el("controls"), {
    on: state.terrain,
    onChange(on) {
      state.terrain = on;
      rgiMap.setTerrain(on);
      save();
      status?.refresh();
    },
  });
  mountZoom(el("controls"), rgiMap);
  status = mountStatus(el("status"), rgiMap, catalog, () => ({ ...state, customCatalog }));
  rgiMap.onMove((view) => {
    state.view = view;
    save();
    layers.refreshZoom();
  });

  /* The glacier on the card, and the fit that a search pick started for it. */
  let shown = null;
  /* The ID of the complex on the complex panel. Only one of the two is open. */
  let shownComplex = null;
  let fitting = null;
  /*
   * Each explicit camera request takes the next number. A fit that waits for a
   * read moves the camera only if no request came after it.
   */
  let camera = 0;

  /* A drag, pinch or wheel move is a camera request too, so a pending fit is dropped. */
  map.on("movestart", (event) => {
    if (event?.originalEvent) camera += 1;
  });

  const padding = () => {
    if (phone) return { top: PHONE_TOP, right: GAP, bottom: (popupPadding()?.bottom ?? 0) + GAP, left: GAP };
    return { top: GAP, right: GAP, bottom: GAP, left: (shown || shownComplex ? CARD_WIDTH : 0) + GAP };
  };
  const fitTo = (bbox) => rgiMap.fitBbox(bbox, padding());

  /** Fit the glacier's bbox once its read returns, unless another camera request came first. */
  function fitGlacierLater(glacier) {
    const mine = ++camera;
    return glaciers.factsOf(glacier).then(
      (facts) => {
        if (mine === camera && shown === glacier && isBbox(facts.bbox)) fitTo(facts.bbox);
      },
      () => {},
    );
  }

  /* Photos wait for the fit and the tiles it loads, so the outline pieces are on the map. */
  async function photosOf(glacier, signal) {
    const facts = await glaciers.factsOf(glacier).catch(() => ({}));
    const props = { ...glacier.props };
    for (const [key, value] of Object.entries(facts)) if (value !== null && value !== undefined) props[key] = value;
    if (!isBbox(props.bbox) || signal.aborted) return [];
    await fitting;
    if (!isSettled(map)) await nextIdle(map, signal);
    if (signal.aborted) return [];
    return findPhotos({ rgiId: glacier.rgiId, props }, ringsOf(map, glacier.rgiId), { signal });
  }

  const useData = mountUseData(phone ? el("sheet") : document.body, { catalog });

  let cardRoot = el("card");
  let band = null;
  if (phone) {
    el("card").hidden = true;
    cardRoot = el("sheet-body");
    band = el("sheet-head");
  }
  initSheet();

  function showCard(on) {
    document.body.classList.toggle("card-open", on);
    if (phone) el("sheet").hidden = !on;
  }

  function closeGlacier() {
    shown = null;
    fitting = null;
    state.glacier = null;
    save();
    rgiMap.select(null);
    search.setClosable(null);
    search.clear();
    useData.close();
    card.close();
    showCard(false);
  }

  const card = mountCard(cardRoot, {
    catalog,
    regions,
    band,
    crop: phone ? PHONE_CROP : DESKTOP_CROP,
    parquet: {
      get handle() {
        return glaciers.handle;
      },
      rowOf: (rgiId) => glaciers.rowOf(rgiId),
    },
    photos: photosOf,
    onClose: closeGlacier,
    onZoom(bbox) {
      if (isBbox(bbox)) {
        camera += 1;
        fitTo(bbox);
      } else if (shown) fitGlacierLater(shown);
    },
    async onShare() {
      try {
        await globalThis.navigator.clipboard.writeText(location.href);
      } catch {
        return;
      }
      announce("Link copied");
    },
    onUseData(glacier) {
      if (phone) setSheetOpen(true);
      useData.open({ kind: "glacier", rgiId: glacier.rgiId, o1region: glacier.props?.o1region });
    },
    onAction(action) {
      if (action.type === "pin") rgiMap.pin(action.lonlat);
      else if (action.type === "complex") {
        /* The search text names the glacier this replaces. */
        search.clear();
        openComplex(action.id, true);
      }
    },
  });

  const complexCard = mountComplexCard(cardRoot, {
    catalog,
    regions,
    band,
    crop: phone ? PHONE_CROP : DESKTOP_CROP,
    read: (complexId) => complexes.read(complexId),
    members: (props) => membersOf(props, glaciers),
    onClose: closeComplex,
    onZoom(bbox) {
      if (isBbox(bbox)) {
        camera += 1;
        fitTo(bbox);
      } else if (shownComplex) fitComplexLater(shownComplex);
    },
    async onShare() {
      try {
        await globalThis.navigator.clipboard.writeText(location.href);
      } catch {
        return;
      }
      announce("Link copied");
    },
    onUseData(target) {
      if (phone) setSheetOpen(true);
      useData.open(target);
    },
    onOpenGlacier(rgiId) {
      search.clear();
      openGlacier({ rgiId }, true);
    },
  });

  /** Fit the whole complex once its read returns, unless another camera request came first. */
  function fitComplexLater(complexId) {
    const mine = ++camera;
    complexes.read(complexId).then(
      (props) => {
        if (mine === camera && shownComplex === complexId && isBbox(props?.bbox)) fitTo(props.bbox);
      },
      () => {},
    );
  }

  /** Open a complex's panel in place of any glacier card and select it; with `fit`, fit the map to it. */
  function openComplex(complexId, fit) {
    if (shown) {
      shown = null;
      fitting = null;
      card.close();
    }
    useData.close();
    shownComplex = complexId;
    state.glacier = null;
    state.complex = complexId;
    save();
    rgiMap.select(null);
    rgiMap.selectComplex(complexId);
    showCard(true);
    if (!phone) search.setClosable(closeComplex);
    if (fit) fitComplexLater(complexId);
    complexCard.open(complexId);
    if (phone) setSheetOpen(false);
  }

  function closeComplex() {
    shownComplex = null;
    state.complex = null;
    save();
    rgiMap.selectComplex(null);
    search.setClosable(null);
    search.clear();
    useData.close();
    complexCard.close();
    showCard(false);
  }

  /** Open a glacier's card and select it; with `fit`, fit the map to its bbox. */
  function openGlacier(glacier, fit) {
    /* A page holds one of the two, also while a shared complex is still being read. */
    state.complex = null;
    if (shownComplex) {
      shownComplex = null;
      useData.close();
      complexCard.close();
    }
    shown = glacier;
    state.glacier = glacier.rgiId;
    save();
    rgiMap.pin(null);
    rgiMap.select(glacier.rgiId);
    showCard(true);
    if (!phone) search.setClosable(closeGlacier);
    fitting = fit ? fitGlacierLater(glacier) : null;
    card.open(glacier);
    if (phone) setSheetOpen(false);
  }

  map.on("click", (event) => {
    const props = rgiMap.glacierAt(event.point);
    if (props?.rgi_id) openGlacier({ rgiId: props.rgi_id, props }, false);
    else if (shown) closeGlacier();
    else if (shownComplex) closeComplex();
  });

  const search = mountSearch(el("search"), {
    onPick(hit) {
      if (hit.kind === "glacier") {
        openGlacier({ rgiId: hit.rgiId, row: hit.row }, true);
      } else if (hit.kind === "complex") {
        openComplex(hit.complexId, true);
      } else if (hit.kind === "region" && isBbox(hit.bbox)) {
        camera += 1;
        fitTo(hit.bbox);
      } else if (hit.kind === "place") {
        camera += 1;
        map.jumpTo({ center: hit.center, zoom: PLACE_ZOOM });
      }
    },
    loadGlacierIndex: () => glaciers.index(),
    regions,
    view() {
      const { lng, lat } = map.getCenter();
      return { lat, lon: lng, zoom: map.getZoom() };
    },
  });

  /* A shared link's glacier opens once the index places it; an ID it lacks is dropped. */
  if (state.glacier) {
    const rgiId = state.glacier;
    glaciers.index().then(
      (index) => {
        if (state.glacier !== rgiId || shown) return;
        const row = index.byId.get(rgiId);
        if (row === undefined) {
          state.glacier = null;
          save();
          return;
        }
        openGlacier({ rgiId, row }, !hadView);
      },
      (error) => console.warn("glacier index:", error.message),
    );
  }

  /* A shared link's complex opens once its row is read; an ID the file lacks is dropped. */
  if (state.complex) {
    const complexId = state.complex;
    complexes.read(complexId).then(
      (props) => {
        if (state.complex !== complexId || shownComplex || shown) return;
        if (!props) {
          state.complex = null;
          save();
          return;
        }
        openComplex(complexId, !hadView);
      },
      (error) => console.warn("complex:", error.message),
    );
  }
}

function fail(message, error) {
  el("notice").textContent = message;
  console.error("startup:", error);
}

async function start() {
  save();
  const catalogUrl = resolveCatalogUrl(new URLSearchParams(location.search));
  let catalog;
  try {
    catalog = await loadCatalog(catalogUrl);
  } catch (error) {
    fail(CATALOG_ERROR, error);
    return;
  }
  const [mapResult, regionsResult] = await Promise.allSettled([
    createMap(el("map"), catalog, state),
    loadRegions(catalog.collections.regions.dataUrl),
  ]);
  if (regionsResult.status === "rejected") {
    fail(CATALOG_ERROR, regionsResult.reason);
    return;
  }
  if (mapResult.status === "rejected") {
    fail(MAP_ERROR, mapResult.reason);
    return;
  }
  try {
    wire(catalog, mapResult.value, regionsResult.value, catalogUrl === CATALOG_URL ? null : new URL(catalogUrl).host);
  } catch (error) {
    fail(MAP_ERROR, error);
  }
}

start();

/*
 * Startup and wiring. Reads the page state and the catalog, builds the map,
 * and connects the search, the controls, the status line, the glacier card, the
 * complex panel and "Use this data". Every change of state is written back to the page address.
 */

import { mountCard } from "./card.js";
import { loadCatalog } from "./catalog.js";
import { mountCompass } from "./compass.js";
import { mountComplexCard } from "./complexcard.js";
import { resolveCatalogUrl, SAMPLE_GLACIER, TIMEOUT_MS } from "./config.js";
import { mountLayers, mountTerrain, mountZoom } from "./layers.js";
import { createMap } from "./map.js";
import { groupOfKey, openParquet, readColumns, readRow, rowGroupOf, SEARCH_COLUMNS } from "./parquet.js";
import { findPhotos } from "./photo.js";
import { buildGlacierIndex } from "./search.js";
import { mountSearch } from "./searchbox.js";
import { initSheet, popupPadding, setSheetLevel } from "./sheet.js";
import { parseState, writeState } from "./state.js";
import { mountStatus } from "./status.js";
import { mountTour } from "./tour.js";
import { el, PHONE, scrollbarWidth } from "./ui.js";
import { mountUseData } from "./usedata.js";
import { onViewerToggle } from "./viewer.js";
import { mountHelp, mountWelcome, welcomeTitle } from "./welcome.js";

const CARD_WIDTH = 408;
const GAP = 24;
/* The phone's search bar covers the top of the map. */
const PHONE_TOP = 72;
const PLACE_ZOOM = 12;
/*
 * A glacier or complex fit leaves this share of its size free on every side,
 * and stops at FIT_MAX_ZOOM, so the map around it shows for orientation.
 */
const FIT_MARGIN = 0.5;
const FIT_MAX_ZOOM = 15;
/*
 * How a glacier or complex that opens moves the map: ALWAYS fits it, as a
 * shared link without a view does; IF_NEEDED fits it only when it is not
 * already well in view (see needsFit in map.js), as a pick on the map, in a
 * panel or in search does. A falsy fit leaves the map alone.
 */
const ALWAYS = "always";
const IF_NEEDED = "if-needed";
/*
 * The imagery crop at twice the photo's CSS size. On desktop the search bar
 * covers the photo's top 72px, so the glacier sits in the rows below.
 */
const DESKTOP_CROP = { size: [816, 560], top: 144 };
const PHONE_CROP = { size: [720, 360], top: 0 };
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

/*
 * The desktop sidebar's scrollbar, kept outside its 408px content by
 * --sidebar-w in style.css. Browser zoom changes its width, so a resize
 * measures again. The phone shows no sidebar.
 */
const sidebarScrollbar = () => (PHONE.matches ? 0 : scrollbarWidth(el("card")));
function measureScrollbar() {
  document.documentElement.style.setProperty("--scrollbar", `${sidebarScrollbar()}px`);
}
measureScrollbar();
window.addEventListener("resize", measureScrollbar);
PHONE.addEventListener("change", measureScrollbar);

const state = parseState(new URL(location.href));
/* A tilt by hand past this many degrees turns 3D on; one that ends below it levels the map and turns 3D off. */
const TILT_3D = 5;
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
    /**
     * The row of an RGI ID from its row group alone: the file is sorted by ID,
     * so the ID statistics name one group and only its IDs are read. Null when
     * the file does not hold it; rejects when the file cannot be read.
     */
    async find(rgiId) {
      const handle = await file.open();
      const group = groupOfKey(handle, "rgi_id", rgiId);
      if (group === -1) return null;
      const { rgi_id: ids } = await readColumns(handle, ["rgi_id"], group);
      const at = ids.indexOf(rgiId);
      return at === -1 ? null : handle.groups[group].start + at;
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
  /* The last complex read, which the panel, the fit and the map share. */
  let last = null;
  const open = () => {
    opening ??= openParquet(url).catch((error) => {
      opening = null;
      throw error;
    });
    return opening;
  };
  return {
    /** The complex's row, null when the file does not hold it; rejects when the file cannot be read. */
    read(complexId) {
      if (last?.complexId === complexId) return last.row;
      const row = (async () => {
        const handle = await open();
        const group = groupOfKey(handle, "rgi_id", complexId);
        if (group === -1) return null;
        const columns = await readColumns(handle, COMPLEX_COLUMNS, group);
        const at = columns.rgi_id.indexOf(complexId);
        return at === -1 ? null : Object.fromEntries(COMPLEX_COLUMNS.map((name) => [name, columns[name][at]]));
      })();
      const mine = { complexId, row };
      last = mine;
      row.catch(() => {
        if (last === mine) last = null;
      });
      return row;
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
  const nameOf = (row) => index.cols.display_name[row] ?? null;
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

function wire(catalog, rgiMap, regions) {
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
    backgrounds: rgiMap.backgrounds,
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
  /* First in #controls, so the desktop column and its Tab order start with it. */
  const compass = mountCompass(el("controls"), {
    onRotate: (degrees) => rgiMap.rotateBy(degrees),
    onReset() {
      if (state.terrain) threeD(false, true);
      else rgiMap.faceNorth();
    },
  });
  const showCompass = () =>
    compass.update({ bearing: map.getBearing(), pitch: map.getPitch(), terrain: state.terrain });
  const terrain = mountTerrain(el("controls"), {
    on: state.terrain,
    onChange: (on) => threeD(on, true),
  });
  /*
   * The one way the page switches 3D: the 3D button, the compass and a tilt by
   * hand all come here, so the button, the address and the compass
   * agree. `move` lets the camera tilt or level with it; a tilt by hand leaves
   * the camera where the reader put it.
   */
  function threeD(on, move) {
    state.terrain = on;
    terrain.set(on);
    tour.refresh();
    rgiMap.setTerrain(on, { move });
    save();
    status?.refresh();
    showCompass();
  }
  rgiMap.onCamera(showCompass);
  showCompass();
  rgiMap.onTilt((pitch) => {
    if (pitch >= TILT_3D) {
      if (!state.terrain) threeD(true, false);
      return;
    }
    if (state.terrain) threeD(false, false);
    if (pitch > 0) rgiMap.level();
  });
  mountZoom(el("controls"), rgiMap);
  status = mountStatus(el("status"), rgiMap, catalog, () => state);

  /*
   * The welcome shows on a first visit, unless a shared link opens straight
   * into a glacier or complex. The tour's steps find their controls in the
   * layout of the moment; Help ends the tour, closes any panel and shows the
   * welcome again.
   */
  const welcome = mountWelcome(el("sidebar"), {
    title: welcomeTitle(catalog.glacierCount, catalog.version),
    autoShow: !state.glacier && !state.complex,
    onTour: () => tour.start(),
  });
  /* The one of a selector's nodes that shows: the glacier card and the complex panel are both mounted. */
  const visible = (selector) => [...document.querySelectorAll(selector)].find((node) => !node.closest("[hidden]")) ?? null;
  const ANCHORS = {
    search: () => el("search"),
    /* The bar alone: on the phone the search grows to the full screen, which a ring would frame whole. */
    searchBar: () => el("search").querySelector("input"),
    panel: () => (PHONE.matches ? el("sheet") : el("card")),
    useData: () => visible(PHONE.matches ? '#sheet [data-tour="use-data"]' : '#card [data-tour="use-data"]'),
    terrain: () => document.querySelector(".terrain-btn"),
    /* The last card sits under the search on the desktop, above the status line on the phone. */
    controls: () => el("controls"),
    done: () => (PHONE.matches ? el("status") : el("controls")),
    /* While Use this data or the viewer covers the tour, the ring points at the close button that continues it. */
    useDataClose: () => visible(".usedata-close"),
    viewerClose: () => document.querySelector(".viewer-close"),
  };
  const tour = mountTour(document.body, {
    anchor: (name) => ANCHORS[name](),
    panel: () => (shown ? "glacier" : shownComplex ? "complex" : null),
    terrainOn: () => state.terrain,
    /* On the phone a raised sheet covers the 3D button; the 3D step lowers it. */
    onStep(step) {
      if (step === "terrain" && PHONE.matches && (shown || shownComplex)) setSheetLevel("compact");
      /* On the desktop Use this data heads the scrolling card, which step 2 may have scrolled away. */
      if (step === "data" && !PHONE.matches) el("card").scrollTop = 0;
    },
    /*
     * True once the sample glacier opens; false when this catalog has none, or
     * the file fails. Its row comes from one row group, not the search index,
     * which would first read the IDs and names of every glacier.
     */
    onTakeMe() {
      return glaciers.find(SAMPLE_GLACIER).then(
        (row) => {
          if (row === null) {
            console.warn("tour: no sample glacier", SAMPLE_GLACIER);
            return false;
          }
          openGlacier({ rgiId: SAMPLE_GLACIER, row }, ALWAYS);
          return true;
        },
        (error) => {
          console.warn("sample glacier:", error.message);
          return false;
        },
      );
    },
    /* A click on Use this data leaves the focus in the data it opened. */
    onEnd({ byTarget }) {
      if (!byTarget) help.button.focus();
    },
  });
  const help = mountHelp({ desktop: el("controls"), phone: el("status") }, {
    onHelp() {
      if (tour.running) tour.end();
      if (shown) closeGlacier();
      else if (shownComplex) closeComplex();
      welcome.show();
      help.button.focus();
    },
  });
  /* A taller status line, as 3D's terrain credits make it, lifts the desktop controls; the tour's popover follows. */
  if (typeof ResizeObserver === "function") new ResizeObserver(() => tour.reposition()).observe(el("status"));
  rgiMap.onMove((view) => {
    state.view = view;
    save();
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
  /* The reader's own move also closes the welcome: they are exploring without the tour. */
  map.on("movestart", (event) => {
    if (!event?.originalEvent) return;
    camera += 1;
    welcome.dismiss();
  });
  /* Typing in the search, or a press on it; a keyboard reader's Tab into it still reaches the welcome. */
  el("search").addEventListener("input", () => welcome.dismiss());
  el("search").addEventListener("pointerdown", () => welcome.dismiss());

  const padding = () => {
    if (PHONE.matches) return { top: PHONE_TOP, right: GAP, bottom: (popupPadding()?.bottom ?? 0) + GAP, left: GAP };
    return { top: GAP, right: GAP, bottom: GAP, left: (shown || shownComplex ? CARD_WIDTH + sidebarScrollbar() : 0) + GAP };
  };
  const fitTo = (bbox) => rgiMap.fitBbox(bbox, padding());
  /** Fit a glacier or a complex with room around it. */
  const fitAround = ({ xmin, ymin, xmax, ymax }) => {
    const [dx, dy] = [(xmax - xmin) * FIT_MARGIN, (ymax - ymin) * FIT_MARGIN];
    const wide = { xmin: xmin - dx, ymin: ymin - dy, xmax: xmax + dx, ymax: ymax + dy };
    rgiMap.fitBbox(wide, padding(), undefined, { maxZoom: FIT_MAX_ZOOM });
  };

  /** Fit `bbox` as `fit` asks, ALWAYS or IF_NEEDED, clear of the panels open now. */
  const fitAs = (bbox, fit) => {
    if (fit === ALWAYS || rgiMap.needsFit(bbox, padding())) fitAround(bbox);
  };

  /** Fit the glacier's bbox as `fit` asks once its read returns, unless another camera request came first. */
  function fitGlacierLater(glacier, fit) {
    const mine = ++camera;
    return glaciers.factsOf(glacier).then(
      (facts) => {
        if (mine === camera && shown === glacier && isBbox(facts.bbox)) fitAs(facts.bbox, fit);
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

  const useData = mountUseData(document.body, {
    catalog,
    sheet: el("sheet"),
    onToggle: (open) => tour.cover("useData", open),
  });
  onViewerToggle((open) => tour.cover("viewer", open));

  /*
   * What counts as using the card for the tour's card step: a scroll of the
   * card or the sheet, an info button or a member glacier, raising the
   * phone's sheet, and (from card.js) a switch to Hypsometry.
   */
  const used = () => tour.interacted();
  for (const scroller of [el("card"), el("sheet-body")]) scroller.addEventListener("scroll", used, { capture: true, passive: true });
  for (const panelRoot of [el("card"), el("sheet")]) {
    panelRoot.addEventListener("click", (event) => {
      if (event.target.closest?.("button.info, table.members tr")) used();
    });
  }
  /* A new level also moves the card's header, which the Use this data step sits under. */
  new window.MutationObserver(() => {
    if (el("sheet").dataset.level && el("sheet").dataset.level !== "compact") used();
    tour.refresh();
  }).observe(el("sheet"), { attributes: true, attributeFilter: ["data-level"] });

  /* The desktop sidebar holds the panels, the phone's sheet its band and body; see cardFrame. */
  const cardRoot = el("card");
  const band = el("sheet-head");
  const sheet = el("sheet-body");
  initSheet();

  /* The sheet shows only on the phone, through style.css. */
  function showCard(on) {
    document.body.classList.toggle("card-open", on);
    el("sheet").hidden = !on;
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
    tour.refresh();
  }

  /** Fit the map around `bbox`, or around the open glacier or complex once its bbox is read. */
  function zoomTo(bbox) {
    if (isBbox(bbox)) {
      camera += 1;
      fitAround(bbox);
    } else if (shown) fitGlacierLater(shown, ALWAYS);
    else if (shownComplex) fitComplexLater(shownComplex, ALWAYS);
  }

  /* Pin the terminus, and bring it to the middle of the open map if it is off screen or under a panel. */
  function pinTerminus(lonLat) {
    rgiMap.pin(lonLat);
    const room = padding();
    if (rgiMap.inView(lonLat, room)) return;
    camera += 1;
    rgiMap.centerOn(lonLat, room);
  }

  async function share() {
    try {
      await globalThis.navigator.clipboard.writeText(location.href);
    } catch {
      return;
    }
    announce("Link copied");
  }

  const card = mountCard(cardRoot, {
    catalog,
    regions,
    band,
    sheet,
    get crop() {
      return PHONE.matches ? PHONE_CROP : DESKTOP_CROP;
    },
    parquet: {
      get handle() {
        return glaciers.handle;
      },
      rowOf: (rgiId) => glaciers.rowOf(rgiId),
    },
    photos: photosOf,
    onClose: closeGlacier,
    onZoom: zoomTo,
    onShare: share,
    /* The search box names the open glacier, however it was opened. */
    onTitle(title) {
      if (shown) search.setText(title);
    },
    onUseData(glacier) {
      if (PHONE.matches) setSheetLevel("full");
      useData.open({ kind: "glacier", rgiId: glacier.rgiId, o1region: glacier.props?.o1region });
    },
    onInteract: used,
    onAction(action) {
      if (action.type === "pin") pinTerminus(action.lonlat);
      else if (action.type === "complex") openComplex(action.id, IF_NEEDED);
    },
  });

  const complexCard = mountComplexCard(cardRoot, {
    catalog,
    regions,
    band,
    sheet,
    get crop() {
      return PHONE.matches ? PHONE_CROP : DESKTOP_CROP;
    },
    read: (complexId) => complexes.read(complexId),
    members: (props) => membersOf(props, glaciers),
    onClose: closeComplex,
    onZoom: zoomTo,
    onShare: share,
    onUseData(target) {
      if (PHONE.matches) setSheetLevel("full");
      useData.open(target);
    },
    onOpenGlacier: (rgiId) => openGlacier({ rgiId }, IF_NEEDED),
    onTitle(title) {
      if (shownComplex) search.setText(title);
    },
  });

  /** Fit the whole complex as `fit` asks once its read returns, unless another camera request came first. */
  function fitComplexLater(complexId, fit) {
    const mine = ++camera;
    complexes.read(complexId).then(
      (props) => {
        if (mine === camera && shownComplex === complexId && isBbox(props?.bbox)) fitAs(props.bbox, fit);
      },
      () => {},
    );
  }

  /*
   * Open a complex's panel in place of any glacier card and select it; `fit`,
   * ALWAYS or IF_NEEDED, fits the map to it. The reader's open folds the phone's
   * credits; a shared link's, `fromLink`, leaves them showing.
   */
  function openComplex(complexId, fit, { fromLink = false } = {}) {
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
    complexes.read(complexId).then(
      (props) => {
        if (shownComplex === complexId && props?.glacier_ids) rgiMap.selectComplex(complexId, props.glacier_ids);
      },
      () => {},
    );
    showCard(true);
    search.setClosable(closeComplex);
    if (fit) fitComplexLater(complexId, fit);
    complexCard.open(complexId);
    if (PHONE.matches) setSheetLevel("compact");
    welcome.dismiss();
    if (!fromLink) status.fold();
    tour.refresh();
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
    tour.refresh();
  }

  /** Open a glacier's card and select it; `fit`, ALWAYS or IF_NEEDED, fits the map to its bbox. `fromLink` as for a complex. */
  function openGlacier(glacier, fit, { fromLink = false } = {}) {
    /* A page holds one of the two, also while a shared complex is still being read. */
    state.complex = null;
    if (shownComplex) {
      shownComplex = null;
      complexCard.close();
    }
    /* The data offer was for the glacier or complex this replaces. */
    useData.close();
    shown = glacier;
    state.glacier = glacier.rgiId;
    save();
    rgiMap.pin(null);
    rgiMap.select(glacier.rgiId);
    showCard(true);
    search.setClosable(closeGlacier);
    fitting = fit ? fitGlacierLater(glacier, fit) : null;
    card.open(glacier);
    if (PHONE.matches) setSheetLevel("compact");
    welcome.dismiss();
    if (!fromLink) status.fold();
    tour.refresh();
  }

  map.on("click", (event) => {
    welcome.dismiss();
    const props = rgiMap.glacierAt(event.point);
    if (props?.rgi_id) openGlacier({ rgiId: props.rgi_id, props }, IF_NEEDED);
    else if (shown) closeGlacier();
    else if (shownComplex) closeComplex();
  });

  const search = mountSearch(el("search"), {
    onPick(hit) {
      if (hit.kind === "glacier") {
        openGlacier({ rgiId: hit.rgiId, row: hit.row }, IF_NEEDED);
      } else if (hit.kind === "complex") {
        openComplex(hit.complexId, IF_NEEDED);
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
        /* The sender's view stays; without one the glacier is fitted, wherever the opening view is. */
        openGlacier({ rgiId, row }, !hadView && ALWAYS, { fromLink: true });
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
        openComplex(complexId, !hadView && ALWAYS, { fromLink: true });
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
    wire(catalog, mapResult.value, regionsResult.value);
  } catch (error) {
    fail(MAP_ERROR, error);
  }
}

start();

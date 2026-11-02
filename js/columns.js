/*
 * The one place that holds presentation for the glacier card: each shown
 * column's label, display unit, group and order. Descriptions and code labels
 * come from the catalog's table:columns, never from here.
 */

import { CARD_COLUMNS } from "./parquet.js";

export const GROUP_TITLES = {
  location: "Location",
  outline: "Outline",
  classification: "Classification",
  submission: "Submission",
};

const GROUP_ORDER = ["key", "location", "outline", "classification", "submission"];
const GLIMS_INFO = "https://www.glims.org/maps/info.html?anlys_id=";

/*
 * `with` lists further columns the row's value needs. `more` rows sit behind
 * "show more" in their group, except Submission's: that group opens on a
 * click already, and open it shows every row.
 */
export const DISPLAY = [
  { column: "area_km2", label: "Area", unit: "km²", group: "key", format: "km" },
  { column: "lmax_m", label: "Length", unit: "m", group: "key", format: "int" },
  { column: "slope_deg", label: "Mean slope", unit: "°", group: "key", format: "deg" },
  { column: "zmin_m", label: "Min elevation", unit: "m", group: "key", format: "int" },
  { column: "zmed_m", label: "Median elevation", unit: "m", group: "key", format: "int" },
  { column: "zmax_m", label: "Max elevation", unit: "m", group: "key", format: "int" },

  { column: "o1region", label: "Region", group: "location" },
  { column: "o2region", label: "Subregion", group: "location" },
  { column: "cenlat", label: "Central point", group: "location", format: "coord", with: ["cenlon"] },
  { column: "termlat", label: "Terminus point", group: "location", format: "coord", with: ["termlon"] },
  { column: "utm_zone", label: "UTM zone", group: "location" },

  { column: "src_date", label: "Source date", group: "outline", format: "date" },
  { column: "is_rgi6", label: "Same as RGI 6.0", group: "outline" },
  { column: "rgi6_links", label: "RGI 6.0 overlaps", group: "outline" },
  { column: "complex_id", label: "Glacier complex", group: "outline" },
  { column: "dem_source", label: "Topography DEM", group: "outline" },
  { column: "glims_id", label: "GLIMS ID", group: "outline", with: ["anlys_id"] },

  { column: "primeclass", label: "Primary class", group: "classification" },
  { column: "term_type", label: "Terminus type", group: "classification" },
  { column: "surge_type", label: "Surge evidence", group: "classification" },
  { column: "aspect_sec", label: "Aspect", group: "classification", with: ["aspect_deg"] },
  { column: "conn_lvl", label: "Greenland ice sheet connection", group: "classification" },

  { column: "subm_analysts", label: "Analysts", group: "submission" },
  { column: "subm_submitters", label: "Submitters", group: "submission" },
  { column: "subm_chief_affl", label: "Affiliation", group: "submission" },
  { column: "subm_proc_desc", label: "Processing", group: "submission" },
  { column: "subm_anlys_time", label: "Analysis time", group: "submission", format: "date" },
  { column: "subm_release_dt", label: "Release date", group: "submission", format: "date" },
  { column: "subm_n_outlines", label: "Outlines in submission", group: "submission", format: "int" },
  { column: "anlys_id", label: "Analysis ID", group: "submission", more: true },
  { column: "subm_id", label: "Submission ID", group: "submission", more: true },
  { column: "subm_rc_id", label: "Regional center ID", group: "submission", more: true },
];

/*
 * The complex panel's rows: its area and glacier count as key numbers, then
 * the glacier card's location rows. A complex has no terminus, so that row
 * drops out as any row without a value does.
 */
const COMPLEX_DISPLAY = [
  { column: "area_km2", label: "Area", unit: "km²", group: "key", format: "km" },
  { column: "glacier_ids", label: "Glaciers", group: "key" },
  ...DISPLAY.filter((entry) => entry.group === "location"),
];

/** Every scalar column the card shows or titles itself with, without duplicates. */
export const ATTRIBUTE_COLUMNS = [
  ...new Set([
    ...DISPLAY.flatMap((d) => [d.column, ...(d.with ?? [])]),
    "rgi_id",
    "glac_name",
    "display_name",
    "o1region",
    "o2region",
    "zmin_m",
    "zmed_m",
    "zmean_m",
    "zmax_m",
  ]),
];

/** The attribute columns a tile's properties lack, as the card must read them. */
export function missingAttributes(props) {
  if (!props) return ATTRIBUTE_COLUMNS.filter((c) => !CARD_COLUMNS.includes(c));
  return ATTRIBUTE_COLUMNS.filter((c) => !CARD_COLUMNS.includes(c) && !(c in props));
}

const missing = (value) => value === null || value === undefined || value === "";

export function nonEmpty(value) {
  return missing(value) ? null : value;
}

const INTEGER = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const TENTH = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const HUNDREDTH = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `YYYY-MM-DD` for a Date, an ISO string or epoch milliseconds. */
export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

export const formatInt = (value) => INTEGER.format(value);

/**
 * An area in at most four significant digits, so that it fits on one line:
 * two decimals below 10 km², one below 1,000 km², none from there up. The
 * bounds sit half a last digit lower, so 9.996 shows "10.0", not "10.00".
 */
export function formatArea(value) {
  const size = Math.abs(value);
  return (size < 9.995 ? HUNDREDTH : size < 999.95 ? TENTH : INTEGER).format(value);
}

export const formatDegrees = (value) => `${TENTH.format(value)}°`;

/** "46.4804° N, 7.9724° E". */
export function formatCoord(lat, lon) {
  const part = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;
  return `${part(lat, "N", "S")}, ${part(lon, "E", "W")}`;
}

function formatValue(entry, props) {
  const value = props[entry.column];
  if (entry.format === "coord") {
    const lon = props[entry.with[0]];
    return missing(value) || missing(lon) ? null : formatCoord(value, lon);
  }
  if (missing(value)) return null;
  const withUnit = (text) => (entry.unit && entry.unit !== "°" ? `${text} ${entry.unit}` : text);
  switch (entry.format) {
    case "date":
      return formatDate(value);
    case "int":
      return withUnit(formatInt(value));
    case "km":
      return withUnit(formatArea(value));
    case "deg":
      return formatDegrees(value);
    default:
      return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  }
}

function coded(entry, props, columns) {
  const value = props[entry.column];
  if (missing(value)) return null;
  const label = columns.get(entry.column)?.classes?.get(value);
  return label ?? String(value);
}

function regionName(regions, level, props) {
  const key = level === 1 ? "o1region" : "o2region";
  const code = props[key];
  if (missing(code)) return null;
  const match = (regions ?? []).find((r) => Number(r.level) === level && r[key] === code);
  return match?.full_name ? `${code} · ${match.full_name}` : String(code);
}

function valueOf(entry, props, columns, regions) {
  switch (entry.column) {
    case "o1region":
      return regionName(regions, 1, props);
    case "o2region":
      return regionName(regions, 2, props);
    case "aspect_sec": {
      const sector = coded(entry, props, columns);
      if (sector === null) return null;
      const degrees = props.aspect_deg;
      return missing(degrees) ? sector : `${sector} · ${formatDegrees(degrees)}`;
    }
    case "rgi6_links": {
      const links = props.rgi6_links;
      if (missing(links)) return null;
      return links.length ? links.map((l) => l.rgi6_id).join(", ") : "None";
    }
    default:
      return columns.get(entry.column)?.classes ? coded(entry, props, columns) : formatValue(entry, props);
  }
}

/**
 * The Overview rows by group, in display order. Rows without a value are left
 * out, except in the key numbers, which show "—".
 */
export function overviewRows(props, columns, regions) {
  const groups = GROUP_ORDER.map((group) => ({ group, rows: [] }));
  for (const entry of DISPLAY) {
    if (entry.column === "conn_lvl" && props.o1region !== "05") continue;
    let value = valueOf(entry, props, columns, regions);
    if (value === null) {
      if (entry.group !== "key") continue;
      value = "—";
    }
    const row = {
      label: entry.label,
      value,
      description: columns.get(entry.column)?.description ?? "",
    };
    if (entry.more) row.more = true;
    if (entry.column === "termlat") row.action = { type: "pin", lonlat: [props.termlon, props.termlat] };
    if (entry.column === "complex_id") row.action = { type: "complex", id: props.complex_id };
    if (entry.column === "glims_id" && !missing(props.anlys_id)) row.link = GLIMS_INFO + props.anlys_id;
    if (entry.column === "rgi6_links") row.list = props.rgi6_links.map((l) => l.rgi6_id);
    groups.find((g) => g.group === entry.group).rows.push(row);
  }
  return groups;
}

/**
 * The complex panel's rows, grouped as the glacier card's overview: what RGI
 * publishes for the complex, and the number of its glaciers. As there, a key
 * number without a value shows "—" and other rows without one are left out.
 */
export function complexRows(props, columns, regions) {
  const groups = ["key", "location"].map((group) => ({ group, rows: [] }));
  for (const entry of COMPLEX_DISPLAY) {
    const ids = props.glacier_ids;
    let value =
      entry.column === "glacier_ids"
        ? Array.isArray(ids) ? formatInt(ids.length) : null
        : valueOf(entry, props, columns, regions);
    if (value === null) {
      if (entry.group !== "key") continue;
      value = "—";
    }
    const row = { label: entry.label, value, description: columns.get(entry.column)?.description ?? "" };
    groups.find((g) => g.group === entry.group).rows.push(row);
  }
  return groups;
}

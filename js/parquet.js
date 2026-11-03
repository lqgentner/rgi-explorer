/* Reads GeoParquet columns by row group over HTTP range requests. */

import { decompress } from "fzstd";

/* Names come from display_name only: glac_name holds placeholders such as "Unnamed_23". */
export const SEARCH_COLUMNS = ["rgi_id", "display_name", "complex_id"];
export const CARD_COLUMNS = ["bbox", "hypso_z0_m", "hypso_permille", "rgi6_links"];

/*
 * The mirror's files are ZSTD-compressed. hyparquet decodes SNAPPY and
 * uncompressed pages itself. fzstd is plain JavaScript, so no WebAssembly
 * compiles under the page's CSP.
 */
const compressors = { ZSTD: (input) => decompress(input) };

const files = new WeakMap();
const reads = new WeakMap();

/** Opens a GeoParquet from a URL or an AsyncBuffer and lists its row groups. */
export async function openParquet(source) {
  const { asyncBufferFromUrl, parquetMetadataAsync } = globalThis.hyparquet;
  const file = typeof source === "string" ? await asyncBufferFromUrl({ url: source }) : source;
  const metadata = await parquetMetadataAsync(file);
  const groups = [];
  let start = 0;
  for (const group of metadata.row_groups) {
    const count = Number(group.num_rows);
    groups.push({ start, count });
    start += count;
  }
  const handle = { metadata, groups };
  files.set(handle, file);
  reads.set(handle, new Map());
  return handle;
}

const totalRows = (handle) => handle.groups.reduce((sum, group) => sum + group.count, 0);

/** Returns the index of the row group that holds a row. */
export function rowGroupOf(handle, row) {
  if (!Number.isInteger(row) || row < 0 || row >= totalRows(handle)) {
    throw new RangeError(`row ${row} is outside 0..${totalRows(handle) - 1}`);
  }
  return handle.groups.findIndex((group) => row < group.start + group.count);
}

/**
 * The row groups that may hold `key` in `column`: those whose statistics span
 * it, and those without statistics. A file sorted by that column names at
 * most one, so one row is found without reading the column across the file.
 */
export function groupsOfKey(handle, column, key) {
  return handle.metadata.row_groups.flatMap((group, i) => {
    const stats = group.columns.find((c) => c.meta_data?.path_in_schema?.join(".") === column)?.meta_data?.statistics;
    const known = stats?.min_value !== undefined && stats?.max_value !== undefined;
    return !known || (stats.min_value <= key && key <= stats.max_value) ? [i] : [];
  });
}

/**
 * The row of `key` in `column`, or null. The groups that may hold it are read
 * in parallel, `columns` with them, which must include `column`; readRow then
 * finds the row's values in the cache.
 */
export async function findRow(handle, column, key, columns = [column]) {
  const groups = groupsOfKey(handle, column, key);
  const reads = await Promise.all(groups.map((group) => readColumns(handle, columns, group)));
  for (const [i, read] of reads.entries()) {
    const at = read[column].indexOf(key);
    if (at !== -1) return handle.groups[groups[i]].start + at;
  }
  return null;
}

/** Converts BigInt to Number inside lists and structs. Dates stay as they are. */
function plain(value) {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object" && !(value instanceof Date) && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

async function fetchGroup(handle, columns, group) {
  const { start, count } = handle.groups[group];
  const rows = await globalThis.hyparquet.parquetReadObjects({
    file: files.get(handle),
    metadata: handle.metadata,
    columns,
    compressors,
    rowStart: start,
    rowEnd: start + count,
  });
  return Object.fromEntries(columns.map((column) => [column, rows.map((row) => plain(row[column]))]));
}

async function fetchAll(handle, columns) {
  const parts = await Promise.all(handle.groups.map((_, group) => readColumns(handle, columns, group)));
  return Object.fromEntries(columns.map((column) => [column, parts.flatMap((part) => part[column])]));
}

/** Reads columns from one row group, or from all groups in parallel when `group` is omitted. */
export function readColumns(handle, columns, group) {
  if (group !== undefined && !handle.groups[group]) {
    return Promise.reject(new RangeError(`row group ${group} does not exist`));
  }
  const key = `${group}|${columns.join(",")}`;
  const cache = reads.get(handle);
  if (!cache.has(key)) {
    const read = group === undefined ? fetchAll(handle, columns) : fetchGroup(handle, columns, group);
    cache.set(key, read);
    read.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

/** Reads the given columns of one row as an object. */
export async function readRow(handle, row, columns) {
  const group = rowGroupOf(handle, row);
  const data = await readColumns(handle, columns, group);
  const at = row - handle.groups[group].start;
  return Object.fromEntries(columns.map((column) => [column, data[column][at]]));
}

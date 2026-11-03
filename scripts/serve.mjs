/*
 * Serve the explorer with byte ranges for PMTiles and Parquet, and a /catalog mount.
 *
 * Usage: npm run serve [-- --catalog-dir DIR ...] [--port 8000] [--bind 127.0.0.1] [--web-dir .]
 *
 * Requests under /catalog/ are answered from the given directories. The first
 * directory that holds the file wins, so a catalog tree and a staging tree of
 * data files can stand in for one published catalog. Open
 * http://localhost:8000/?catalog=catalog/catalog.json to read from the mount.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const RANGE = /^bytes=(\d*)-(\d*)$/;
const MOUNT = "/catalog/";
/* Reload page code and JSON; allow normal caching for tiles and archives. */
const NO_STORE = new Set(["", ".html", ".js", ".mjs", ".css", ".json"]);
const TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Whether `target` is `dir` or lies under it. */
function inside(dir, target) {
  const rel = path.relative(dir, target);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** `target` with its symlinks resolved, or as it is when it does not exist. */
function real(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

const isFile = (target) => fs.statSync(target, { throwIfNoEntry: false })?.isFile() ?? false;

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * A /catalog path in the first directory that holds it, or null when no
 * directory does, or when the path escapes one, also through a symlink. The
 * name is decoded before the check, so an encoded climb is caught too.
 */
function catalogTarget(dirs, clean) {
  const name = decode(clean.slice(MOUNT.length))?.replace(/^\/+/, "");
  if (name === undefined) return null;
  for (const dir of dirs) {
    const target = real(path.resolve(dir, name));
    if (!inside(dir, target)) return null;
    if (isFile(target)) return target;
  }
  return null;
}

/** A web-root path: normalized first, so a climb stops at the root. */
function webTarget(webDir, clean) {
  const name = decode(clean);
  if (name === null) return null;
  const target = path.resolve(webDir, `.${path.posix.normalize(`/${name}`)}`);
  return inside(webDir, target) ? target : null;
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain", "Accept-Ranges": "bytes" });
  res.end("File not found");
}

/** Send `file`, or the single byte range the request names. A malformed range is ignored. */
function send(req, res, file, clean) {
  const { size, mtime } = fs.statSync(file);
  const headers = {
    "Content-Type": typeOf(file),
    "Accept-Ranges": "bytes",
    "Last-Modified": mtime.toUTCString(),
  };
  if (NO_STORE.has(path.posix.extname(clean))) headers["Cache-Control"] = "no-store, must-revalidate";

  const match = RANGE.exec(req.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  /* `bytes=-` matches the grammar with neither end and is ignored too. */
  if (match && (match[1] || match[2])) {
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    } else {
      /* A suffix range ("bytes=-500") asks for the final N bytes. */
      start = Math.max(0, size - Number(match[2]));
    }
    if (start >= size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  fs.createReadStream(file, { start, end })
    .on("error", () => res.destroy())
    .pipe(res);
}

/**
 * A server for the page in `webDir` and the catalog directories mounted under
 * /catalog/, searched in order. Directories are resolved, symlinks included.
 * `log` prints each request.
 */
export function createServer({ webDir, catalogDirs = [], log = false }) {
  const root = real(path.resolve(webDir));
  const dirs = catalogDirs.map((dir) => real(path.resolve(dir)));
  return http.createServer((req, res) => {
    if (log) res.on("finish", () => console.log(`${req.method} ${req.url} ${res.statusCode}`));
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(501, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const clean = req.url.split("?", 1)[0].split("#", 1)[0];
    if (clean.startsWith(MOUNT)) {
      const target = catalogTarget(dirs, clean);
      if (target) send(req, res, target, clean);
      else notFound(res);
      return;
    }
    const target = webTarget(root, clean);
    const stat = target && fs.statSync(target, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      /* As a static host does: a directory's address ends with a slash, and its index.html answers. */
      if (!clean.endsWith("/")) {
        res.writeHead(301, { Location: `${clean}/${req.url.slice(clean.length)}` });
        res.end();
        return;
      }
      const index = path.join(target, "index.html");
      if (isFile(index)) send(req, res, index, clean);
      else notFound(res);
      return;
    }
    if (stat?.isFile()) send(req, res, target, clean);
    else notFound(res);
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      "web-dir": { type: "string", default: "." },
      "catalog-dir": { type: "string", multiple: true, default: [] },
      port: { type: "string", default: "8000" },
      bind: { type: "string", default: "127.0.0.1" },
    },
  });
  const webDir = path.resolve(values["web-dir"]);
  const catalogDirs = values["catalog-dir"].map((dir) => path.resolve(dir));
  if (!isFile(path.join(webDir, "index.html"))) {
    console.error(`No index.html in ${webDir}`);
    process.exit(1);
  }
  for (const dir of catalogDirs) {
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      console.error(`No catalog directory ${dir}`);
      process.exit(1);
    }
  }
  const port = Number(values.port);
  const server = createServer({ webDir, catalogDirs, log: true });
  server.listen(port, values.bind, () => {
    const host = values.bind === "127.0.0.1" ? "localhost" : values.bind;
    const mounted = catalogDirs.join(", ") || "none";
    console.log(`Serving ${webDir} (catalog: ${mounted}) on http://${host}:${port}/`);
  });
  process.on("SIGINT", () => {
    console.log("\nStopped.");
    process.exit(0);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

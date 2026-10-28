/*
 * Copy what the page loads from node_modules/ into a site directory. Each
 * import-map target's whole directory goes, so files a library fetches beside
 * its module come along. The fonts the stylesheet names and the icon sprite go
 * too. Source maps, development builds and type declarations stay behind.
 *
 * Usage: node scripts/stage-libraries.mjs <site-dir>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = /\.map$|-dev\.mjs$|\.d\.m?ts$/;
/* Lucide's sprite, which js/ui.js references by URL. */
const ICON_SPRITE = "node_modules/lucide-static/sprite.svg";

/** The import map's imports, read from index.html. */
export function importMap() {
  const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  return JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
}

/** The font files style.css names under node_modules/, as repository paths. */
export function fontFiles() {
  const css = fs.readFileSync(path.join(REPO, "style.css"), "utf8");
  return [...css.matchAll(/url\(["']?(node_modules\/[^"')]+\.woff2)["']?\)/g)].map((m) => m[1]);
}

/** Copy every library directory, font directory and the icon sprite under siteDir. */
export function stageLibraries(siteDir) {
  const dirs = new Set();
  for (const [name, target] of Object.entries(importMap())) {
    if (!target.startsWith("./node_modules/")) throw new Error(`${name} maps outside node_modules: ${target}`);
    dirs.add(path.dirname(target).replace(/^\.\//, ""));
  }
  for (const dir of dirs) {
    fs.cpSync(path.join(REPO, dir), path.join(siteDir, dir), {
      recursive: true,
      filter: (source) => !SKIP.test(source),
    });
  }

  // A font package ships every script and weight; the page needs the WOFF2 files.
  for (const dir of new Set(fontFiles().map((file) => path.dirname(file)))) {
    fs.cpSync(path.join(REPO, dir), path.join(siteDir, dir), {
      recursive: true,
      filter: (source) => fs.statSync(source).isDirectory() || source.endsWith(".woff2"),
    });
  }

  fs.mkdirSync(path.dirname(path.join(siteDir, ICON_SPRITE)), { recursive: true });
  fs.copyFileSync(path.join(REPO, ICON_SPRITE), path.join(siteDir, ICON_SPRITE));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/stage-libraries.mjs <site-dir>");
    process.exit(2);
  }
  stageLibraries(path.resolve(process.argv[2]));
}

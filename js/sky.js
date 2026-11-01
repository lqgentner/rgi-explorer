/*
 * Copied from glace-viewer's js/sky.js.
 *
 * Measure the globe limb for the CSS halo behind MapLibre's transparent canvas.
 * Update custom properties on move; no animation loop.
 *
 * Limb projection is adapted from Leonel Dias, "Globe atmosphere, halo, and comets
 * with pure Canvas 2D and MapLibre" (leoneljdias.github.io). Sample the visible
 * horizon: projecting points 90° from the center puts the ring inside the
 * silhouette.
 */

/*
 * MapLibre camera defaults from src/geo/transform_helper.ts and
 * projection/globe_utils.ts: distance = 0.5 * height / tan(fov / 2), radius =
 * worldSize / (2π * cos(lat)); the orbit follows vertical_perspective_transform.ts.
 * Revisit if the viewer changes FOV, globe scaling, or roll.
 */
const FOV = 0.6435011087932844;
const TILE_SIZE = 512;
const LIMB_SAMPLES = 128;
/* MapLibre's MAX_VALID_LATITUDE. */
const MAX_LAT = 85.051129;

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/**
 * Return the projected horizon's center and radii in CSS pixels. The camera
 * orbits the center at the camera distance, tilted by pitch away from the
 * bearing, and sees the globe out to the circle around the point beneath it. In
 * Mercator the projected ring extends beyond the viewport.
 */
export function globeDisc(map, width, height) {
  const { lng, lat } = map.getCenter();
  /* MapLibre stops scaling the globe at the Mercator edge; past it, cos(lat) runs to zero. */
  const radius = (TILE_SIZE * 2 ** map.getZoom()) / (2 * Math.PI) / Math.cos(rad(Math.min(Math.abs(lat), MAX_LAT)));
  const distance = (0.5 * height) / Math.tan(FOV / 2);
  const pitch = rad(map.getPitch());
  const bearing = rad(map.getBearing());

  // Earth-centered unit vectors at the map center.
  const [sinLat, cosLat] = [Math.sin(rad(lat)), Math.cos(rad(lat))];
  const [sinLng, cosLng] = [Math.sin(rad(lng)), Math.cos(rad(lng))];
  const up = [cosLat * cosLng, cosLat * sinLng, sinLat];
  const north = [-sinLat * cosLng, -sinLat * sinLng, cosLat];
  const east = [-sinLng, cosLng, 0];
  // Toward the top of the screen, and to its right.
  const ahead = north.map((n, i) => n * Math.cos(bearing) + east[i] * Math.sin(bearing));
  const right = east.map((e, i) => e * Math.cos(bearing) - north[i] * Math.sin(bearing));
  const camera = up.map(
    (u, i) => u * (radius + distance * Math.cos(pitch)) - ahead[i] * distance * Math.sin(pitch),
  );
  const cameraDistance = Math.hypot(...camera);
  const below = camera.map((c) => c / cameraDistance);
  const horizon = Math.acos(radius / cameraDistance);
  // Tangent beneath the camera; with right, it starts the samples at the outline's extremes.
  const across = cross(below, right);

  /*
   * The camera looks at the map center; a sample behind it projects mirrored.
   * So may one just in front of it, as MapLibre's camera differs a little from
   * this one. Samples that near the camera's plane land far off screen, so the
   * outline skips them too.
   */
  // A unit vector: the camera orbits the center at `distance`.
  const forward = up.map((u, i) => (u * radius - camera[i]) / distance);
  const points = [];
  for (let i = 0; i < LIMB_SAMPLES; i += 1) {
    const angle = (i / LIMB_SAMPLES) * 2 * Math.PI;
    const sample = below.map(
      (b, k) =>
        b * Math.cos(horizon) +
        (right[k] * Math.cos(angle) + across[k] * Math.sin(angle)) * Math.sin(horizon),
    );
    const depth = forward.reduce((sum, f, k) => sum + f * (sample[k] * radius - camera[k]), 0);
    if (depth < distance / 10) continue;
    const [x, y, z] = sample;
    points.push(map.project([deg(Math.atan2(y, x)), deg(Math.asin(z))]));
  }
  // With no sample in front of the camera, the globe covers the view.
  if (points.length === 0) return { x: 0, y: 0, rx: Infinity, ry: Infinity };
  if (points.length < LIMB_SAMPLES) {
    /*
     * Steeply tilted, the horizon runs out behind the camera and its outline is
     * open. Fit a circle through its top and the sample nearest a viewport side.
     */
    const top = points.reduce((a, b) => (b.y < a.y ? b : a));
    const off = (p) => Math.abs(Math.abs(p.x - top.x) - width / 2);
    const side = points.reduce((a, b) => (off(b) < off(a) ? b : a));
    const r = ((side.x - top.x) ** 2 + (side.y - top.y) ** 2) / (2 * (side.y - top.y));
    return { x: top.x, y: top.y + r, rx: r, ry: r };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Tilt only stretches the outline vertically on screen, so it stays axis-aligned.
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, rx, ry };
}

function cross([ax, ay, az], [bx, by, bz]) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/* Write CSS properties only while the globe leaves part of the viewport uncovered. */
export function installSky(map, element) {
  const update = () => {
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (!width || !height) return;
    const disc = globeDisc(map, width, height);
    // Space shows if a viewport corner lies outside the ellipse.
    const visible = [0, width].some((cx) =>
      [0, height].some((cy) => Math.hypot((cx - disc.x) / disc.rx, (cy - disc.y) / disc.ry) > 1),
    );
    element.classList.toggle("sky", visible);
    if (!visible) return;

    element.style.setProperty("--globe-x", `${disc.x}px`);
    element.style.setProperty("--globe-y", `${disc.y}px`);
    element.style.setProperty("--globe-rx", `${disc.rx}px`);
    element.style.setProperty("--globe-ry", `${disc.ry}px`);
  };
  map.on("move", update);
  map.on("resize", update);
  // The style switches to the globe after the first measurement.
  map.on("projectiontransition", update);
  update();
}

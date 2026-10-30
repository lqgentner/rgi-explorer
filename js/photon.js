/* Place search through the Photon geocoder. */

import { PHOTON, TIMEOUT_MS } from "./config.js";
import { SCORE } from "./search.js";

const LIMIT = 5;

/**
 * An OSM tag value as a category: "nature_reserve" reads "Nature reserve".
 * An OSM glacier says where it comes from, as RGI glaciers are hits too.
 */
function categoryOf(value) {
  if (!value) return "";
  if (value === "glacier") return "Glacier (OSM)";
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Places that match `q`, biased toward the map view. A non-OK response gives no
 * places. A network error or an abort rejects.
 *
 * @param {string} q
 * @param {{lat: number, lon: number, zoom: number}} view
 * @param {{fetch?: Function, signal?: AbortSignal}} [options]
 */
export async function searchPlaces(q, { lat, lon, zoom }, { fetch = globalThis.fetch, signal } = {}) {
  const url = new URL(PHOTON);
  url.search = new URLSearchParams({
    q,
    lat: String(lat),
    lon: String(lon),
    zoom: String(Math.round(zoom)),
    limit: String(LIMIT),
    lang: "en",
  });
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) return [];
  const { features = [] } = await response.json();
  return features
    .filter((feature) => feature.properties?.name)
    .map((feature, i) => {
      const { name, osm_value: kind, country } = feature.properties;
      return {
        kind: "place",
        title: name,
        subtitle: [categoryOf(kind), country].filter(Boolean).join(" · "),
        score: SCORE.place - 10 * i,
        center: feature.geometry.coordinates,
      };
    });
}

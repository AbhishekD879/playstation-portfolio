// Planet Earth — Leaflet + OpenStreetMap with live layers: today's earthquakes
// (USGS) and live rain radar (RainViewer). Geolocate + Nominatim search.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchQuakes, rainTiles, type Quake } from "../apps";
import Globe, { type GlobeApi } from "./Globe";
import * as sfx from "../audio";

export default function MapApp(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal("");
  const [quakesOn, setQuakesOn] = createSignal(false);
  const [rainOn, setRainOn] = createSignal(false);
  const [mode, setMode] = createSignal<"2d" | "3d">("3d"); // lead with the globe
  const [quakes, setQuakes] = createSignal<Quake[]>([]);
  let mapEl!: HTMLDivElement;
  let map: L.Map;
  let marker: L.Marker | null = null;
  let quakeLayer: L.LayerGroup | null = null;
  let rainLayer: L.TileLayer | null = null;
  let globeApi: GlobeApi | undefined;

  onMount(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => removeEventListener("keydown", esc));
    fetchQuakes().then(setQuakes).catch(() => {});
    map = L.map(mapEl, { zoomControl: true }).setView([20, 20], 2.4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · quakes USGS · rain RainViewer',
      maxZoom: 19,
    }).addTo(map);
    onCleanup(() => map.remove());
  });

  function whereAmI() {
    setStatus("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setStatus("");
        const ll: [number, number] = [p.coords.latitude, p.coords.longitude];
        if (mode() === "3d") {
          globeApi?.flyTo(ll[0], ll[1]);
          setStatus("📍 you are here (probably)");
          setTimeout(() => setStatus(""), 3500);
        } else {
          marker?.remove();
          marker = L.marker(ll).addTo(map).bindPopup("You are here (probably)").openPopup();
          map.flyTo(ll, 13);
        }
        sfx.confirm();
      },
      () => setStatus("Location denied — search for a place instead."),
      { timeout: 6000 },
    );
  }

  async function search(q: string) {
    if (!q.trim()) return;
    setStatus("Searching…");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!d[0]) { setStatus("No such place on this planet."); return; }
      setStatus("");
      const ll: [number, number] = [+d[0].lat, +d[0].lon];
      const name = d[0].display_name.split(",")[0];
      if (mode() === "3d") {
        globeApi?.flyTo(ll[0], ll[1]);
        setStatus(`📍 ${name}`);
        setTimeout(() => setStatus(""), 3500);
      } else {
        marker?.remove();
        marker = L.marker(ll).addTo(map).bindPopup(name).openPopup();
        map.flyTo(ll, 11);
      }
      sfx.confirm();
    } catch {
      setStatus("Search unavailable right now.");
    }
  }

  async function toggleQuakes() {
    if (mode() === "3d") {
      // on the globe the beacons are always lit — this spotlights the big one
      const label = globeApi?.spotlightQuake();
      if (label) { setStatus(`◉ strongest today: ${label}`); setTimeout(() => setStatus(""), 4500); sfx.confirm(); }
      else setStatus("No quake data right now.");
      return;
    }
    if (quakeLayer) {
      quakeLayer.remove();
      quakeLayer = null;
      setQuakesOn(false);
      sfx.back();
      return;
    }
    setStatus("Listening to the ground…");
    try {
      const quakes = await fetchQuakes();
      quakeLayer = L.layerGroup(
        quakes.map((e) =>
          L.circleMarker([e.lat, e.lon], {
            radius: 2.2 + e.mag * 1.7,
            color: e.mag >= 5 ? "#ff5a5a" : "#ffb04a",
            weight: 1.5,
            fillOpacity: 0.35,
          }).bindPopup(`M${e.mag.toFixed(1)} — ${e.place}`),
        ),
      ).addTo(map);
      setQuakesOn(true);
      setStatus("");
      sfx.confirm();
    } catch {
      setStatus("USGS unavailable right now.");
    }
  }

  async function toggleRain() {
    if (mode() === "3d") {
      // radar is a flat-map tile layer — hop over and switch it on
      setMode("2d");
      sfx.tickH();
    }
    if (rainLayer) {
      rainLayer.remove();
      rainLayer = null;
      setRainOn(false);
      sfx.back();
      return;
    }
    setStatus("Reading the clouds…");
    const url = await rainTiles();
    if (!url) { setStatus("Radar unavailable right now."); return; }
    rainLayer = L.tileLayer(url, { opacity: 0.65 }).addTo(map);
    setRainOn(true);
    setStatus("");
    sfx.confirm();
  }

  return (
    <div class="mapapp">
      <div class="mapapp-bar">
        <div class="panel-tag">PLANET EARTH — LIVE</div>
        <button class="ghost-btn" classList={{ on: mode() === "3d" }} onClick={() => { setMode(mode() === "3d" ? "2d" : "3d"); sfx.tickH(); }}>
          {mode() === "3d" ? "🗺 flat map" : "🌐 3D globe"}
        </button>
        <input
          class="mapapp-search"
          placeholder="Search a place… (ENTER)"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") search(e.currentTarget.value);
            if (e.key === "Escape") { sfx.back(); props.onClose(); }
          }}
        />
        <button class="ghost-btn" onClick={whereAmI}>⌖ where am I</button>
        <button class="ghost-btn" classList={{ on: quakesOn() }} onClick={toggleQuakes}>◉ quakes 24h</button>
        <button class="ghost-btn" classList={{ on: rainOn() }} onClick={toggleRain}>🌧 rain radar</button>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>
      <div class="mapapp-map" ref={mapEl} style={{ display: mode() === "2d" ? "block" : "none" }} />
      <Show when={mode() === "3d"}>
        <div class="globe-wrap"><Globe quakes={quakes()} bind={(api) => (globeApi = api)} /></div>
      </Show>
      <Show when={status()}><div class="fullapp-status">{status()}</div></Show>
    </div>
  );
}

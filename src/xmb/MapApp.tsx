// Planet Earth — Leaflet + OpenStreetMap with live layers: today's earthquakes
// (USGS) and live rain radar (RainViewer). Geolocate + Nominatim search.
// Plus the "Life with PlayStation" layer: live ISS overhead (wheretheiss.at)
// and a world tour that drifts between cities with their current weather.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchHN, fetchQuakes, rainTiles, wmo, type Quake } from "../apps";
import Globe, { type GlobeApi } from "./Globe";
import * as sfx from "../audio";

const CITIES = [
  { name: "Hyderabad", lat: 17.38, lon: 78.49 },
  { name: "Tokyo", lat: 35.68, lon: 139.69 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
  { name: "Singapore", lat: 1.35, lon: 103.82 },
  { name: "Dubai", lat: 25.2, lon: 55.27 },
  { name: "London", lat: 51.5, lon: -0.12 },
  { name: "Paris", lat: 48.85, lon: 2.35 },
  { name: "Reykjavík", lat: 64.15, lon: -21.94 },
  { name: "New York", lat: 40.71, lon: -74.0 },
  { name: "San Francisco", lat: 37.77, lon: -122.42 },
  { name: "São Paulo", lat: -23.55, lon: -46.63 },
  { name: "Cape Town", lat: -33.92, lon: 18.42 },
];

export default function MapApp(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal("");
  const [quakesOn, setQuakesOn] = createSignal(false);
  const [rainOn, setRainOn] = createSignal(false);
  const [mode, setMode] = createSignal<"2d" | "3d">("3d"); // lead with the globe
  const [quakes, setQuakes] = createSignal<Quake[]>([]);
  const [iss, setIss] = createSignal<{ lat: number; lon: number; alt: number; vel: number } | null>(null);
  const [tour, setTour] = createSignal(false);
  const [tourIdx, setTourIdx] = createSignal(0);
  const [wx, setWx] = createSignal<({ temp: number; code: number } | null)[]>(CITIES.map(() => null));
  const [ticker, setTicker] = createSignal("");
  let mapEl!: HTMLDivElement;
  let map: L.Map;
  let marker: L.Marker | null = null;
  let quakeLayer: L.LayerGroup | null = null;
  let rainLayer: L.TileLayer | null = null;
  let globeApi: GlobeApi | undefined;
  let tourId: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => removeEventListener("keydown", esc));
    fetchQuakes().then(setQuakes).catch(() => {});
    // the station, every 5s (API asks for ≤1 req/s)
    const pollIss = async () => {
      try {
        const d = await (await fetch("https://api.wheretheiss.at/v1/satellites/25544")).json();
        setIss({ lat: d.latitude, lon: d.longitude, alt: Math.round(d.altitude), vel: Math.round(d.velocity) });
        globeApi?.setIss(d.latitude, d.longitude);
      } catch { /* orbit continues without us */ }
    };
    pollIss();
    const issId = setInterval(pollIss, 5000);
    onCleanup(() => { clearInterval(issId); if (tourId) clearInterval(tourId); });
    map = L.map(mapEl, { zoomControl: true }).setView([20, 20], 2.4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · quakes USGS · rain RainViewer · globe textures <a href="https://www.solarsystemscope.com/textures/">Solar System Scope</a> (CC BY 4.0)',
      maxZoom: 19,
    }).addTo(map);
    onCleanup(() => map.remove());
  });

  function flyToIss() {
    const s = iss();
    if (!s) { setStatus("Waiting for the station to phone home…"); return; }
    if (mode() === "2d") setMode("3d");
    globeApi?.flyTo(s.lat, s.lon, 0xffe08a);
    setStatus(`🛰 ISS — ${s.alt} km up, ${s.vel.toLocaleString()} km/h`);
    setTimeout(() => setStatus(""), 5000);
    sfx.confirm();
  }

  // —— the world tour: drift city to city with live weather, headlines below ——
  function toggleTour() {
    if (tour()) {
      setTour(false);
      if (tourId) { clearInterval(tourId); tourId = null; }
      sfx.back();
      return;
    }
    sfx.confirm();
    if (mode() === "2d") setMode("3d");
    setTour(true);
    if (!wx().some(Boolean)) {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${CITIES.map((c) => c.lat).join(",")}&longitude=${CITIES.map((c) => c.lon).join(",")}&current=temperature_2m,weather_code`)
        .then((r) => r.json())
        .then((d) => {
          const arr = Array.isArray(d) ? d : [d];
          setWx(CITIES.map((_, i) => arr[i] ? { temp: Math.round(arr[i].current.temperature_2m), code: arr[i].current.weather_code } : null));
        })
        .catch(() => {});
    }
    if (!ticker()) fetchHN().then((es) => setTicker(es.map((e) => e.title).join("   •   "))).catch(() => {});
    const visit = (i: number) => { setTourIdx(i); globeApi?.flyTo(CITIES[i].lat, CITIES[i].lon, 0x9fd0ff); };
    visit(0);
    let i = 0;
    tourId = setInterval(() => { i = (i + 1) % CITIES.length; visit(i); }, 9000);
  }

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
        <button class="ghost-btn" onClick={flyToIss}>🛰 ISS</button>
        <button class="ghost-btn" classList={{ on: tour() }} onClick={toggleTour}>🌏 world tour</button>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>
      <div class="mapapp-map" ref={mapEl} style={{ display: mode() === "2d" ? "block" : "none" }} />
      <Show when={mode() === "3d"}>
        <div class="globe-wrap"><Globe quakes={quakes()} bind={(api) => (globeApi = api)} /></div>
        <div class="globe-zoom">
          <button class="ghost-btn globe-zoom-btn" onClick={() => { globeApi?.zoom(1); sfx.tickH(); }}>＋</button>
          <button class="ghost-btn globe-zoom-btn" onClick={() => { globeApi?.zoom(-1); sfx.tickH(); }}>－</button>
        </div>
      </Show>
      <Show when={tour() && mode() === "3d"}>
        <div class="tour-card">
          <div class="tour-city">{CITIES[tourIdx()].name}</div>
          <Show when={wx()[tourIdx()]} fallback={<div class="tour-temp">…</div>}>
            <div class="tour-temp">{wmo(wx()[tourIdx()]!.code)[0]} {wx()[tourIdx()]!.temp}°</div>
            <div class="tour-desc">{wmo(wx()[tourIdx()]!.code)[1]}</div>
          </Show>
          <Show when={iss()}>
            <div class="tour-iss">🛰 ISS · {iss()!.alt} km · {iss()!.vel.toLocaleString()} km/h</div>
          </Show>
        </div>
        <Show when={ticker()}>
          <div class="tour-ticker"><div class="tour-ticker-inner">{ticker()}</div></div>
        </Show>
      </Show>
      <Show when={status()}><div class="fullapp-status">{status()}</div></Show>
    </div>
  );
}

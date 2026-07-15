// Real online apps for the console: news readers, RSS and weather.
// All sources are free, key-less APIs with open CORS.
//
// Every call happens in the VISITOR'S browser with their IP — load spreads
// across visitors instead of hammering one server. This cache cuts even that:
// repeat opens within the TTL never touch the network.
async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const k = "asp.cache." + key;
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t < ttlMs) return v as T;
    }
  } catch { /* corrupt cache — refetch */ }
  const v = await fetcher();
  try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch { /* too big for localStorage — fine */ }
  return v;
}

export interface NewsEntry {
  title: string;
  url: string;
  meta: string;
}

export function fetchHN(): Promise<NewsEntry[]> {
  return cached("hn", 10 * 60_000, async () => {
  const r = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=18");
  const d = await r.json();
  return d.hits.map((h: any) => ({
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    meta: `▲ ${h.points} · ${h.num_comments ?? 0} comments`,
  }));
  });
}

export function fetchDevto(): Promise<NewsEntry[]> {
  return cached("devto", 10 * 60_000, async () => {
  const r = await fetch("https://dev.to/api/articles?per_page=18&top=7");
  const d = await r.json();
  return d.map((a: any) => ({
    title: a.title,
    url: a.url,
    meta: `♥ ${a.positive_reactions_count} · ${a.readable_publish_date}`,
  }));
  });
}

/** Any RSS/Atom feed, fetched through a CORS proxy and parsed in-browser. */
export function fetchRss(feedUrl: string): Promise<NewsEntry[]> {
  return cached("rss." + encodeURIComponent(feedUrl).slice(0, 60), 10 * 60_000, async () => {
  const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`);
  const xml = new DOMParser().parseFromString(await r.text(), "text/xml");
  const items = [...xml.querySelectorAll("item")].slice(0, 18).map((it) => ({
    title: it.querySelector("title")?.textContent ?? "untitled",
    url: it.querySelector("link")?.textContent ?? "#",
    meta: (it.querySelector("pubDate")?.textContent ?? "").slice(0, 22),
  }));
  if (items.length) return items;
  // Atom fallback
  return [...xml.querySelectorAll("entry")].slice(0, 18).map((it) => ({
    title: it.querySelector("title")?.textContent ?? "untitled",
    url: it.querySelector("link")?.getAttribute("href") ?? "#",
    meta: (it.querySelector("updated")?.textContent ?? "").slice(0, 10),
  }));
  });
}

// —— weather (open-meteo, no key, CORS open) ——
export interface Weather {
  place: string;
  temp: number;
  wind: number;
  code: number;
  days: { day: string; min: number; max: number; code: number }[];
}

const WMO: Record<number, [string, string]> = {
  0: ["☀️", "Clear sky"], 1: ["🌤", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
  45: ["🌫", "Fog"], 48: ["🌫", "Rime fog"],
  51: ["🌦", "Light drizzle"], 53: ["🌦", "Drizzle"], 55: ["🌧", "Heavy drizzle"],
  61: ["🌧", "Light rain"], 63: ["🌧", "Rain"], 65: ["🌧", "Heavy rain"],
  71: ["🌨", "Light snow"], 73: ["🌨", "Snow"], 75: ["❄️", "Heavy snow"],
  80: ["🌦", "Showers"], 81: ["🌧", "Showers"], 82: ["⛈", "Violent showers"],
  95: ["⛈", "Thunderstorm"], 96: ["⛈", "Storm + hail"], 99: ["⛈", "Storm + hail"],
};
export const wmo = (code: number) => WMO[code] ?? ["🌡", "—"];

function locate(): Promise<{ lat: number; lon: number; place: string }> {
  return new Promise((res) => {
    const fallback = { lat: 17.385, lon: 78.4867, place: "Hyderabad" };
    if (!navigator.geolocation) return res(fallback);
    const t = setTimeout(() => res(fallback), 3500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); res({ lat: p.coords.latitude, lon: p.coords.longitude, place: "Your location" }); },
      () => { clearTimeout(t); res(fallback); },
      { timeout: 3000 },
    );
  });
}

export function fetchWeather(): Promise<Weather> {
  return cached("weather", 20 * 60_000, async () => {
  const { lat, lon, place } = await locate();
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=4&timezone=auto`,
  );
  const d = await r.json();
  const days = d.daily.time.slice(1).map((t: string, i: number) => ({
    day: new Date(t).toLocaleDateString(undefined, { weekday: "short" }),
    min: Math.round(d.daily.temperature_2m_min[i + 1]),
    max: Math.round(d.daily.temperature_2m_max[i + 1]),
    code: d.daily.weather_code[i + 1],
  }));
  return { place, temp: Math.round(d.current.temperature_2m), wind: Math.round(d.current.wind_speed_10m), code: d.current.weather_code, days };
  });
}

// —— channel guide: the iptv-org public database (~17k streams). streams.json
// alone has title+url+quality, so we skip the 10 MB channels.json entirely. ——
export interface GuideChannel { title: string; url: string; quality?: string }
let guideCache: GuideChannel[] | null = null;
export async function fetchGuide(): Promise<GuideChannel[]> {
  if (guideCache) return guideCache;
  // cache the FILTERED list — ~1 MB instead of the raw 3.7 MB payload
  guideCache = await cached("iptv", 24 * 3600_000, async () => {
    const r = await fetch("https://iptv-org.github.io/api/streams.json");
    const streams = await r.json();
    const seen = new Set<string>();
    const nsfw = /xxx|adult|porn|18\+|erotic/i;
    return streams
      .filter((s: any) =>
        s.title && s.url?.includes(".m3u8") && !s.referrer && !s.user_agent && !nsfw.test(s.title))
      .filter((s: any) => {
        const k = s.title.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((s: any) => ({ title: s.title as string, url: s.url as string, quality: s.quality ?? undefined }))
      .sort((a: GuideChannel, b: GuideChannel) => a.title.localeCompare(b.title));
  });
  return guideCache!;
}

// —— internet radio: radio-browser.info — free community DB of ~45k stations.
// Top 3000 by popularity; https-only so it survives an https deploy. ——
let radioCache: GuideChannel[] | null = null;
export async function fetchRadio(): Promise<GuideChannel[]> {
  if (radioCache) return radioCache;
  const QS = "/json/stations/search?hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=3000";
  radioCache = await cached("radio", 24 * 3600_000, async () => {
    // community mirrors — try the next one if a server is down
    let d: any[] | null = null;
    for (const host of ["de1", "nl1", "at1"]) {
      try {
        const r = await fetch(`https://${host}.api.radio-browser.info${QS}`);
        if (r.ok) { d = await r.json(); break; }
      } catch { /* next mirror */ }
    }
    if (!d) throw new Error("all radio-browser mirrors down");
    const seen = new Set<string>();
    return d
      .filter((s: any) => {
        if (!s.name?.trim() || !s.url_resolved) return false;
        const k = s.name.trim().toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((s: any) => ({
        title: s.name.trim(),
        url: s.url_resolved as string,
        quality: s.codec ? `${s.codec}${s.bitrate ? " " + s.bitrate + "k" : ""}` : undefined,
      }));
  });
  return radioCache!;
}

// —— live TV: curated free public HLS streams (some rot over time; the player
// shows a clean "channel offline" state when they do) ——
export const CHANNELS: { label: string; sub: string; url: string }[] = [
  { label: "Red Bull TV", sub: "Extreme sports & music, live", url: "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8" },
  { label: "CBS News", sub: "US news, live", url: "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8" },
  { label: "DW English", sub: "German world service, live", url: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8" },
];

// ————————————————————————— wild apps —————————————————————————

// —— podcasts: iTunes Search (key-less, CORS) + episode RSS ——
export interface Podcast { title: string; author: string; feedUrl: string; art?: string }
export async function searchPodcasts(term: string): Promise<Podcast[]> {
  const r = await fetch(`https://itunes.apple.com/search?media=podcast&limit=25&term=${encodeURIComponent(term)}`);
  const d = await r.json();
  return d.results
    .filter((p: any) => p.feedUrl)
    .map((p: any) => ({ title: p.collectionName, author: p.artistName, feedUrl: p.feedUrl, art: p.artworkUrl100 }));
}
export interface Episode { title: string; url: string; date: string; duration?: string }
export function fetchEpisodes(feedUrl: string): Promise<Episode[]> {
  return cached("pod." + encodeURIComponent(feedUrl).slice(0, 60), 30 * 60_000, async () => {
    const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`);
    const xml = new DOMParser().parseFromString(await r.text(), "text/xml");
    return [...xml.querySelectorAll("item")].slice(0, 30)
      .map((it) => ({
        title: it.querySelector("title")?.textContent ?? "untitled",
        url: it.querySelector("enclosure")?.getAttribute("url") ?? "",
        date: (it.querySelector("pubDate")?.textContent ?? "").slice(0, 16),
        duration: it.getElementsByTagName("itunes:duration")[0]?.textContent ?? undefined,
      }))
      .filter((e) => e.url);
  });
}

// —— internet archive: films + flash games (CORS-open everywhere) ——
export interface IAItem { id: string; title: string }
export async function searchArchive(collection: string, query: string): Promise<IAItem[]> {
  const q = query.trim()
    ? `collection:(${collection}) AND title:(${query.trim()})`
    : `collection:(${collection})`;
  const r = await fetch(
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
    `&fl%5B%5D=identifier&fl%5B%5D=title&sort%5B%5D=downloads+desc&rows=60&output=json`,
  );
  const d = await r.json();
  return d.response.docs.map((x: any) => ({ id: x.identifier, title: String(x.title ?? x.identifier) }));
}
/** Find the .swf inside an archive.org item and return a CORS-fetchable URL.
 *  The /cors/ endpoint sets Access-Control-Allow-Origin (unlike /download/ or
 *  the storage nodes), so we can pull the bytes and run our own Ruffle. */
export async function findSwf(id: string): Promise<string | null> {
  const r = await fetch(`https://archive.org/metadata/${id}`);
  const d = await r.json();
  const f = (d.files ?? []).find((x: any) => x.name?.toLowerCase().endsWith(".swf"));
  return f ? `https://archive.org/cors/${id}/${encodeURIComponent(f.name)}` : null;
}

// —— open library ——
export interface Book { title: string; author: string; year?: number; cover?: string; ia?: string; key: string }
export async function searchBooks(q: string): Promise<Book[]> {
  const r = await fetch(`https://openlibrary.org/search.json?limit=30&q=${encodeURIComponent(q)}`);
  const d = await r.json();
  return d.docs.map((b: any) => ({
    title: b.title,
    author: b.author_name?.[0] ?? "unknown",
    year: b.first_publish_year,
    cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : undefined,
    ia: Array.isArray(b.ia) ? b.ia[0] : undefined, // readable on archive.org
    key: b.key,
  }));
}

// —— dictionary ——
export interface Definition { word: string; phonetic?: string; meanings: { pos: string; defs: string[] }[] }
export async function define(word: string): Promise<Definition | null> {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`);
  if (!r.ok) return null;
  const d = await r.json();
  const e = d[0];
  return {
    word: e.word,
    phonetic: e.phonetic,
    meanings: e.meanings.slice(0, 4).map((m: any) => ({
      pos: m.partOfSpeech,
      defs: m.definitions.slice(0, 3).map((x: any) => x.definition),
    })),
  };
}

// —— NASA APOD (DEMO_KEY is fine: per-visitor IP + 24h cache) ——
export interface Apod { title: string; url: string; hdurl?: string; explanation: string; date: string; media_type: string }
export function fetchApod(): Promise<Apod> {
  return cached("apod", 24 * 3600_000, async () => {
    const r = await fetch("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY");
    if (!r.ok) throw new Error("apod rate limited");
    return r.json();
  });
}

// —— trivia (OpenTDB) ——
export interface TriviaQ { q: string; answers: string[]; correct: number; category: string }
const deent = (s: string) => new DOMParser().parseFromString(s, "text/html").documentElement.textContent ?? s;
export async function fetchTrivia(): Promise<TriviaQ[]> {
  const r = await fetch("https://opentdb.com/api.php?amount=10&type=multiple");
  const d = await r.json();
  return d.results.map((x: any) => {
    const answers = [...x.incorrect_answers.map(deent)];
    const correct = Math.floor(Math.random() * 4);
    answers.splice(correct, 0, deent(x.correct_answer));
    return { q: deent(x.question), answers, correct, category: deent(x.category) };
  });
}

// ————————————————————— round three: the internet, natively —————————————————————

// —— native YouTube via the Invidious network: the healthy-instance list is
// fetched live, search fails over across instances. Playback is always the
// official youtube-nocookie embed, so it works even when instances wobble. ——
export interface YtVideo { id: string; title: string; author: string; length: number; views?: number }
let ytPool: string[] | null = null;
async function ytInstances(): Promise<string[]> {
  if (ytPool) return ytPool;
  ytPool = await cached("ytpool", 6 * 3600_000, async () => {
    const r = await fetch("https://api.invidious.io/instances.json?sort_by=health");
    const d: [string, any][] = await r.json();
    return d
      .filter(([, i]) => i.type === "https" && i.api && i.cors === true)
      .map(([, i]) => i.uri as string)
      .slice(0, 6);
  });
  return ytPool!;
}
function mapVids(d: any[]): YtVideo[] {
  return d
    .filter((v: any) => v.type === "video" || v.videoId)
    .map((v: any) => ({
      id: v.videoId,
      title: v.title,
      author: v.author,
      length: v.lengthSeconds ?? 0,
      views: v.viewCount,
    }));
}
// Piped instances answer browsers more reliably than Invidious these days;
// try them first, then the Invidious pool, then the CORS proxy as last resort.
const PIPED = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.drgns.space",
];
function mapPiped(items: any[]): YtVideo[] {
  return items
    .filter((v: any) => v.url?.includes("/watch?v="))
    .map((v: any) => ({
      id: v.url.split("v=")[1],
      title: v.title,
      author: v.uploaderName ?? "",
      length: v.duration ?? 0,
      views: v.views,
    }));
}
async function tryJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
export async function ytSearch(q: string): Promise<YtVideo[]> {
  for (const base of PIPED) {
    const d = await tryJson(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`);
    if (d?.items?.length) return mapPiped(d.items);
  }
  for (const base of await ytInstances()) {
    for (const url of [
      `${base}/api/v1/search?type=video&q=${encodeURIComponent(q)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`${base}/api/v1/search?type=video&q=${encodeURIComponent(q)}`)}`,
    ]) {
      const d = await tryJson(url);
      if (Array.isArray(d) && d.length) return mapVids(d);
    }
  }
  throw new Error("no instance answered");
}
export async function ytTrending(): Promise<YtVideo[]> {
  for (const base of PIPED) {
    const d = await tryJson(`${base}/trending?region=US`);
    if (Array.isArray(d) && d.length) return mapPiped(d);
  }
  for (const base of await ytInstances()) {
    const d = await tryJson(`${base}/api/v1/trending`);
    if (Array.isArray(d) && d.length) return mapVids(d);
  }
  return []; // nice-to-have; search & paste still work
}

// —— art gallery: The Met's open collection API (no key, CORS, plain CDN
// images — artic.edu's IIIF host blocks third-party embedding) ——
export interface Artwork { title: string; artist: string; img: string }
export async function searchArt(q: string): Promise<Artwork[]> {
  const r = await fetch(
    `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(q || "impressionism")}`,
  );
  const d = await r.json();
  const ids: number[] = (d.objectIDs ?? []).slice(0, 30);
  const objs = await Promise.all(
    ids.map((id) =>
      fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)
        .then((x) => x.json())
        .catch(() => null),
    ),
  );
  return objs
    .filter((o: any) => o?.primaryImageSmall)
    .map((o: any) => ({
      title: o.title,
      artist: o.artistDisplayName || o.culture || "unknown",
      img: o.primaryImageSmall,
    }));
}

// —— wikipedia ——
export interface WikiHit { title: string; snippet: string }
export async function wikiSearch(q: string): Promise<WikiHit[]> {
  const r = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=20&format=json&origin=*&srsearch=${encodeURIComponent(q)}`,
  );
  const d = await r.json();
  const strip = (s: string) => new DOMParser().parseFromString(s, "text/html").documentElement.textContent ?? s;
  return d.query.search.map((s: any) => ({ title: s.title, snippet: strip(s.snippet) }));
}
export interface WikiPage { title: string; extract: string; thumb?: string; url: string }
export async function wikiPage(title: string): Promise<WikiPage> {
  const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  const d = await r.json();
  return {
    title: d.title,
    extract: d.extract,
    thumb: d.thumbnail?.source,
    url: d.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

// —— planet earth layers ——
export interface Quake { mag: number; place: string; lat: number; lon: number; time: number }
export function fetchQuakes(): Promise<Quake[]> {
  return cached("quakes", 15 * 60_000, async () => {
    const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    const d = await r.json();
    return d.features.map((f: any) => ({
      mag: f.properties.mag,
      place: f.properties.place,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      time: f.properties.time,
    }));
  });
}
/** Latest RainViewer radar tile URL template, or null if unavailable. */
export async function rainTiles(): Promise<string | null> {
  try {
    const r = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    const d = await r.json();
    const last = d.radar?.past?.at(-1);
    return last ? `${d.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png` : null;
  } catch {
    return null;
  }
}

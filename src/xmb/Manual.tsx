// System Manual — the console's own documentation. How the whole machine is
// built: architecture, input routing, emulation, multiplayer, AI, every
// external API, storage and licenses. PS3 User's-Guide energy: chapters on
// the left, scrollable pages on the right, fully drivable by pad/keyboard.
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { setNavEnabled } from "../input";
import { LAB_GROUPS } from "../labs";
import * as sfx from "../audio";

// —— diagrams: inline SVG, tinted by the console theme ————————————————————
const TINT = "var(--xmb-tint)";
// typed loose on purpose: Solid's SVG attribute types fight plain spread objects
const box: any = { fill: "rgba(255,255,255,0.045)", stroke: "rgba(255,255,255,0.35)", "stroke-width": 1, rx: 8 };
const hot: any = { fill: `color-mix(in oklab, ${TINT} 30%, transparent)`, stroke: `color-mix(in oklab, ${TINT} 80%, #fff)`, "stroke-width": 1.2, rx: 8 };
const txt: any = { fill: "rgba(255,255,255,0.85)", "font-size": 11, "text-anchor": "middle", "font-family": "inherit" };
const sub: any = { ...txt, fill: "rgba(255,255,255,0.45)", "font-size": 9 };
const wire: any = { stroke: "rgba(255,255,255,0.35)", "stroke-width": 1.2, fill: "none", "marker-end": "url(#arr)" };

const Defs = () => (
  <defs>
    <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 z" fill="rgba(255,255,255,0.45)" />
    </marker>
  </defs>
);

const DiagramStack = () => (
  <svg viewBox="0 0 640 300" class="man-svg">
    <Defs />
    <rect x="20" y="16" width="600" height="52" {...hot} />
    <text x="320" y="38" {...txt}>XMB SHELL — SolidJS + TypeScript · wave canvas · themes · profiles · trophies · Labs</text>
    <text x="320" y="54" {...sub}>one reactive tree, no router — every app is a component over the wave</text>
    <rect x="20" y="86" width="190" height="64" {...box} />
    <text x="115" y="110" {...txt}>APPS (30+)</text>
    <text x="115" y="126" {...sub}>games · media · web · AI · tools</text>
    <rect x="226" y="86" width="190" height="64" {...box} />
    <text x="321" y="110" {...txt}>INPUT ROUTER</text>
    <text x="321" y="126" {...sub}>keyboard · pad · gestures · OSK</text>
    <rect x="432" y="86" width="188" height="64" {...box} />
    <text x="526" y="110" {...txt}>CONSOLE BUS</text>
    <text x="526" y="126" {...sub}>internal MCP for the AI co-pilot</text>
    <rect x="20" y="168" width="290" height="56" {...box} />
    <text x="165" y="190" {...txt}>WASM LAYER</text>
    <text x="165" y="206" {...sub}>Play! PS2 · EmulatorJS · js-dos · Ruffle · v86 · Stockfish</text>
    <rect x="326" y="168" width="294" height="56" {...box} />
    <text x="473" y="190" {...txt}>ON-DEVICE AI (WebGPU)</text>
    <text x="473" y="206" {...sub}>WebLLM · Whisper · Kokoro · MediaPipe</text>
    <rect x="20" y="242" width="600" height="44" {...box} />
    <text x="320" y="261" {...txt}>CLOUDFLARE EDGE — Pages · Functions + KV · Worker + Durable Objects · TURN</text>
    <text x="320" y="276" {...sub}>the only servers anywhere; everything above runs in your browser</text>
    <line x1="115" y1="150" x2="115" y2="168" {...wire} />
    <line x1="473" y1="150" x2="473" y2="168" {...wire} />
    <line x1="320" y1="68" x2="320" y2="86" {...wire} />
    <line x1="320" y1="224" x2="320" y2="242" {...wire} />
  </svg>
);

const DiagramInput = () => (
  <svg viewBox="0 0 640 250" class="man-svg">
    <Defs />
    <rect x="16" y="16" width="130" height="40" {...box} /><text x="81" y="40" {...txt}>KEYBOARD</text>
    <rect x="16" y="70" width="130" height="40" {...box} /><text x="81" y="94" {...txt}>GAMEPAD</text>
    <rect x="16" y="124" width="130" height="40" {...box} /><text x="81" y="148" {...txt}>HAND GESTURES</text>
    <rect x="16" y="178" width="130" height="40" {...box} /><text x="81" y="202" {...txt}>ON-SCREEN KEYBOARD</text>
    <rect x="230" y="70" width="180" height="94" {...hot} />
    <text x="320" y="105" {...txt}>INPUT ROUTER</text>
    <text x="320" y="122" {...sub}>edge detection · repeat · claims</text>
    <text x="320" y="136" {...sub}>text-field guard · OSK block</text>
    <rect x="480" y="16" width="144" height="40" {...box} /><text x="552" y="34" {...txt}>XMB NAV</text><text x="552" y="48" {...sub}>crossbar, when enabled</text>
    <rect x="480" y="70" width="144" height="40" {...box} /><text x="552" y="88" {...txt}>BOUND APPS</text><text x="552" y="102" {...sub}>NavActions forwarded</text>
    <rect x="480" y="124" width="144" height="40" {...box} /><text x="552" y="142" {...txt}>KEY SYNTHESIS</text><text x="552" y="156" {...sub}>owner apps hear arrows/Esc</text>
    <rect x="480" y="178" width="144" height="40" {...box} /><text x="552" y="196" {...txt}>GAME CLAIMS</text><text x="552" y="210" {...sub}>bridges own the pad raw</text>
    <line x1="146" y1="36" x2="230" y2="90" {...wire} />
    <line x1="146" y1="90" x2="230" y2="105" {...wire} />
    <line x1="146" y1="144" x2="230" y2="120" {...wire} />
    <line x1="146" y1="198" x2="230" y2="135" {...wire} />
    <line x1="410" y1="90" x2="480" y2="36" {...wire} />
    <line x1="410" y1="105" x2="480" y2="90" {...wire} />
    <line x1="410" y1="120" x2="480" y2="144" {...wire} />
    <line x1="410" y1="135" x2="480" y2="198" {...wire} />
  </svg>
);

const DiagramMp = () => (
  <svg viewBox="0 0 640 240" class="man-svg">
    <Defs />
    <rect x="16" y="30" width="220" height="120" {...hot} />
    <text x="126" y="55" {...txt}>HOST BROWSER</text>
    <text x="126" y="75" {...sub}>Play! emulator runs the game</text>
    <text x="126" y="91" {...sub}>canvas.captureStream(30) → video</text>
    <text x="126" y="107" {...sub}>joiner input → controller port 2</text>
    <text x="126" y="123" {...sub}>(pad 2 bound via config profile — no rebuild)</text>
    <rect x="404" y="30" width="220" height="120" {...box} />
    <text x="514" y="55" {...txt}>JOINER BROWSER</text>
    <text x="514" y="75" {...sub}>no emulator — just a &lt;video&gt;</text>
    <text x="514" y="91" {...sub}>gamepad/keys → data channel</text>
    <text x="514" y="107" {...sub}>sees the stream, plays player 2</text>
    <line x1="236" y1="70" x2="404" y2="70" {...wire} />
    <text x="320" y="62" {...sub}>WebRTC video (P2P)</text>
    <line x1="404" y1="112" x2="236" y2="112" {...wire} />
    <text x="320" y="128" {...sub}>input state, ordered channel</text>
    <rect x="200" y="178" width="240" height="46" {...box} />
    <text x="320" y="197" {...txt}>CLOUDFLARE WORKER</text>
    <text x="320" y="213" {...sub}>Durable Object per room · /turn creds · wss /mp</text>
    <line x1="126" y1="150" x2="240" y2="178" {...wire} />
    <line x1="514" y1="150" x2="400" y2="178" {...wire} />
  </svg>
);

// —— the chapters ————————————————————————————————————————————————————————
export const REPO = "https://github.com/AbhishekD879/playstation-portfolio";
// path "" = the repo root; a trailing "/" = a folder (tree), else a file (blob)
const srcUrl = (path: string) =>
  path === "" ? REPO : `${REPO}/${path.endsWith("/") ? "tree" : "blob"}/main/${path.replace(/\/$/, "")}`;

interface Chapter { id: string; title: string; src: { label: string; path: string }[]; body: () => JSX.Element }

const API_ROWS: [string, string, string][] = [
  ["Invidious / Piped network", "YouTube search & trending, no API key", "api.invidious.io · pipedapi.*"],
  ["youtube-nocookie", "video playback (official embed)", "youtube-nocookie.com"],
  ["Internet Archive", "public-domain films, Flash games", "archive.org"],
  ["Wayback Machine", "Time Machine — any site, any year", "web.archive.org"],
  ["radio-browser.info", "~45,000 live radio stations", "*.api.radio-browser.info"],
  ["iTunes Search", "podcast directory", "itunes.apple.com"],
  ["Spotify Embeds", "playlists & albums", "open.spotify.com/embed"],
  ["iptv-org + broadcasters", "live TV channel list & streams", "iptv-org.github.io"],
  ["Hacker News (Algolia)", "news reader", "hn.algolia.com"],
  ["dev.to API", "dev articles", "dev.to/api"],
  ["Open Trivia DB", "trivia questions", "opentdb.com"],
  ["Lichess", "live grandmaster TV", "lichess.org"],
  ["Open-Meteo", "weather — current & forecast", "api.open-meteo.com"],
  ["Where the ISS at?", "live ISS position (5s poll)", "api.wheretheiss.at"],
  ["USGS", "earthquakes, last 24h", "earthquake.usgs.gov"],
  ["RainViewer", "live rain radar tiles", "api.rainviewer.com"],
  ["OpenStreetMap + Nominatim", "map tiles + place search", "openstreetmap.org"],
  ["Esri World Imagery", "satellite close-ups", "arcgisonline.com"],
  ["The Met Collection", "art gallery masterpieces", "collectionapi.metmuseum.org"],
  ["NASA APOD", "astronomy photo of the day", "api.nasa.gov"],
  ["Open Library", "book search + covers", "openlibrary.org"],
  ["Wikipedia REST", "console-styled reader", "en.wikipedia.org/api"],
  ["Free Dictionary", "word lookups", "api.dictionaryapi.dev"],
  ["js-dos CDN", "DOOM runtime + shareware bundle", "v8.js-dos.com"],
  ["AllOrigins", "CORS relay for user RSS feeds", "api.allorigins.win"],
  ["Hugging Face CDN", "AI model weights (first use, then cached)", "huggingface.co"],
];

const CHAPTERS: Chapter[] = [
  {
    id: "overview", title: "Overview", src: [{ label: "the repo", path: "" }],
    body: () => (
      <>
        <h2>What this console is</h2>
        <p>AbhishekStation is a portfolio built as a working PlayStation-style console: a cross-media bar,
          profiles, trophies, themes — and thirty-plus real apps behind it, from a PS2 emulator with online
          multiplayer to an on-device AI co-pilot. Everything below the Cloudflare edge runs <b>in your browser</b>.
          There is no application server, no database, no analytics, no accounts.</p>
        <h2>The stack</h2>
        <p><b>SolidJS + TypeScript</b> render the whole shell as one reactive tree (no router — apps are components
          layered over the wave). <b>Vite</b> builds it; <b>Cloudflare Pages</b> serves it. The wave is a hand-rolled
          canvas animation tinted by a single CSS variable (<code>--xmb-tint</code>) that every themed surface shares.
          Heavy lifting — emulation, AI, speech — is WebAssembly and WebGPU, downloaded on demand and cached.</p>
        <DiagramStack />
        <h2>Design rules</h2>
        <p>· Local first: your saves, profiles, photos and game library never leave this browser.<br />
          · No keys: every external API used is public and keyless — the site works from a static CDN.<br />
          · Console UX: everything drivable by keyboard, controller, or a wave of your hand.</p>
      </>
    ),
  },
  {
    id: "shell", title: "The Shell (XMB)", src: [{ label: "XMB.tsx", path: "src/xmb/XMB.tsx" }, { label: "content.ts", path: "src/content.ts" }, { label: "theme.ts", path: "src/theme.ts" }],
    body: () => (
      <>
        <h2>The crossbar</h2>
        <p>Categories run horizontally, items vertically — the PS3's XMB grammar. Every item is data
          (<code>content.ts</code>): the XMB itself is one component that renders whatever the active category holds.
          Game, Music, TV, News and Photo columns are <i>injected at runtime</i> — your ROM library, saved radio
          stations and RSS feeds appear as first-class items.</p>
        <h2>Boot, profiles & trophies</h2>
        <p>The boot screen synthesizes its chime in WebAudio (no samples anywhere on the console — every tick,
          confirm and deny is an oscillator). Profiles, trophies and playtime live in <code>localStorage</code>;
          24 trophies with a platinum, awarded by actually using the machine.</p>
        <h2>Themes</h2>
        <p>16 presets plus a fully custom colour (hue / saturation / lightness sliders). The default "Classic"
          rotates monthly like PS3 wallpaper. One tint variable drives the wave, buttons, glows, scrollbars —
          even these diagrams.</p>
        <h2>Labs — feature flags</h2>
        <p>Settings → Console Settings → LABS is the console's switchboard: grouped toggles for every <em>system feature</em> (Control
          Center, on-screen keyboard, voice commands, screen saver, phone controller, DualSense, living background,
          launch effects) and every <em>app</em>. Flip a feature off and it's disabled everywhere; flip an app off and
          it leaves the crossbar (a category with nothing left disappears). State is one localStorage key; everything
          ships enabled.</p>
      </>
    ),
  },
  {
    id: "input", title: "Input System", src: [{ label: "input.ts", path: "src/input.ts" }, { label: "Osk.tsx", path: "src/xmb/Osk.tsx" }, { label: "gamepadBridge.ts", path: "src/gamepadBridge.ts" }],
    body: () => (
      <>
        <h2>One router, four sources</h2>
        <p>Keyboard, gamepad, hand gestures (MediaPipe hand-tracking on the webcam) and the on-screen keyboard all
          funnel through <code>input.ts</code> — XMB-style initial-delay-then-repeat on held directions, edge
          detection on the pad, and phantom-controller filtering (Xbox pads love registering twice).</p>
        <DiagramInput />
        <h2>The routing rules</h2>
        <p>· XMB visible → pad presses become NavActions.<br />
          · Inside a keyboard-driven app → pad presses are re-synthesized as arrow/Enter/Escape key events.<br />
          · A game running (DOOM, PS2, Flash) → its bridge <i>claims</i> the pad; nothing else sees it.<br />
          · A text field focused → ✕/d-pad summon the on-screen keyboard; ◯ steps out of the field.</p>
        <h2>The on-screen keyboard</h2>
        <p>Appears only on a real controller press with a field focused — never for mouse/keyboard users. D-pad
          moves the grid, ✕ types, □ deletes, △ space, ◯ done, L1 shift, R1 symbols, Start submits. It writes
          through the native value setter so reactive inputs update, and bows out the moment real typing is detected.</p>
      </>
    ),
  },
  {
    id: "games", title: "Games & Emulation", src: [{ label: "Ps2.tsx", path: "src/xmb/Ps2.tsx" }, { label: "play host", path: "public/play/index.html" }, { label: "GameSession", path: "src/emulator/" }],
    body: () => (
      <>
        <h2>PlayStation 2 — Play! compiled to WebAssembly</h2>
        <p>The real <a href="https://github.com/jpd002/Play-" target="_blank">Play!</a> emulator (BSD-2) runs in an
          iframe with SharedArrayBuffer threads — which is why the whole site ships COOP/COEP isolation headers.
          Memory cards are snapshotted from the emulator's in-memory filesystem into IndexedDB every 15 seconds,
          one card per profile. The neat trick: Play! loads controller bindings for all four pads from a config
          profile at boot, but its web build only wires pad 1 — so the console writes an XML profile binding
          <b> pad 2 to synthetic key codes before the VM starts</b>. A second controller, zero recompiles.</p>
        <h2>The rest of the shelf</h2>
        <p>· <b>Retro Console</b> — EmulatorJS cores: NES, SNES, Game Boy/Advance, Mega Drive, N64, DS. ROMs are
          read locally into IndexedDB; nothing uploads.<br />
          · <b>DOOM</b> — the 1993 shareware episode on js-dos v8 (DOSBox in WASM).<br />
          · <b>Flash Arcade</b> — Ruffle (Rust→WASM Flash player) streaming games from the Internet Archive.<br />
          · <b>Other OS</b> — v86 boots KolibriOS, a full x86 PC, in a tab.<br />
          · <b>Chess</b> — Stockfish WASM with an ELO slider; Lichess TV to spectate the real thing.<br />
          · <b>Xbox-pad mapping</b> — a bridge translates the Gamepad API into each engine's native keys, with
          rumble on the fire button.</p>
      </>
    ),
  },
  {
    id: "multiplayer", title: "PS2 Online Multiplayer", src: [{ label: "ps2mp/", path: "src/ps2mp/" }, { label: "mp-worker/", path: "mp-worker/" }],
    body: () => (
      <>
        <h2>Host-authoritative streaming</h2>
        <p>The same architecture as cloud gaming, shrunk to two browsers: only the host runs the emulator. Its canvas
          is captured at 30 fps and streamed over WebRTC; the joiner sends controller state back on a data channel,
          and the host injects it as PS2 controller port 2. No netcode, no determinism problems — the game itself
          never knows the internet exists.</p>
        <DiagramMp />
        <h2>The plumbing</h2>
        <p>Room signaling is a Cloudflare <b>Durable Object per room code</b> (a tiny WebSocket relay); in dev it's a
          40-line Vite plugin speaking the same protocol. ICE goes through Cloudflare STUN, with TURN relay
          credentials minted per session for the ~20% of networks where hole-punching fails. Latency on the same
          network is imperceptible; across the internet it's honest physics — fine for wrestling, rough for
          frame-perfect fighters.</p>
      </>
    ),
  },
  {
    id: "ai", title: "On-Device AI", src: [{ label: "piWebllm.ts", path: "src/piWebllm.ts" }, { label: "consoleBus.ts", path: "src/consoleBus.ts" }, { label: "asr.ts", path: "src/asr.ts" }],
    body: () => (
      <>
        <h2>The co-pilot</h2>
        <p>"AI Abhishek" is a real agent loop (pi-agent-core) driving a local LLM through <b>WebLLM on WebGPU</b> —
          Hermes 3 · 3B recommended, Llama 3.2 · 1B for modest GPUs. Weights download once from Hugging Face and
          cache in the browser. Nothing you type leaves the machine.</p>
        <h2>The console control bus</h2>
        <p>Every user-reachable action on the console — open apps, play radio, change themes, move the crossbar —
          registers on an internal bus (<code>consoleBus.ts</code>): an MCP in spirit, one tool in practice. The
          agent discovers capabilities through a RAG index of action descriptions and calls them like a user would.
          A hardened parser survives the creative JSON a 1B model produces.</p>
        <h2>Ears, voice & hands</h2>
        <p>· <b>Whisper</b> (transformers.js) transcribes the mic locally for voice input.<br />
          · <b>Kokoro</b> synthesizes replies as speech, also on-device.<br />
          · <b>MediaPipe</b> hand-tracking turns webcam waves into XMB navigation (Settings → Camera Navigation).<br />
          Memory: chat history persists in IndexedDB per profile, with a RAG recall over past conversations.</p>
        <h2>Every model on the console</h2>
        <p>Everything below runs in <em>your</em> browser — WebGPU when available, wasm otherwise. Weights download
          once from Hugging Face and live in Cache Storage; nothing you say, type or photograph leaves the device.</p>
        <table class="man-table">
          <thead><tr><th>Model</th><th>~Download</th><th>Powers</th></tr></thead>
          <tbody>
            <tr><td>Hermes 3 · Llama 3.2 3B (WebLLM)</td><td>1.9 GB</td><td>AI Abhishek — the agent that drives the console</td></tr>
            <tr><td>Llama 3.2 · 1B (WebLLM)</td><td>700 MB</td><td>AI Abhishek on modest GPUs</td></tr>
            <tr><td>Whisper</td><td>90 MB</td><td>Voice commands — mic → text</td></tr>
            <tr><td>Kokoro-82M</td><td>85 MB</td><td>The assistant's spoken voice</td></tr>
            <tr><td>Swin2SR ×2</td><td>70 MB</td><td>Photo Enhance — tiled super-resolution</td></tr>
            <tr><td>Depth Anything</td><td>60 MB</td><td>Live Photos — depth-parallax 3D</td></tr>
            <tr><td>opus-mt (per language)</td><td>50 MB</td><td>Universal Menu — crossbar translation</td></tr>
            <tr><td>RMBG-1.4</td><td>45 MB</td><td>Cutout Cam — background removal</td></tr>
            <tr><td>SlimSAM</td><td>40 MB</td><td>Click-to-Mask — point-prompt segmentation</td></tr>
            <tr><td>MiniLM</td><td>35 MB</td><td>Vibe Search embeddings + AI memory recall</td></tr>
            <tr><td>MediaPipe Hands</td><td>~12 MB</td><td>Camera Navigation — gesture browsing</td></tr>
          </tbody>
        </table>
        <h2>The memory manager</h2>
        <p>Every transformers.js pipeline is acquired through <code>models.ts</code>: nothing loads until a feature
          runs, resident models are capped by a device-scaled budget (110 / 220 / 450 MB by RAM) with LRU eviction,
          idle pipelines free themselves after 3 minutes, and a hidden tab flushes everything after a grace period.
          Downloads stay cached on disk, so re-acquiring is seconds, not a re-download. Labs rates each heavy
          feature against this device before you enable it. WebLLM manages itself and unloads when the chat closes.</p>
      </>
    ),
  },
  {
    id: "apis", title: "External APIs", src: [{ label: "apps.ts", path: "src/apps.ts" }],
    body: () => (
      <>
        <h2>Every third-party API on the console</h2>
        <p>All public, all keyless. If one is down, its app degrades and the rest of the console doesn't care.</p>
        <table class="man-table">
          <thead><tr><th>Service</th><th>Used for</th><th>Endpoint</th></tr></thead>
          <tbody>
            <For each={API_ROWS}>{(r) => <tr><td>{r[0]}</td><td>{r[1]}</td><td><code>{r[2]}</code></td></tr>}</For>
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: "edge", title: "Edge & Storage", src: [{ label: "functions/", path: "functions/" }, { label: "wrangler.jsonc", path: "wrangler.jsonc" }],
    body: () => (
      <>
        <h2>The only servers</h2>
        <p>· <b>Cloudflare Pages</b> serves the static build with COOP/COEP headers (SharedArrayBuffer for PS2).<br />
          · <b>Pages Functions</b>: the guestbook (KV-backed, rate-limited) and the reader-browser proxy
          (server-side fetch + sanitize, scripts stripped, rate-limited per IP so it's a reading tool, not an open proxy).<br />
          · <b>Worker + Durable Objects</b>: multiplayer signaling and TURN credential minting, origin-locked.</p>
        <h2>Where your data lives</h2>
        <p>All of it in this browser: profiles, trophies & theme in <code>localStorage</code>; game library, photos,
          PS2 memory cards and AI chats in <code>IndexedDB</code>. Settings → Back Up Console Data exports the lot
          as JSON; Restore imports it. The only thing stored server-side is what you write in the guestbook.</p>
        <h2>PWA</h2>
        <p>A service worker caches the shell for offline boots and makes the console installable — it runs
          full-screen from a dock or home screen like it always belonged there.</p>
      </>
    ),
  },
  {
    id: "system", title: "Console Settings & System", src: [{ label: "SettingsApp.tsx", path: "src/xmb/SettingsApp.tsx" }, { label: "prefs.ts", path: "src/prefs.ts" }, { label: "labs.ts", path: "src/labs.ts" }],
    body: () => (
      <>
        <h2>One home for every setting</h2>
        <p><b>Console Settings</b> (Settings → first item) is the PS5-style hub: a snap-rail of sections with a
          search box over every row. <b>APPEARANCE</b> swaps the console font live (Google Fonts lazy-load on pick),
          letter spacing and display scale, and links into Themes. <b>ICONS</b> re-glyphs any category or app from
          the console's own icon set. <b>AUDIO</b> is volume, sound packs and mute. <b>LANGUAGE</b> drives the
          Universal Menu — a small opus-mt model per language translates the crossbar on-device, with live download
          progress. <b>LABS</b> hosts every feature flag inline, with device-fitness badges and per-feature guide
          cards (the ? on a row). <b>SYSTEM</b> shows the device profile, the AI memory manager, storage, portable
          save data and the privacy label.</p>
        <h2>The idle ladder</h2>
        <p>Idle at the home screen climbs three rungs: <b>Attract Mode</b> (only until a profile has learned the
          controls — a dozen real inputs or one dismissal retires it forever, stored on the profile so it rides
          backups), then the <b>screensaver</b> clock, then <b>Rest Mode</b> — near-black, a breathing amber power
          light, audio context suspended, the wave's render loop parked. Nothing unmounts; any input resumes the
          exact prior state, and the waking press is swallowed so it never navigates.</p>
        <h2>Data that travels — and data that doesn't</h2>
        <p>· <b>Setup links</b>: theme, Labs flags, icons, fonts & language gzip (Compression Streams) into a
          <code>#setup=</code> URL; the receiving console asks before applying.<br />
          · <b>Save folders</b>: emulator save databases + a settings snapshot export to a user-picked directory
          (File System Access) and import back. Photos, videos and the game library are deliberately excluded —
          media never leaves the browser it was added to.<br />
          · The <b>Privacy Nutrition Label</b> (SYSTEM) lists every localStorage/IndexedDB key with sizes and every
          external domain contacted this session, plus an ask-twice full wipe.</p>
        <h2>Photos, video & snapshots</h2>
        <p>The <b>Photo Library</b> browses manually (slideshow on demand) with three on-device AI tools — Enhance
          ×2 (Swin2SR, tiled), Cutout (RMBG) and Isolate (SlimSAM point-prompt) — all through the model memory
          manager; results appear in the open library instantly. The <b>Video Player</b> plays local files on the
          master audio bus so backdrops react. <b>XMB Photo Mode</b> freezes the living background into a framed
          1920×1080 card for the OS share sheet.</p>
        <h2>Repo Rewind</h2>
        <p>Extras → Repo Rewind plays this repo's own git history as a growing radial file tree
          (<code>scripts/gitlog.mjs</code> bakes <code>commits.json</code> at build time). The console documents
          its own construction, commit by commit.</p>
      </>
    ),
  },
  {
    id: "inventory", title: "Feature Inventory & Heavy Machinery", src: [{ label: "labs.ts", path: "src/labs.ts" }, { label: "package.json", path: "package.json" }],
    body: () => (
      <>
        <h2>Every feature on the console — live from the registry</h2>
        <p>This list renders straight out of <code>labs.ts</code>, the same registry Labs uses — it can't go stale.
          Right now the console ships <b>{LAB_GROUPS.reduce((s, g) => s + g.items.length, 0)} switchable features and apps</b>,
          every one of them toggleable in Console Settings → LABS.</p>
        <For each={LAB_GROUPS}>
          {(g) => (
            <>
              <h2>{g.group} ({g.items.length})</h2>
              <p><For each={g.items}>{(f, i) => <>{i() > 0 ? " · " : ""}<b>{f.title}</b></>}</For></p>
            </>
          )}
        </For>
        <h2>Heavy machinery</h2>
        <p>The engines under the shell — all client-side, loaded lazily by the feature that needs them.</p>
        <table class="man-table">
          <thead><tr><th>Engine</th><th>What it is</th><th>Powers</th></tr></thead>
          <tbody>
            <tr><td>three.js (WebGL + WebGPU/TSL)</td><td>3D renderer</td><td>the Wave, backdrops, galaxy boot, live photos</td></tr>
            <tr><td>@huggingface/transformers</td><td>on-device ML runtime (ONNX)</td><td>every model in the AI chapter's table</td></tr>
            <tr><td>@mlc-ai/web-llm</td><td>LLM inference on WebGPU</td><td>AI Abhishek</td></tr>
            <tr><td>EmulatorJS (CDN)</td><td>RetroArch cores in wasm</td><td>GBA · GB/GBC · NES · SNES · Mega Drive · N64 · NDS · PSX · PSP</td></tr>
            <tr><td>Play!</td><td>PS2 emulator, wasm</td><td>the PS2 home + online multiplayer</td></tr>
            <tr><td>ScummVM</td><td>adventure-game engine, wasm</td><td>the point-and-click shelf</td></tr>
            <tr><td>RPG Maker (bring-your-own)</td><td>MV/MZ native HTML5 · self-hosted EasyRPG for 2000/2003 (CC-BY RTP bundled)</td><td>drop a .zip → detect engine → OPFS + scoped SW → play</td></tr>
            <tr><td>stockfish</td><td>chess engine, wasm</td><td>Chess vs Stockfish</td></tr>
            <tr><td>@ruffle-rs/ruffle</td><td>Flash Player, wasm</td><td>Flash Arcade</td></tr>
            <tr><td>cesium</td><td>3D globe engine</td><td>Planet Earth + Vibe Search</td></tr>
            <tr><td>webamp</td><td>Winamp 2 reimplementation</td><td>the Winamp deck</td></tr>
            <tr><td>trystero</td><td>serverless WebRTC P2P</td><td>presence, P2P chess, phone controller</td></tr>
            <tr><td>kokoro-js</td><td>TTS runtime</td><td>the assistant's voice</td></tr>
            <tr><td>@mediapipe/tasks-vision</td><td>vision models, wasm/SIMD</td><td>camera navigation</td></tr>
            <tr><td>gsap · hls.js · leaflet · chess.js</td><td>motion, streams, maps, rules</td><td>boot choreography, TV, the map, chess legality</td></tr>
          </tbody>
        </table>
        <p>Nothing above loads at boot. The shell itself is SolidJS + one CSS file; each engine arrives the first
          time its cabinet is opened, and the AI weights obey the memory manager's budget.</p>
      </>
    ),
  },
  {
    id: "credits", title: "Credits & Licenses", src: [{ label: "the repo", path: "" }],
    body: () => (
      <>
        <h2>Standing on excellent shoulders</h2>
        <p>· <b>Play!</b> — PS2 emulator, BSD-2-Clause · jpd002<br />
          · <b>EmulatorJS</b> — retro cores (GPLv3) · <b>js-dos</b> — DOSBox WASM<br />
          · <b>Ruffle</b> — Flash, MIT/Apache · <b>v86</b> — x86 in WASM, BSD-2<br />
          · <b>Stockfish</b> — GPLv3 · <b>chess.js</b> — MIT · <b>Webamp</b> — MIT<br />
          · <b>CesiumJS</b> — Apache-2.0 · <b>Leaflet</b> — BSD-2 · globe textures — Solar System Scope, CC BY 4.0<br />
          · <b>WebLLM</b> (MLC) — Apache-2.0 · <b>transformers.js</b> — Apache-2.0 · <b>Kokoro</b> — Apache-2.0<br />
          · <b>SolidJS</b> — MIT · the games you load are your own.</p>
        <h2>The point</h2>
        <p>Built by Abhishek Diwate as a living résumé: every feature here is the CV. The 3D sibling — an
          explorable open world with arcade cabinets — is one crossbar column away, under Projects → The Grove.</p>
      </>
    ),
  },
];

export default function Manual(props: { onClose: () => void }) {
  const [ch, setCh] = createSignal(0);
  let content!: HTMLDivElement;

  onMount(() => {
    setNavEnabled(false);
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") { sfx.back(); props.onClose(); }
      if (e.key === "ArrowLeft" && ch() > 0) { setCh(ch() - 1); content.scrollTop = 0; sfx.tickH(); }
      if (e.key === "ArrowRight" && ch() < CHAPTERS.length - 1) { setCh(ch() + 1); content.scrollTop = 0; sfx.tickH(); }
      if (e.key === "ArrowUp") { e.preventDefault(); content.scrollBy({ top: -140, behavior: "smooth" }); }
      if (e.key === "ArrowDown") { e.preventDefault(); content.scrollBy({ top: 140, behavior: "smooth" }); }
      // ✕ on the pad arrives as Enter — open this chapter's source on GitHub
      if (e.key === "Enter") { sfx.confirm(); window.open(srcUrl(CHAPTERS[ch()].src[0].path), "_blank"); }
    };
    addEventListener("keydown", keys);
    onCleanup(() => { removeEventListener("keydown", keys); setNavEnabled(true); });
  });

  return (
    <div class="manual">
      <div class="manual-head">
        <div class="panel-tag">SYSTEM MANUAL — HOW THIS CONSOLE IS BUILT</div>
        <span class="manual-head-btns">
          <a class="ps-act" href={REPO} target="_blank" rel="noopener">⌥ view source on GitHub</a>
          <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
        </span>
      </div>
      <div class="manual-body">
        <div class="manual-side">
          <For each={CHAPTERS}>
            {(c, i) => (
              <button class="manual-chap" classList={{ active: ch() === i() }}
                onClick={() => { setCh(i()); content.scrollTop = 0; sfx.tickH(); }}>
                <span class="manual-num">{String(i() + 1).padStart(2, "0")}</span>{c.title}
              </button>
            )}
          </For>
        </div>
        <div class="manual-content" ref={content}>
          <h1>{CHAPTERS[ch()].title}</h1>
          <div class="man-src">
            <span class="man-src-label">SOURCE</span>
            <For each={CHAPTERS[ch()].src}>
              {(s) => <a class="man-src-chip" href={srcUrl(s.path)} target="_blank" rel="noopener">{s.label}</a>}
            </For>
          </div>
          {CHAPTERS[ch()].body()}
        </div>
      </div>
      <div class="ps-legend">
        <span>←→ chapter</span>
        <span>↑↓ scroll</span>
        <span><span class="btn-x" /> view source</span>
        <span><span class="btn-o" /> back</span>
      </div>
    </div>
  );
}

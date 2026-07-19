// The published "Free & Open" catalog — the single source of truth read by the
// public Privacy/"Free & Open" app AND diffed against by the /admin review tool.
// Everything here is FREE, LEGAL and open (the non-piracy parts of FMHY).
//
// SOURCES lists the ONLY FMHY files the admin review queue is allowed to pull
// candidates from — deliberately the tool/knowledge files, NOT the streaming /
// download / torrent / ROM files. Belt (clean source) and suspenders (you still
// hand-review every candidate at /admin before it's published).

export type Tool = { name: string; url: string; note: string };
export type Cat = { title: string; tools: Tool[] };
/** An owner-published entry (added live from /admin via the KV-backed API). */
export type Entry = { id: string; name: string; url: string; note: string; category: string };

export const CATALOG_API = "/api/catalog";               // public read
export const CATALOG_WRITE_API = "/admin/api/catalog";   // write — behind Cloudflare Access
export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Merge owner-published entries onto the built-in catalog: append to a category
 *  of the same title, else add a new section. Used by the public app. */
export function mergeExtra(base: Cat[], entries: Entry[]): Cat[] {
  if (!entries.length) return base;
  const out: Cat[] = base.map((c) => ({ title: c.title, tools: [...c.tools] }));
  const idx = new Map(out.map((c, i) => [c.title.toLowerCase(), i] as const));
  for (const e of entries) {
    if (!e || !e.url) continue;
    const tool: Tool = { name: e.name || hostOf(e.url), url: e.url, note: e.note || "" };
    const cat = e.category || "Added by owner";
    const i = idx.get(cat.toLowerCase());
    if (i != null) out[i].tools.push(tool);
    else { idx.set(cat.toLowerCase(), out.length); out.push({ title: cat, tools: [tool] }); }
  }
  return out;
}

// whitelisted candidate sources for the /admin review queue (raw markdown).
export const SOURCES: { file: string; label: string }[] = [
  { file: "privacy.md", label: "Privacy & security" },
  { file: "ai.md", label: "AI tools" },
  { file: "developer-tools.md", label: "Developer tools" },
  { file: "educational.md", label: "Learning" },
  { file: "file-tools.md", label: "File tools" },
  { file: "image-tools.md", label: "Image tools" },
  { file: "video-tools.md", label: "Video tools" },
  { file: "text-tools.md", label: "Text tools" },
  { file: "internet-tools.md", label: "Internet tools" },
  { file: "gaming-tools.md", label: "Game tools & emulators" },
];

export const CATS: Cat[] = [
  {
    title: "AI tools",
    tools: [
      { name: "ChatGPT", url: "https://chatgpt.com/", note: "Free tier" },
      { name: "Claude", url: "https://claude.ai/", note: "Free tier" },
      { name: "Google AI Studio", url: "https://aistudio.google.com/", note: "Free Gemini access" },
      { name: "Perplexity", url: "https://www.perplexity.ai/", note: "AI answer engine" },
      { name: "Le Chat (Mistral)", url: "https://chat.mistral.ai/", note: "Free chat" },
      { name: "Hugging Face", url: "https://huggingface.co/", note: "Models + free Spaces" },
      { name: "Ollama", url: "https://ollama.com/", note: "Run LLMs locally" },
      { name: "LM Studio", url: "https://lmstudio.ai/", note: "Local LLM desktop app" },
      { name: "Fooocus", url: "https://github.com/lllyasviel/Fooocus", note: "Local image generation" },
    ],
  },
  {
    title: "Free & legal streaming",
    tools: [
      { name: "Internet Archive", url: "https://archive.org/", note: "Public-domain film, audio, books" },
      { name: "Tubi", url: "https://tubitv.com/", note: "Free legal movies & TV (ads)" },
      { name: "Pluto TV", url: "https://pluto.tv/", note: "Free legal live TV" },
      { name: "Plex (free)", url: "https://www.plex.tv/watch-free/", note: "Free legal movies & TV" },
      { name: "Crackle", url: "https://www.crackle.com/", note: "Free legal streaming" },
      { name: "Kanopy", url: "https://www.kanopy.com/", note: "Free with a library card" },
      { name: "Hoopla", url: "https://www.hoopladigital.com/", note: "Free with a library card" },
    ],
  },
  {
    title: "Books & reading",
    tools: [
      { name: "Project Gutenberg", url: "https://www.gutenberg.org/", note: "75k+ public-domain books" },
      { name: "Standard Ebooks", url: "https://standardebooks.org/", note: "Beautifully typeset PD books" },
      { name: "LibriVox", url: "https://librivox.org/", note: "Public-domain audiobooks" },
      { name: "Open Library", url: "https://openlibrary.org/", note: "Borrow & read (Internet Archive)" },
      { name: "Wikibooks", url: "https://www.wikibooks.org/", note: "Free open textbooks" },
    ],
  },
  {
    title: "Music & podcasts",
    tools: [
      { name: "Free Music Archive", url: "https://freemusicarchive.org/", note: "Free & CC-licensed music" },
      { name: "Bandcamp", url: "https://bandcamp.com/", note: "Free streaming + support artists" },
      { name: "Musopen", url: "https://musopen.org/", note: "Public-domain classical" },
      { name: "Jamendo", url: "https://www.jamendo.com/", note: "Creative-Commons music" },
      { name: "NTS Radio", url: "https://www.nts.live/", note: "Free global radio" },
      { name: "Radio Garden", url: "https://radio.garden/", note: "Spin the globe, hear local radio" },
      { name: "AntennaPod", url: "https://antennapod.org/", note: "Open-source podcast app" },
    ],
  },
  {
    title: "Games & emulators (legal)",
    tools: [
      { name: "itch.io", url: "https://itch.io/", note: "Indie & free games" },
      { name: "Epic Free Games", url: "https://store.epicgames.com/en-US/free-games", note: "Weekly free giveaways" },
      { name: "GOG", url: "https://www.gog.com/", note: "DRM-free store + free games" },
      { name: "IsThereAnyDeal", url: "https://isthereanydeal.com/", note: "Price & deal tracker" },
      { name: "RetroArch", url: "https://www.retroarch.com/", note: "All-in-one emulator frontend" },
      { name: "Dolphin", url: "https://dolphin-emu.org/", note: "GameCube / Wii emulator" },
      { name: "PCSX2", url: "https://pcsx2.net/", note: "PlayStation 2 emulator" },
      { name: "PPSSPP", url: "https://www.ppsspp.org/", note: "PSP emulator" },
      { name: "0 A.D.", url: "https://play0ad.com/", note: "Open-source RTS" },
      { name: "SuperTuxKart", url: "https://supertuxkart.net/", note: "Open-source kart racer" },
    ],
  },
  {
    title: "Learning",
    tools: [
      { name: "freeCodeCamp", url: "https://www.freecodecamp.org/", note: "Learn to code, free" },
      { name: "The Odin Project", url: "https://www.theodinproject.com/", note: "Full-stack curriculum" },
      { name: "MDN Web Docs", url: "https://developer.mozilla.org/", note: "The web reference" },
      { name: "Khan Academy", url: "https://www.khanacademy.org/", note: "Free courses, all ages" },
      { name: "MIT OpenCourseWare", url: "https://ocw.mit.edu/", note: "Real MIT course material" },
      { name: "CS50", url: "https://cs50.harvard.edu/x/", note: "Harvard's intro to CS" },
      { name: "roadmap.sh", url: "https://roadmap.sh/", note: "Developer learning paths" },
    ],
  },
  {
    title: "Developer tools",
    tools: [
      { name: "GitHub", url: "https://github.com/", note: "Code hosting" },
      { name: "Codeberg", url: "https://codeberg.org/", note: "Nonprofit Git hosting" },
      { name: "VS Code", url: "https://code.visualstudio.com/", note: "The editor" },
      { name: "StackBlitz", url: "https://stackblitz.com/", note: "Instant web IDE" },
      { name: "CodeSandbox", url: "https://codesandbox.io/", note: "Online IDE" },
      { name: "Cloudflare Pages", url: "https://pages.cloudflare.com/", note: "Free static hosting" },
      { name: "Hoppscotch", url: "https://hoppscotch.io/", note: "Open-source API client" },
      { name: "DevDocs", url: "https://devdocs.io/", note: "All docs, one search" },
      { name: "Excalidraw", url: "https://excalidraw.com/", note: "Whiteboard / diagrams" },
      { name: "regex101", url: "https://regex101.com/", note: "Build & test regex" },
    ],
  },
  {
    title: "Creative & file tools",
    tools: [
      { name: "Photopea", url: "https://www.photopea.com/", note: "Photoshop in the browser, free" },
      { name: "GIMP", url: "https://www.gimp.org/", note: "Open-source image editor" },
      { name: "Krita", url: "https://krita.org/", note: "Open-source painting" },
      { name: "Inkscape", url: "https://inkscape.org/", note: "Open-source vector editor" },
      { name: "Squoosh", url: "https://squoosh.app/", note: "Compress images" },
      { name: "HandBrake", url: "https://handbrake.fr/", note: "Video transcoder" },
      { name: "Audacity", url: "https://www.audacityteam.org/", note: "Audio editor" },
      { name: "VLC", url: "https://www.videolan.org/vlc/", note: "Plays anything" },
      { name: "CloudConvert", url: "https://cloudconvert.com/", note: "Convert any file" },
    ],
  },
  {
    title: "Legal downloads & open data",
    tools: [
      { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/", note: "Free media library" },
      { name: "Unsplash", url: "https://unsplash.com/", note: "Free-to-use photos" },
      { name: "Pexels", url: "https://www.pexels.com/", note: "Free photos & video" },
      { name: "OpenGameArt", url: "https://opengameart.org/", note: "Free game assets" },
      { name: "Ubuntu", url: "https://ubuntu.com/download", note: "Linux — free, legal ISOs / torrents" },
      { name: "Academic Torrents", url: "https://academictorrents.com/", note: "Research datasets over torrent" },
    ],
  },
  {
    title: "Browsers & anti-tracking",
    tools: [
      { name: "Tor Browser", url: "https://www.torproject.org/", note: "Onion-routed, anti-fingerprint" },
      { name: "Mullvad Browser", url: "https://mullvad.net/en/browser", note: "Tor's browser, without the Tor network" },
      { name: "LibreWolf", url: "https://librewolf.net/", note: "Hardened, telemetry-free Firefox" },
      { name: "arkenfox user.js", url: "https://github.com/arkenfox/user.js", note: "Firefox privacy tuning" },
      { name: "uBlock Origin", url: "https://github.com/gorhill/uBlock", note: "The ad / tracker blocker" },
      { name: "SponsorBlock", url: "https://sponsor.ajay.app/", note: "Skip in-video YouTube sponsors" },
    ],
  },
  {
    title: "Private search",
    tools: [
      { name: "Brave Search", url: "https://search.brave.com/", note: "Independent index" },
      { name: "DuckDuckGo", url: "https://duckduckgo.com/", note: "No tracking, bang shortcuts" },
      { name: "Startpage", url: "https://www.startpage.com/", note: "Google results, privately" },
      { name: "4get", url: "https://4get.ca/", note: "Open-source metasearch" },
    ],
  },
  {
    title: "VPN & tunnels",
    tools: [
      { name: "Proton VPN", url: "https://protonvpn.com/", note: "Free tier, unlimited data" },
      { name: "Mullvad VPN", url: "https://mullvad.net/", note: "No-log, anonymous account numbers" },
      { name: "Windscribe", url: "https://windscribe.com/", note: "10 GB/month free" },
      { name: "IVPN", url: "https://www.ivpn.net/", note: "Audited, no-log" },
      { name: "WireGuard", url: "https://www.wireguard.com/", note: "Modern VPN protocol" },
      { name: "Tailscale", url: "https://tailscale.com/", note: "WireGuard mesh between your devices" },
    ],
  },
  {
    title: "Network / DNS adblock",
    tools: [
      { name: "Pi-hole", url: "https://pi-hole.net/", note: "Network-wide DNS adblock" },
      { name: "AdGuard Home", url: "https://adguard.com/en/adguard-home/overview.html", note: "Self-hosted DNS filtering" },
      { name: "Cloudflare WARP", url: "https://one.one.one.one/", note: "Free encrypted DNS / tunnel" },
      { name: "Hagezi Blocklists", url: "https://github.com/hagezi/dns-blocklists", note: "Maintained DNS blocklists" },
      { name: "Safing Portmaster", url: "https://safing.io/", note: "Per-app firewall + DNS" },
    ],
  },
  {
    title: "Encrypted messengers",
    tools: [
      { name: "Signal", url: "https://signal.org/", note: "The standard; needs a phone #" },
      { name: "SimpleX", url: "https://simplex.chat/", note: "No user identifiers at all" },
      { name: "Molly", url: "https://github.com/mollyim/mollyim-android", note: "Hardened Signal fork (Android)" },
      { name: "Briar", url: "https://briarproject.org/", note: "P2P, works without internet" },
    ],
  },
  {
    title: "Private email",
    tools: [
      { name: "Proton Mail", url: "https://proton.me/mail", note: "Encrypted, free tier" },
      { name: "Tuta", url: "https://tuta.com/", note: "Encrypted, free tier" },
    ],
  },
  {
    title: "Passwords & 2FA",
    tools: [
      { name: "Bitwarden", url: "https://bitwarden.com/", note: "Open-source password manager" },
      { name: "KeePassXC", url: "https://keepassxc.org/", note: "Offline, local vault" },
      { name: "Ente Auth", url: "https://ente.io/auth/", note: "2FA, cross-platform" },
      { name: "Aegis", url: "https://getaegis.app/", note: "2FA (Android)" },
    ],
  },
  {
    title: "Scanners & breach checks",
    tools: [
      { name: "VirusTotal", url: "https://www.virustotal.com/", note: "Scan a file / URL with 70+ engines" },
      { name: "URLScan", url: "https://urlscan.io/", note: "Safely inspect what a site does" },
      { name: "Have I Been Pwned", url: "https://haveibeenpwned.com/", note: "Is your email in a breach?" },
      { name: "Cover Your Tracks", url: "https://coveryourtracks.eff.org/", note: "Test your browser fingerprint (EFF)" },
    ],
  },
  {
    title: "Anti-censorship",
    tools: [
      { name: "GoodbyeDPI", url: "https://github.com/ValdikSS/GoodbyeDPI/", note: "DPI bypass (Windows)" },
      { name: "ByeDPI (Android)", url: "https://github.com/dovecoteescapee/ByeDPIAndroid", note: "DPI bypass (Android)" },
      { name: "Snowflake", url: "https://snowflake.torproject.org/", note: "Lend bandwidth to bypass censorship" },
    ],
  },
  {
    title: "Privacy-first OS",
    tools: [
      { name: "Tails", url: "https://tails.net/", note: "Amnesic live USB, routes via Tor" },
      { name: "Whonix", url: "https://www.whonix.org/", note: "Tor-gated VMs" },
      { name: "Qubes OS", url: "https://www.qubes-os.org/", note: "Security by compartmentalization" },
    ],
  },
  {
    title: "Privacy guides",
    tools: [
      { name: "Privacy Guides", url: "https://www.privacyguides.org/", note: "The go-to reference" },
      { name: "EFF Surveillance Self-Defense", url: "https://ssd.eff.org/", note: "Practical, plain-language" },
      { name: "The New Oil", url: "https://thenewoil.org/", note: "Beginner-friendly" },
      { name: "Awesome Privacy", url: "https://awesome-privacy.xyz/", note: "Big curated index" },
      { name: "JustDeleteMe", url: "https://justdeleteme.xyz/", note: "Find how to delete old accounts" },
      { name: "ToS;DR", url: "https://tosdr.org/", note: "Terms of service, rated & summarized" },
    ],
  },
];

/** normalized set of every URL already published — for the /admin diff. */
export const publishedUrls = (): Set<string> =>
  new Set(CATS.flatMap((c) => c.tools.map((t) => t.url.replace(/\/+$/, "").toLowerCase())));

// All portfolio content — the XMB reads everything from here.

export const OWNER = {
  name: "Abhishek Diwate",
  title: "SDE 3 · AI",
  location: "Hyderabad, India",
  email: "abhishekdiwate879@gmail.com",
  phone: "+91 9834597155",
  linkedin: "https://linkedin.com/in/abhishekd879",
};

export interface XmbItem {
  id: string;
  title: string;
  sub?: string;
  icon: string; // key into icons.tsx
  action:
    | { type: "panel"; heading: string; tag?: string; body: string[] }
    | { type: "link"; href: string }
    | { type: "insert-disc" }
    | { type: "play-game"; gameId: string }
    | { type: "music-toggle" }
    | { type: "radio-guide" }
    | { type: "radio-play"; url: string; label: string }
    | { type: "photos-add" }
    | { type: "photos-view" }
    | { type: "whats-new" }
    | { type: "backup" }
    | { type: "restore" }
    | { type: "spotify"; url: string; label: string }
    | { type: "spotify-link" }
    | { type: "tv"; url: string; label: string }
    | { type: "tv-guide" }
    | { type: "tv-add" }
    | { type: "news"; source: "hn" | "devto" | "rss"; label: string; url?: string }
    | { type: "news-add" }
    | { type: "weather" }
    | { type: "photo" }
    | { type: "doom" }
    | { type: "chess" }
    | { type: "trivia" }
    | { type: "flash" }
    | { type: "video-ia" }
    | { type: "video-yt" }
    | { type: "podcasts" }
    | { type: "books" }
    | { type: "dictionary" }
    | { type: "map" }
    | { type: "apod" }
    | { type: "ai-chat" }
    | { type: "gesture-toggle" }
    | { type: "gamepad-test" }
    | { type: "ps2" }
    | { type: "webamp" }
    | { type: "youtube" }
    | { type: "timemachine" }
    | { type: "art" }
    | { type: "wiki" }
    | { type: "lichess-tv" }
    | { type: "themes" }
    | { type: "sound-toggle" }
    | { type: "switch-user" }
    | { type: "trophies" }
    | { type: "restart" };
}

export interface XmbCategory {
  id: string;
  label: string;
  icon: string;
  items: XmbItem[]; // game category items are injected at runtime
}

export const CAREER: { tag: string; title: string; meta: string; bullets: string[] }[] = [
  {
    tag: "MAY 2026 – PRESENT",
    title: "SDE 3 · AI — GoHighLevel",
    meta: "Voice AI · current mission",
    bullets: [
      "Built Performance AI Prompt Optimizer workflows for Voice AI agents — prompt evaluation, optimization review, scenario scoring, production apply paths.",
      "Designed production-safe eval-clone KB lifecycle: post-apply promote, detach, delete & runtime cleanup.",
      "Fixed daily-usage billing from billed call-duration seconds; unified Review & Apply CTAs behind a shared validation modal.",
    ],
  },
  {
    tag: "FEB 2025 – MAY 2026",
    title: "Product Development Engineer — Phenom People",
    meta: "Hyderabad",
    bullets: [
      "Engineered a universal “AI Operator” — one natural-language interface replacing fragmented No-Code logic. −80% workflow complexity (~130 nodes → 25).",
      "Architected the real-time Design-Time backend — FastAPI, WebSockets, microservices — prompts become dynamic code, compiled into DAGs.",
      "Agentic Map & Transform, RAG template matching & AI Testing Suite (Kafka, PostgreSQL) — −60% onboarding time.",
    ],
  },
  {
    tag: "AUG 2022 – JAN 2025",
    title: "Software Engineer — Ivy Comptech",
    meta: "Hyderabad",
    bullets: [
      "Modernized legacy codebases into modular architectures — −40% technical debt.",
      "Cut critical page load time −20% via lazy loading, bundle optimization & React architecture.",
      "Shipped 25+ reusable React UI components end-to-end through the full SDLC.",
    ],
  },
  {
    tag: "JAN – JUN 2022",
    title: "Automation Engineer — Outlearn",
    meta: "Remote",
    bullets: [
      "Automated critical Student Portal workflows with Python, Selenium & Pytest (Page Object Model, SQL-backed test data) — −75% manual testing hours per release.",
    ],
  },
  {
    tag: "2018 – 2022",
    title: "B.E. Computer Engineering — SPPU",
    meta: "Savitribai Phule Pune University",
    bullets: ["Graduated with a GPA of 8.8 / 10.0 — the base model, pre-training complete."],
  },
];

export const PROJECTS = [
  {
    title: "AI Prompt Optimizer",
    meta: "GoHighLevel · Voice AI",
    bullets: [
      "End-to-end prompt improvement loop for production voice agents: evaluate, review the optimization, score it against scenarios, apply safely to prod.",
      "Eval-clone knowledge-base lifecycle so experiments never leak into live agents.",
    ],
  },
  {
    title: "The AI Operator",
    meta: "Phenom · natural language → workflows",
    bullets: [
      "One NL interface replaced a maze of No-Code nodes: 130 → 25, −80% complexity.",
      "Real-time design-time backend: FastAPI + WebSockets; prompts compile into executable DAGs.",
    ],
  },
  {
    title: "AI Testing Suite",
    meta: "Phenom · Kafka + PostgreSQL",
    bullets: [
      "Agentic Map & Transform with RAG template matching.",
      "Cut customer onboarding time by 60%.",
    ],
  },
  {
    title: "Component Library",
    meta: "Ivy Comptech · React",
    bullets: [
      "25+ reusable UI components shipped through the full SDLC.",
      "−40% tech debt, −20% critical page load.",
    ],
  },
  {
    title: "The Grove",
    meta: "This portfolio's sibling — a 3D open world",
    bullets: [
      "Three.js open-world portfolio with playable arcade cabinets, a drivable car, a shooting range and a diveable résumé pool.",
      "You are currently inside variant two: the console.",
    ],
  },
];

export const SKILLS = [
  { name: "AI / ML", items: ["Agentic Systems", "RAG", "LangChain", "GenAI", "NLP", "Prompt Engineering"] },
  { name: "Frontend", items: ["React", "SolidJS", "NextJS", "TypeScript", "Tailwind", "Three.js"] },
  { name: "Backend", items: ["FastAPI", "NestJS", "Node.js", "Kafka", "GraphQL", "WebSockets"] },
  { name: "Data", items: ["PostgreSQL", "MongoDB", "Oracle"] },
  { name: "DevOps", items: ["Docker", "AWS", "CI/CD", "Jenkins"] },
];

export interface TrophyDef {
  id: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
  name: string;
  desc: string;
}

export const TROPHIES: TrophyDef[] = [
  { id: "boot", tier: "bronze", name: "It Still Turns On", desc: "Booted the console" },
  { id: "profile", tier: "bronze", name: "New Challenger", desc: "Created a user profile" },
  { id: "historian", tier: "silver", name: "Historian", desc: "Read every career entry" },
  { id: "curious", tier: "bronze", name: "Window Shopper", desc: "Opened every project" },
  { id: "polyglot", tier: "bronze", name: "Polyglot", desc: "Inspected every skill group" },
  { id: "disc", tier: "gold", name: "Disc Spinner", desc: "Booted a game from your own disc" },
  { id: "collector", tier: "silver", name: "Shelf of Shame", desc: "3 games in your library" },
  { id: "network", tier: "bronze", name: "Cold Caller", desc: "Reached for a contact link" },
  { id: "dj", tier: "bronze", name: "Needle Drop", desc: "Played some music" },
  { id: "stylist", tier: "bronze", name: "Interior Decorator", desc: "Changed the console theme" },
  { id: "zapper", tier: "bronze", name: "Channel Surfer", desc: "Watched live TV" },
  { id: "wellread", tier: "bronze", name: "Well Read", desc: "Opened the news" },
  { id: "worldband", tier: "bronze", name: "World Band", desc: "Tuned into internet radio" },
  { id: "shutterbug", tier: "bronze", name: "Shutterbug", desc: "Added photos to the gallery" },
  { id: "konami", tier: "silver", name: "The Old Ways", desc: "↑↑↓↓←→←→BA" },
  { id: "doomguy", tier: "gold", name: "Rip and Tear", desc: "Booted DOOM on the console" },
  { id: "tactician", tier: "silver", name: "Tactician", desc: "Played chess against Stockfish" },
  { id: "quizmaster", tier: "silver", name: "Quizmaster", desc: "Scored 8+ in the trivia arcade" },
  { id: "cinephile", tier: "bronze", name: "Cinephile", desc: "Watched something from the archive" },
  { id: "bookworm", tier: "bronze", name: "Bookworm", desc: "Searched the library" },
  { id: "stargazer", tier: "bronze", name: "Stargazer", desc: "Viewed the astronomy photo of the day" },
  { id: "aifriend", tier: "gold", name: "Ghost in the Machine", desc: "Talked to the on-device AI" },
  { id: "timetraveler", tier: "silver", name: "Time Traveler", desc: "Visited the old web" },
  { id: "curator", tier: "bronze", name: "Curator", desc: "Toured the art gallery" },
];

export const CATEGORIES: XmbCategory[] = [
  {
    id: "users",
    label: "Users",
    icon: "user",
    items: [
      { id: "ai", title: "AI Abhishek", sub: "On-device LLM — ask about my work", icon: "chip", action: { type: "ai-chat" } },
      { id: "whatsnew", title: "What's New", sub: "Your activity on this console", icon: "spark", action: { type: "whats-new" } },
      { id: "trophies", title: "Trophy Collection", sub: "Your haul so far", icon: "trophy", action: { type: "trophies" } },
      { id: "photo", title: "Profile Photo", sub: "Upload your own avatar", icon: "camera", action: { type: "photo" } },
      { id: "switch", title: "Switch User", sub: "Back to profile select", icon: "users", action: { type: "switch-user" } },
      {
        id: "about-owner", title: "About Abhishek", sub: OWNER.title, icon: "id",
        action: {
          type: "panel", heading: OWNER.name, tag: OWNER.title + " · " + OWNER.location,
          body: [
            "AI-first product engineer. Ships agentic systems, voice AI tooling and the interfaces around them.",
            "Currently building Voice AI prompt optimization at GoHighLevel.",
            "Previously compressed a 130-node No-Code maze into one natural-language operator at Phenom.",
          ],
        },
      },
    ],
  },
  {
    id: "career",
    label: "Career",
    icon: "briefcase",
    items: CAREER.map((c, i) => ({
      id: `career-${i}`,
      title: c.title.split(" — ")[1] ?? c.title,
      sub: c.tag,
      icon: "disc-doc",
      action: { type: "panel", heading: c.title, tag: `${c.tag} · ${c.meta}`, body: c.bullets },
    })),
  },
  {
    id: "projects",
    label: "Projects",
    icon: "folder",
    items: PROJECTS.map((p, i) => ({
      id: `project-${i}`,
      title: p.title,
      sub: p.meta,
      icon: "cube",
      action: { type: "panel", heading: p.title, tag: p.meta, body: p.bullets },
    })),
  },
  {
    id: "skills",
    label: "Skills",
    icon: "chip",
    items: SKILLS.map((s, i) => ({
      id: `skill-${i}`,
      title: s.name,
      sub: `${s.items.length} equipped`,
      icon: "spark",
      action: { type: "panel", heading: s.name, tag: "SKILL GROUP", body: [s.items.join("  ·  ")] },
    })),
  },
  {
    id: "photo",
    label: "Photo",
    icon: "camera",
    items: [], // injected: slideshow + add photos
  },
  {
    id: "video",
    label: "Video",
    icon: "film",
    items: [
      { id: "yt", title: "YouTube", sub: "Trending, search & play — no account", icon: "play", action: { type: "youtube" } },
      { id: "ia-video", title: "Archive Cinema", sub: "Public-domain films from archive.org", icon: "film", action: { type: "video-ia" } },
    ],
  },
  {
    id: "game",
    label: "Game",
    icon: "gamepad",
    items: [], // injected: insert disc + per-profile library
  },
  {
    id: "tv",
    label: "TV",
    icon: "tv",
    items: [], // injected: live channels + user-added HLS streams
  },
  {
    id: "news",
    label: "News",
    icon: "rss",
    items: [], // injected: built-in readers + user RSS feeds
  },
  {
    id: "music",
    label: "Music",
    icon: "note",
    items: [], // injected: radio + Spotify players + user-linked playlists
  },
  {
    id: "network",
    label: "Network",
    icon: "globe",
    items: [
      { id: "email", title: "Send Mail", sub: OWNER.email, icon: "mail", action: { type: "link", href: `mailto:${OWNER.email}` } },
      { id: "linkedin", title: "LinkedIn", sub: "abhishekd879", icon: "link", action: { type: "link", href: OWNER.linkedin } },
      { id: "phone", title: "Call", sub: OWNER.phone, icon: "phone", action: { type: "link", href: `tel:${OWNER.phone.replace(/\s/g, "")}` } },
      { id: "weather", title: "Weather", sub: "Live conditions & forecast", icon: "cloud", action: { type: "weather" } },
      { id: "map", title: "Planet Earth", sub: "Live map — quakes & rain radar", icon: "globe", action: { type: "map" } },
      { id: "tm", title: "Time Machine", sub: "Browse any website in 1996–today", icon: "power", action: { type: "timemachine" } },
      { id: "dict", title: "Dictionary", sub: "Look up any English word", icon: "disc-doc", action: { type: "dictionary" } },
      { id: "wiki", title: "Wikipedia", sub: "Search & read, console style", icon: "book", action: { type: "wiki" } },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "gear",
    items: [
      { id: "theme", title: "Theme", sub: "Change the console colour", icon: "spark", action: { type: "themes" } },
      { id: "sound", title: "Sound", sub: "Toggle console audio", icon: "speaker", action: { type: "sound-toggle" } },
      { id: "gesture", title: "Camera Navigation", sub: "Beta — wave at the webcam to browse", icon: "camera", action: { type: "gesture-toggle" } },
      { id: "padtest", title: "Controller Test", sub: "Live diagnostic — is your gamepad seen?", icon: "gamepad", action: { type: "gamepad-test" } },
      {
        id: "sysinfo", title: "System Information", sub: "Portfolio console", icon: "info",
        action: {
          type: "panel", heading: "Portfolio Console", tag: "SYSTEM SOFTWARE 1.1",
          body: [
            "Interface: cross-media bar — SolidJS + TypeScript + Three.js + GSAP.",
            "Disc drive: EmulatorJS — reads GBA, GB/GBC, NES, SNES, Mega Drive, N64, NDS. Discs are read locally in your browser; nothing is uploaded.",
            "Music: built-in generative radio, plus Spotify playback.",
            "Profiles, trophies, themes and your game library are stored only in this browser.",
          ],
        },
      },
      { id: "backup", title: "Back Up Console Data", sub: "Profiles, trophies & links → JSON file", icon: "disc-doc", action: { type: "backup" } },
      { id: "restore", title: "Restore Backup", sub: "Load a console backup file", icon: "folder", action: { type: "restore" } },
      { id: "restart", title: "Restart Console", sub: "Full boot sequence", icon: "power", action: { type: "restart" } },
    ],
  },
];

// PS3-style monthly XMB theme colors (approximation of the classic rotation)
export const MONTH_COLORS = [
  "#8a8f98", "#c8b45a", "#7fb069", "#e8a0b4", "#3e9b6e", "#a884c8",
  "#3fa7a0", "#4a7fc8", "#8e6bb4", "#c88a3f", "#8a6f4d", "#c85555",
];

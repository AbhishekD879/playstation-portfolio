# CLAUDE.md — AbhishekStation Memory & System Specs

## 1. Project Identity
* **Project Name:** AbhishekStation (PlayStation Portfolio System Software)
* **Repo:** `~/playstation-portfolio`
* **Purpose:** A web-based simulation of a PlayStation OS/Game Console (`AbhishekStation`). It features retro-futuristic UI/UX, 3D graphics (XMB), and system software logic.

## 2. Core Architecture
* **Framework:** Solid.js (compiled to vanilla JS). State uses `createSignal`, `createMemo`, and `createEffect`.
* **State Machine (`App.tsx`):** 
  1. `boot`: The "void wakes up" cinematic.
  2. `profiles`: User profile selection.
  3. `xmb`: The XrossMediaBar main interface.
  4. `session`: Playing a specific app or emulator.
* **Routing:** Relies entirely on URL Hash (e.g., `#/app/doom`, `#/<category-id>`) to ensure deep-links work without server configuration and avoid path-based conflicts.

## 3. UI & Visual Philosophy (The "PS2 Soul")
* **Navigation:** Classic PlayStation-style XMB (Horizontal Categories -> Vertical Items). 
* **Boot Sequence:** A choreographed timeline of galaxies swirling, collapsing into a core, and igniting into a ripple wave. Skippable via `Enter`, `click`, or controller. Uses Three.js (CPU WebGL) and Three TSL (WebGPU) dual-paths for rendering starfields.
* **Themes & Labs:** Heavily utilizes user-configurable HSL swatches and experimental "Labs" toggles to enable complex features like CRT screen effects or modern CSS polish layers.

## 4. Key System Modules
### 🎮 `src/xmb/XMB.tsx` (The Main Console)
* **Categories:** Career, Projects, Game Library (DOOM, Chess, Trivia), Music (Radio, Winamp, Spotify), TV/News, and Photo Gallery. 
* **State Management:** LocalStorage persistence for Profiles, Trophies (PlayStation-style unlockable badges), Playtime tracking, and Themes.
* **Apps Engine:** Dynamically renders components based on the hash route (e.g., `Doom`, `Cinema`, `Studio`).

### 🎛️ Emulation & Games (`src/gamesdb.ts`, `src/xmb/Ps2.tsx`, etc.)
* **Gameshelf:** Handles custom game libraries via Filesystem Access API (`Link Games from Disk`) or local blob storage. 
* **Emulators:** Supports PS2 (Play! core), PSP (PPSSPP), PS1, and general web exports (Godot/Unity/Wolf RPG).

### 🎚️ System Tools
* **Control Center (`src/xmb/ControlCenter.tsx`):** Quick toggles for Sound, Volume, Bluetooth/Battery status.
* **P2P WebRTC:** Built-in peer-to-peer infrastructure for Watch Parties and multiplayer sessions (via `trystero`).

## 5. Development & Runtime Rules
* **Startup:** Vite (`npm run dev` on port 5300). 
* **Browser Requirements:** Uses PWA standards, LocalStorage, WebAudio, and conditional WebGPU fallbacks for advanced effects.
* **Assets:** All images and sounds live in `public/`. Audio uses synthesized FM/XA formats rather than MP3s where possible to mimic PS1/PS2 DSP chips.

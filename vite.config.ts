import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { multiplayerSignaling } from "./vite-plugin-mp";

// Cross-origin isolation (COOP + COEP:credentialless) turns on SharedArrayBuffer,
// which the in-browser PS2 emulator (Play!.js) needs for its threads. We use
// `credentialless` (not `require-corp`) so our third-party embeds — YouTube,
// Spotify, archive.org, Lichess — still load; each such <iframe> carries the
// `credentialless` attribute to satisfy the policy.
// NOTE for production: the host must send these same two response headers
// (e.g. Vercel/Netlify header config) or PS2 falls back to "open in a new tab".
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [
    // /j2me/ is served without the isolation headers (see public/_headers): the
    // Java ME player opens as its own tab because CheerpJ's helper frame cannot
    // be embedded under COEP. Mirrors the production rule for local testing.
    {
      // Big binaries (Quake, OpenTTD, Diablo, Jazz², Cataclysm, Endless Sky…)
      // are not in public/ — they live in R2 and, for dev, in the gitignored
      // r2/ mirror at the same paths.
      //
      // Which directories those are is NOT listed here. It was, and the list
      // silently went stale the moment a game was added: the new files fell
      // through to the single-page fallback and every request answered 200 with
      // the console's own index.html, which looks exactly like a broken build.
      // The mirror's own contents are the authority — a file either is in r2/
      // or it is not — so the only checks left are the ones that matter:
      // it resolves inside the mirror, and it is a real file.
      name: "r2-mirror",
      configureServer(server) {
        const root = resolve("r2");
        const TYPES: Record<string, string> = {
          wasm: "application/wasm", js: "text/javascript", json: "application/json",
          ttf: "font/ttf", woff2: "font/woff2", mp3: "audio/mpeg", ogg: "audio/ogg",
          png: "image/png", jpg: "image/jpeg", webp: "image/webp", css: "text/css",
        };
        server.middlewares.use((req, res, next) => {
          const path = decodeURIComponent((req.url ?? "").split("?")[0]);
          if (!path.startsWith("/") || path.includes("..")) return next();
          const file = resolve(root, "." + path);
          // resolve() has already normalised the path; this is what stops a
          // crafted request reading outside the mirror.
          if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader("content-type", TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream");
          res.setHeader("content-length", String(statSync(file).size));
          res.setHeader("x-asset-source", "r2-mirror");
          createReadStream(file).pipe(res);
        });
      },
    },
    {
      name: "j2me-no-isolation",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/j2me/")) {
            const set = res.setHeader.bind(res);
            res.setHeader = (name: string, value: number | string | readonly string[]) =>
              /^cross-origin-(embedder|opener)-policy$/i.test(name) ? res : set(name, value);
          }
          next();
        });
      },
    },solid(), multiplayerSignaling()],
  assetsInclude: ["**/*.pk3"], // Xash3D/CS engine asset packs imported via ?url
  // Two HTML entries: the console (index.html) and the internal /admin review
  // tool (admin.html → served by Pages at /admin). Both boot the same main.tsx,
  // which branches on location.pathname.
  build: { rollupOptions: { input: { main: "index.html", admin: "admin.html" } } },
  server: {
    allowedHosts: true,
    headers: isolation,
    // guestbook API is a Cloudflare Pages Function — run `npx wrangler pages dev dist
    // --port 8788` alongside for local end-to-end, or the app degrades gracefully
    proxy: { "/api": "http://localhost:8788" },
  },
  preview: { headers: isolation },
});

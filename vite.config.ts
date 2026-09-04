import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
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
      // Big binaries (Quake, OpenTTD, Diablo, Jazz²) are not in public/ — they
      // live in R2 and, for dev, in the gitignored r2/ mirror at the same paths.
      name: "r2-mirror",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = decodeURIComponent((req.url ?? "").split("?")[0]);
          const file = resolve("r2", "." + path);
          if (!/^\/(quake|openttd|diablo|jazz2)\//.test(path) || path.includes("..") || !existsSync(file) || !statSync(file).isFile()) return next();
          const ext = path.split(".").pop() ?? "";
          res.setHeader("content-type", ext === "wasm" ? "application/wasm" : ext === "js" ? "text/javascript" : "application/octet-stream");
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

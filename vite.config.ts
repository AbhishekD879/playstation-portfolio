import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

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
  plugins: [solid()],
  server: {
    allowedHosts: true,
    headers: isolation,
    // guestbook API is a Cloudflare Pages Function — run `npx wrangler pages dev dist
    // --port 8788` alongside for local end-to-end, or the app degrades gracefully
    proxy: { "/api": "http://localhost:8788" },
  },
  preview: { headers: isolation },
});

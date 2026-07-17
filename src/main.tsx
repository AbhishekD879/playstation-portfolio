/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "./styles.css";

render(() => <App />, document.getElementById("root")!);

// PWA: register the service worker (offline shell + installability). Prod only —
// in dev it interferes with Vite's HMR.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  // when a fresh deploy's worker takes over, reload once so the user always
  // lands on the latest build instead of a cached shell. Only when a worker was
  // already in control (an update) — never on the very first visit.
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
}


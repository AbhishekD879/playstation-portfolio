/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "./styles.css";

render(() => <App />, document.getElementById("root")!);

// PWA: register the service worker (offline shell + installability). Prod only —
// in dev it interferes with Vite's HMR.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

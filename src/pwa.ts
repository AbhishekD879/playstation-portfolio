// Install-as-app (PWA) helpers. The console is already an installable PWA
// (manifest display:standalone + apple-mobile-web-app-capable), so once it's on
// the home screen it launches with NO browser chrome — which is the only way to
// get true device fullscreen for a game canvas on iOS Safari. This module makes
// that discoverable: on Chromium it captures the install prompt so we can offer
// a one-tap "install" button; on iOS there is no prompt API, so callers fall
// back to the Share → Add to Home Screen instruction.
import { createSignal } from "solid-js";

type PromptEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };

const [installable, setInstallable] = createSignal(false);
let deferred: PromptEvent | null = null;

addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();            // suppress the default mini-infobar; we surface our own
  deferred = e as PromptEvent;
  setInstallable(true);
});
addEventListener("appinstalled", () => { deferred = null; setInstallable(false); });

/** Reactive: true when the browser has offered an installable prompt (Chromium). */
export { installable };

/** Already running as an installed app (no browser chrome)? */
export function isStandalone(): boolean {
  return !!(window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: fullscreen)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone);
}

/** iOS Safari (incl. iPadOS reporting as Mac) — no install prompt API, manual only. */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Fire the native install prompt (Chromium). Resolves true if the user installed. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === "accepted") { deferred = null; setInstallable(false); }
  return outcome === "accepted";
}

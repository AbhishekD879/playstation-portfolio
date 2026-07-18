// XMB Tab Sync — BroadcastChannel keeps every open AbhishekStation tab in
// agreement: Labs flags, theme tint, background mode, icon overrides and font
// prefs applied in one tab land in the others instantly (the Gmail
// sign-out-everywhere trick, minus the server). Loop-safe: incoming messages
// write storage + reload the relevant signals without re-broadcasting.
import { labEnabled } from "./labs";

type Msg = { key: string; value: string | null };

let chan: BroadcastChannel | null = null;
let applying = false;

const SYNCED_KEYS = ["asp.labs.off", "asp.theme", "asp.bg", "asp.icons", "asp.font", "asp.track", "asp.uisize", "asp.lang", "asp.vol", "asp.muted"];

export function startTabSync() {
  if (chan || typeof BroadcastChannel === "undefined") return;
  if (!labEnabled("tabsync")) return;
  chan = new BroadcastChannel("asp-sync");

  // outgoing: mirror every synced localStorage write
  const origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string) => {
    origSet(key, value);
    if (!applying && SYNCED_KEYS.includes(key)) chan?.postMessage({ key, value } as Msg);
  };

  // incoming: persist, then reload — a full state re-derive beats trying to
  // patch a dozen live signals; the reload lands back on the XMB instantly.
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  chan.onmessage = (e: MessageEvent<Msg>) => {
    const { key, value } = e.data ?? {};
    if (!key || !SYNCED_KEYS.includes(key)) return;
    applying = true;
    try { value === null ? localStorage.removeItem(key) : origSet(key, value); } finally { applying = false; }
    // debounce: a burst of toggles reloads once. Never reload mid-game — the
    // sync applies next time this tab is on the plain crossbar.
    if (document.querySelector(".session, .ps2, .fullapp, .karaoke")) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      sessionStorage.setItem("asp.resume", localStorage.getItem("asp.lastProfile") ?? "");
      location.reload();
    }, 700);
  };
}

// Java ME games run in their own tab, not in the console frame: CheerpJ (the
// Java runtime) opens a helper frame from its CDN, and a document under our
// cross-origin isolation may only embed frames that are themselves isolated —
// which CheerpJ's is not. So /j2me/ is served without those headers and opened
// as a top-level page. COOP means the new tab has no `opener`, so the JAR is
// handed over through IndexedDB (same origin, shared between tabs).
import { resolveGameFile, type GameRecord } from "./gamesdb";

const DB = "asp-j2me";
const STORE = "boot";
export const PENDING = "pending";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function stageJar(name: string, bytes: ArrayBuffer): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ name, bytes, at: Date.now() }, PENDING);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

/** Open the Java ME player in a new tab and hand it the game. The tab is opened
 *  first, synchronously, so it still counts as the player's click (popup rules);
 *  the page then waits for the JAR to appear in IndexedDB. */
export function bootJ2me(g: GameRecord, playerUrl = "/j2me/player.html"): Window | null {
  const win = window.open(`${playerUrl}?boot=1`, "_blank");
  void (async () => {
    try { stageJar(g.name, await (await resolveGameFile(g)).arrayBuffer()); }
    catch (e) { console.warn("[j2me] could not stage the JAR", e); }
  })();
  return win;
}

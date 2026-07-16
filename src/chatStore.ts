// Persistent AI-chat storage in IndexedDB (localStorage is too small for long
// transcripts + the agent's message context). One record per profile holds
// both the visible transcript and the agent's real LLM message history, so a
// reopened chat shows the same bubbles AND the model still remembers.
const DB = "asp-chat";
const STORE = "chats";

export interface StoredChat {
  items: unknown[];      // ChatItem[] — the visible transcript (incl. widgets)
  messages: unknown[];   // pi AgentMessage[] — the model's memory
  modelKey?: string;     // which brain was last used
}

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function loadChat(key: string): Promise<StoredChat | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => res((req.result as StoredChat) ?? null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}

export async function saveChat(key: string, data: StoredChat): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res) => {
      const req = d.transaction(STORE, "readwrite").objectStore(STORE).put(data, key);
      req.onsuccess = () => res();
      req.onerror = () => res();
    });
  } catch { /* private mode / quota — chat just won't persist */ }
}

export async function clearChat(key: string): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res) => {
      const req = d.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
      req.onsuccess = () => res();
      req.onerror = () => res();
    });
  } catch { /* ignore */ }
}

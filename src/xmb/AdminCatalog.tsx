// /admin — the Free & Open CMS (Cloudflare Access-gated at the edge).
//   • Published entries: add / delete YOUR OWN links (any category) and PUBLISH
//     live to the public app — no code changes, no redeploy (KV via /api/catalog).
//   • Candidate queue: pulls LIVE from the whitelisted FMHY tool/knowledge files
//     (freecatalog.SOURCES — never streaming/torrent/download/ROM), diffs against
//     what's already live, and lets you validate (urlscan / VirusTotal) + approve
//     each into your published set. You are the human gate.
//
// Adding a NEW bulk scrape-source is a one-line edit to SOURCES in
// freecatalog.ts (owner-controlled, in-repo) — kept clean by design.
import { For, Show, createSignal, onMount } from "solid-js";
import { CATALOG_API, CATALOG_AUTH_API, CATALOG_WRITE_API, CATS, SOURCES, hostOf, publishedUrls, type Entry } from "../freecatalog";

type Cand = { name: string; url: string; note: string; source: string };
const RAW = "https://raw.githubusercontent.com/fmhy/edit/main/docs/";
const CATEGORIES = CATS.map((c) => c.title);
const uid = () => { try { return crypto.randomUUID(); } catch { return "e" + Math.random().toString(36).slice(2); } };
const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

function parseMd(md: string, source: string): Cand[] {
  const out: Cand[] = [];
  const seen = new Set<string>();
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!/^[*-]\s/.test(line)) continue;
    const m = line.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (!m) continue;
    const name = m[1].replace(/[⭐🌟*_`>▷►]/g, "").trim();
    const url = m[2].trim().replace(/\/+$/, "");
    if (!name || !url || seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    const parts = line.split(/\s[-—]\s/);
    let note = parts.length > 1 ? parts.slice(1).join(" - ") : "";
    note = note.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 110);
    out.push({ name, url, note, source });
  }
  return out;
}

const AKEY = "asp.admin.key";

export default function AdminCatalog() {
  // —— admin login (password gates ONLY /admin; the public site is untouched) ——
  const [authed, setAuthed] = createSignal(false);
  const [keyInput, setKeyInput] = createSignal("");
  const [authMsg, setAuthMsg] = createSignal("");
  let adminKey = sessionStorage.getItem(AKEY) ?? "";

  async function tryLogin(pw: string) {
    setAuthMsg("checking…");
    try {
      const r = await fetch(CATALOG_AUTH_API, { method: "POST", headers: { "x-admin-key": pw } });
      if (r.ok) { adminKey = pw; sessionStorage.setItem(AKEY, pw); setAuthed(true); setAuthMsg(""); void loadEntries().then(loadCands); return; }
      const j = await r.json().catch(() => ({}));
      setAuthMsg(r.status === 503 ? ((j as { error?: string }).error ?? "ADMIN_KEY not set yet") : "wrong password");
      if (r.status !== 503) { sessionStorage.removeItem(AKEY); adminKey = ""; }
    } catch { setAuthMsg("network error"); }
  }
  const logout = () => { sessionStorage.removeItem(AKEY); adminKey = ""; setAuthed(false); setKeyInput(""); };

  // —— published (owner) entries ——
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [pub, setPub] = createSignal("");
  const [fName, setFName] = createSignal("");
  const [fUrl, setFUrl] = createSignal("");
  const [fNote, setFNote] = createSignal("");
  const [fCat, setFCat] = createSignal(CATEGORIES[0]);

  // —— candidate queue from whitelisted sources ——
  const SKEY = "asp.admin.sources.off";
  const loadOff = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(SKEY) ?? "[]")); } catch { return new Set(); } };
  const [off, setOff] = createSignal<Set<string>>(loadOff());
  const srcOn = (f: string) => !off().has(f);
  const toggleSrc = (f: string) => { const s = new Set(off()); s.has(f) ? s.delete(f) : s.add(f); setOff(s); localStorage.setItem(SKEY, JSON.stringify([...s])); void loadCands(); };
  const [cands, setCands] = createSignal<Cand[]>([]);
  const [status, setStatus] = createSignal("loading…");
  const [q, setQ] = createSignal("");

  // everything already live: built-in catalog ∪ published entries
  const liveSet = () => { const s = publishedUrls(); for (const e of entries()) s.add(norm(e.url)); return s; };

  async function loadEntries() {
    try { const r = await fetch(CATALOG_API); const j = await r.json() as { entries?: Entry[] }; setEntries(Array.isArray(j.entries) ? j.entries : []); } catch { /* none yet */ }
  }
  async function loadCands() {
    setStatus("fetching enabled sources…");
    const live = liveSet();
    const active = SOURCES.filter((s) => srcOn(s.file));
    const all: Cand[] = []; const seen = new Set<string>(); let ok = 0, fail = 0;
    await Promise.all(active.map(async (s) => {
      try {
        const r = await fetch(RAW + s.file, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        for (const c of parseMd(await r.text(), s.label)) {
          const k = norm(c.url);
          if (live.has(k) || seen.has(k)) continue;
          seen.add(k); all.push(c);
        }
        ok++;
      } catch { fail++; }
    }));
    all.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    setCands(all);
    setStatus(`${all.length} new candidates · ${ok}/${active.length} sources${fail ? ` · ${fail} failed (CORS/offline?)` : ""}`);
  }
  // resume a session if a password is already stored (verify it's still valid)
  onMount(() => { if (adminKey) void tryLogin(adminKey); });

  function addEntry() {
    const url = fUrl().trim();
    if (!/^https?:\/\//i.test(url)) { setPub("enter a valid http(s) URL"); return; }
    if (liveSet().has(norm(url))) { setPub("that URL is already in the catalog"); return; }
    setEntries([...entries(), { id: uid(), name: fName().trim() || hostOf(url), url, note: fNote().trim(), category: fCat() }]);
    setDirty(true); setFName(""); setFUrl(""); setFNote(""); setPub("added — remember to Publish");
  }
  const removeEntry = (id: string) => { setEntries(entries().filter((e) => e.id !== id)); setDirty(true); };
  function approve(c: Cand) {
    setEntries([...entries(), { id: uid(), name: c.name, url: c.url, note: c.note, category: c.source }]);
    setCands(cands().filter((x) => x.url !== c.url)); setDirty(true);
  }

  async function publish() {
    setPub("publishing…");
    try {
      const r = await fetch(CATALOG_WRITE_API, { method: "POST", headers: { "content-type": "application/json", "x-admin-key": adminKey }, body: JSON.stringify({ entries: entries() }) });
      const j = await r.json() as { count?: number; error?: string };
      if (r.ok) { setDirty(false); setPub(`✓ published ${j.count} entries — live on the site now`); }
      else { setPub(`✗ ${j.error || r.status}`); if (r.status === 401) logout(); }
    } catch { setPub("✗ network error"); }
  }

  const shown = () => { const f = q().toLowerCase().trim(); return f ? cands().filter((c) => (c.name + " " + c.url + " " + c.source + " " + c.note).toLowerCase().includes(f)) : cands(); };
  const byCat = () => { const m = new Map<string, Entry[]>(); for (const e of entries()) { const c = e.category || "Added by owner"; if (!m.has(c)) m.set(c, []); m.get(c)!.push(e); } return [...m]; };

  return (
    <Show when={authed()} fallback={
      <div class="adm adm-login">
        <div class="adm-login-box">
          <div class="adm-login-title">🔒 Admin</div>
          <div class="adm-login-sub">Only you get in here. The public site has no login and is unaffected.</div>
          <input class="adm-search" type="password" autocomplete="current-password" placeholder="admin password"
            value={keyInput()} onInput={(e) => setKeyInput(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void tryLogin(keyInput()); }} />
          <button class="adm-btn primary" onClick={() => void tryLogin(keyInput())}>unlock</button>
          <Show when={authMsg()}><div class="adm-login-msg">{authMsg()}</div></Show>
        </div>
      </div>
    }>
    <div class="adm">
      <div class="adm-bar">
        <b>ADMIN · FREE &amp; OPEN CMS</b>
        <span class="adm-actions">
          <button class="adm-btn primary" classList={{ dirty: dirty() }} onClick={publish}>{dirty() ? "● publish changes" : "publish"}</button>
          <span class="adm-status">{pub()}</span>
          <button class="adm-btn" onClick={logout}>lock</button>
        </span>
      </div>
      <div class="adm-warn">
        Publishing is authorized by <b>Cloudflare Access</b> on <code>/admin</code> (no env vars, no tokens to manage). Entries publish live to the public app.
        Bulk scrape-sources are the whitelisted tool files only — edit <code>freecatalog.ts</code> to change them.
      </div>

      {/* —— published entries (your CMS) —— */}
      <div class="adm-section">Published entries — add your own, publishes live</div>
      <div class="adm-form">
        <input class="adm-search" placeholder="name" value={fName()} onInput={(e) => setFName(e.currentTarget.value)} />
        <input class="adm-search adm-grow" placeholder="https://…" value={fUrl()} onInput={(e) => setFUrl(e.currentTarget.value)} />
        <input class="adm-search" placeholder="short note" value={fNote()} onInput={(e) => setFNote(e.currentTarget.value)} />
        <select class="adm-search" value={fCat()} onChange={(e) => setFCat(e.currentTarget.value)}>
          <For each={CATEGORIES}>{(c) => <option value={c}>{c}</option>}</For>
          <option value="Added by owner">Added by owner</option>
        </select>
        <button class="adm-btn" onClick={addEntry}>+ add</button>
      </div>
      <Show when={entries().length} fallback={<div class="adm-empty">No custom entries yet. Add one above, or approve candidates below.</div>}>
        <div class="adm-entries">
          <For each={byCat()}>{([cat, list]) => (
            <div class="adm-entry-cat">
              <div class="adm-entry-cattitle">{cat} <span class="adm-src">{list.length}</span></div>
              <For each={list}>{(e) => (
                <div class="adm-entry">
                  <span class="adm-entry-name">{e.name}</span>
                  <span class="adm-entry-url">{hostOf(e.url)}</span>
                  <a class="adm-btn" href={e.url} target="_blank" rel="noopener noreferrer">open ↗</a>
                  <button class="adm-btn danger" onClick={() => removeEntry(e.id)}>remove</button>
                </div>
              )}</For>
            </div>
          )}</For>
        </div>
      </Show>

      {/* —— candidate queue —— */}
      <div class="adm-section">Candidate queue — {status()}</div>
      <div class="adm-sources">
        <span class="adm-sources-label">Sources (untick to skip one, e.g. if compromised):</span>
        <For each={SOURCES}>{(s) => (
          <button class="adm-src-chip" classList={{ off: !srcOn(s.file) }} onClick={() => toggleSrc(s.file)} title={s.file}>
            {srcOn(s.file) ? "☑" : "☐"} {s.label}
          </button>
        )}</For>
        <input class="adm-search" placeholder="filter…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
        <button class="adm-btn" onClick={loadCands}>reload</button>
      </div>
      <div class="adm-list">
        <For each={shown()}>{(c) => (
          <div class="adm-row">
            <button class="adm-approve" onClick={() => approve(c)}>+ approve</button>
            <div class="adm-info">
              <div class="adm-name">{c.name} <span class="adm-src">{c.source}</span></div>
              <Show when={c.note}><div class="adm-note">{c.note}</div></Show>
              <div class="adm-url">{c.url}</div>
            </div>
            <div class="adm-validate">
              <a class="adm-btn" href={c.url} target="_blank" rel="noopener noreferrer">open ↗</a>
              <a class="adm-btn" href={`https://urlscan.io/domain/${hostOf(c.url)}`} target="_blank" rel="noopener noreferrer">urlscan</a>
              <a class="adm-btn" href={`https://www.virustotal.com/gui/domain/${hostOf(c.url)}`} target="_blank" rel="noopener noreferrer">virustotal</a>
            </div>
          </div>
        )}</For>
        <Show when={shown().length === 0}><div class="adm-empty">{status()}</div></Show>
      </div>
    </div>
    </Show>
  );
}

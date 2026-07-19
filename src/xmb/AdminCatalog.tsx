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
  const [openSrc, setOpenSrc] = createSignal<Set<string>>(new Set()); // which candidate groups are expanded (lazy-rendered)
  const toggleOpen = (s: string) => { const n = new Set(openSrc()); n.has(s) ? n.delete(s) : n.add(s); setOpenSrc(n); };

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
  const candGroups = (): [string, Cand[]][] => { const m = new Map<string, Cand[]>(); for (const c of cands()) { if (!m.has(c.source)) m.set(c.source, []); m.get(c.source)!.push(c); } return [...m].sort((a, b) => a[0].localeCompare(b[0])); };

  const CandRow = (p: { c: Cand }) => (
    <div class="adm-item">
      <button class="adm-btn tiny primary adm-approve" onClick={() => approve(p.c)}>+ approve</button>
      <div class="adm-item-main"><span class="adm-item-name">{p.c.name}</span><span class="adm-item-host">{hostOf(p.c.url)}</span></div>
      <Show when={p.c.note}><div class="adm-item-note">{p.c.note}</div></Show>
      <div class="adm-item-acts">
        <a class="adm-btn tiny" href={p.c.url} target="_blank" rel="noopener noreferrer">open ↗</a>
        <a class="adm-btn tiny" href={`https://urlscan.io/domain/${hostOf(p.c.url)}`} target="_blank" rel="noopener noreferrer">urlscan</a>
        <a class="adm-btn tiny" href={`https://www.virustotal.com/gui/domain/${hostOf(p.c.url)}`} target="_blank" rel="noopener noreferrer">virustotal</a>
      </div>
    </div>
  );

  return (
    <Show when={authed()} fallback={
      <div class="adm-login">
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
        <header class="adm-bar">
          <b class="adm-title">FREE &amp; OPEN · CMS</b>
          <div class="adm-actions">
            <Show when={pub()}><span class="adm-status">{pub()}</span></Show>
            <button class="adm-btn primary" classList={{ dirty: dirty() }} onClick={publish}>{dirty() ? "● Publish" : "Publish"}</button>
            <button class="adm-btn ghost" onClick={logout}>Lock</button>
          </div>
        </header>

        <main class="adm-main">
          <p class="adm-note-line">Your admin password authorizes publishing. Added/approved entries go live on the public site instantly. Candidate sources are the whitelisted tool files — edit <code>freecatalog.ts</code> to change them.</p>

          <section class="adm-sec">
            <h2 class="adm-h2">Published entries <span class="adm-count">{entries().length}</span></h2>
            <div class="adm-form">
              <input class="adm-search" placeholder="name" value={fName()} onInput={(e) => setFName(e.currentTarget.value)} />
              <input class="adm-search" placeholder="https://…" value={fUrl()} onInput={(e) => setFUrl(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") addEntry(); }} />
              <input class="adm-search" placeholder="short note" value={fNote()} onInput={(e) => setFNote(e.currentTarget.value)} />
              <select class="adm-search" value={fCat()} onChange={(e) => setFCat(e.currentTarget.value)}>
                <For each={CATEGORIES}>{(c) => <option value={c}>{c}</option>}</For>
                <option value="Added by owner">Added by owner</option>
              </select>
              <button class="adm-btn primary" onClick={addEntry}>+ add</button>
            </div>
            <Show when={entries().length} fallback={<div class="adm-empty">Nothing published yet — add one above, or approve a candidate below.</div>}>
              <For each={byCat()}>{([cat, list]) => (
                <details class="adm-group" open>
                  <summary class="adm-summary"><span class="adm-chev" /> {cat} <span class="adm-count">{list.length}</span></summary>
                  <div class="adm-group-body">
                    <For each={list}>{(e) => (
                      <div class="adm-item">
                        <div class="adm-item-main"><span class="adm-item-name">{e.name}</span><span class="adm-item-host">{hostOf(e.url)}</span></div>
                        <Show when={e.note}><div class="adm-item-note">{e.note}</div></Show>
                        <div class="adm-item-acts">
                          <a class="adm-btn tiny" href={e.url} target="_blank" rel="noopener noreferrer">open ↗</a>
                          <button class="adm-btn tiny danger" onClick={() => removeEntry(e.id)}>remove</button>
                        </div>
                      </div>
                    )}</For>
                  </div>
                </details>
              )}</For>
            </Show>
          </section>

          <section class="adm-sec">
            <h2 class="adm-h2">Candidate queue <span class="adm-count">{cands().length}</span></h2>
            <div class="adm-sub">{status()}</div>
            <div class="adm-sources">
              <For each={SOURCES}>{(s) => (
                <button class="adm-chip" classList={{ off: !srcOn(s.file) }} onClick={() => toggleSrc(s.file)} title={s.file}>{srcOn(s.file) ? "☑" : "☐"} {s.label}</button>
              )}</For>
            </div>
            <div class="adm-toolbar">
              <input class="adm-search" placeholder="filter candidates…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
              <button class="adm-btn ghost" onClick={loadCands}>reload</button>
            </div>
            <Show when={q().trim()} fallback={
              <For each={candGroups()}>{([src, list]) => (
                <div class="adm-group">
                  <button class="adm-summary" classList={{ open: openSrc().has(src) }} onClick={() => toggleOpen(src)}>
                    <span class="adm-chev" /> {src} <span class="adm-count">{list.length}</span>
                  </button>
                  <Show when={openSrc().has(src)}>
                    <div class="adm-group-body"><For each={list}>{(c) => <CandRow c={c} />}</For></div>
                  </Show>
                </div>
              )}</For>
            }>
              <div class="adm-group"><div class="adm-group-body">
                <For each={shown()}>{(c) => <CandRow c={c} />}</For>
                <Show when={shown().length === 0}><div class="adm-empty">no matches</div></Show>
              </div></div>
            </Show>
          </section>
        </main>
      </div>
    </Show>
  );
}

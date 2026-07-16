// Reader browser — PS3-style. Types a query or URL, our /api/browse Function
// fetches + sanitizes the page (scripts stripped), and it renders in a
// sandboxed iframe. Links stay inside the reader. Read-only, rate-limited.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

export default function Browser(props: { onClose: () => void }) {
  const [url, setUrl] = createSignal("");      // the /api/browse src the iframe shows
  const [addr, setAddr] = createSignal("");    // what's in the bar
  const [loading, setLoading] = createSignal(false);
  const [offline, setOffline] = createSignal(false);
  let bar!: HTMLInputElement;
  let frame!: HTMLIFrameElement;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { setNavEnabled(true); removeEventListener("keydown", esc); });
    // detect whether the Function is available (it isn't on a bare dev server)
    fetch("/api/browse?url=https://example.com", { method: "HEAD" })
      .then((r) => { if (r.status === 404) setOffline(true); })
      .catch(() => setOffline(true));
    setTimeout(() => bar?.focus(), 80);
  });

  function go(raw?: string) {
    const v = (raw ?? bar.value).trim();
    if (!v) return;
    const isUrl = /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v);
    const src = isUrl
      ? `/api/browse?url=${encodeURIComponent(v.startsWith("http") ? v : "https://" + v)}`
      : `/api/browse?q=${encodeURIComponent(v)}`;
    setLoading(true);
    setUrl(src);
    sfx.confirm();
  }

  // keep the address bar in sync as in-page links navigate the iframe
  function onFrameLoad() {
    setLoading(false);
    try {
      const loc = frame.contentWindow?.location.href ?? "";
      const m = loc.match(/[?&]url=([^&]+)/);
      const q = loc.match(/[?&]q=([^&]+)/);
      if (m) setAddr(decodeURIComponent(m[1]));
      else if (q) setAddr("🔍 " + decodeURIComponent(q[1]));
    } catch { /* cross-origin lock after a redirect — leave the bar as-is */ }
  }

  return (
    <div class="browser">
      <div class="browser-bar">
        <div class="panel-tag">BROWSER — READER MODE</div>
        <input
          ref={bar}
          class="browser-addr"
          placeholder="search the web, or type a URL…"
          value={addr()}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") go();
            if (e.key === "Escape") { sfx.back(); props.onClose(); }
          }}
        />
        <button class="ghost-btn" onClick={() => go()}>go</button>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>

      <Show
        when={!offline()}
        fallback={
          <div class="browser-gate">
            <div class="ai-gate-big">The reader browser needs the deployed console.</div>
            <p>It runs on a Cloudflare Function that isn't part of the local dev server. Open the live site to use it.</p>
          </div>
        }
      >
        <Show
          when={url()}
          fallback={
            <div class="browser-start">
              <div class="browser-start-big">🌐 Reader Browser</div>
              <p>Type a search or a web address above. Pages open in a clean, reader-friendly view — text and images, no scripts or ads. Read-only.</p>
              <div class="browser-quick">
                {["wikipedia.org", "news.ycombinator.com", "bbc.com/news", "en.wikipedia.org/wiki/PlayStation_3"].map((s) => (
                  <button class="ghost-btn" onClick={() => go(s)}>{s}</button>
                ))}
              </div>
            </div>
          }
        >
          <Show when={loading()}><div class="browser-loading">loading…</div></Show>
          <iframe
            ref={frame}
            class="browser-frame"
            src={url()}
            sandbox="allow-same-origin"
            referrerpolicy="no-referrer"
            title="Reader"
            onLoad={onFrameLoad}
          />
        </Show>
      </Show>
      <div class="panel-hint guide-hint">ENTER — go · links open in the reader · <span class="btn-o" /> close</div>
    </div>
  );
}

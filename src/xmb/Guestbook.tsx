// Guestbook — visitors sign the console. Talks to /api/guestbook (a Cloudflare
// Pages Function + KV); on a local dev build without functions it degrades to
// a friendly notice. Messages render as plain text — Solid escapes by default.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

type Entry = { n: string; m: string; t: number };

export default function Guestbook(props: { userName: string; onClose: () => void }) {
  const [entries, setEntries] = createSignal<Entry[] | null>(null);
  const [offline, setOffline] = createSignal(false);
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let nameInput!: HTMLInputElement;
  let msgInput!: HTMLTextAreaElement;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { setNavEnabled(true); removeEventListener("keydown", esc); });
    fetch("/api/guestbook")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => { setOffline(true); setEntries([]); });
  });

  async function sign() {
    const name = nameInput.value.trim();
    const msg = msgInput.value.trim();
    if (!name || msg.length < 2 || busy()) return;
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, msg }),
      });
      const d = await r.json();
      if (!r.ok) { setNote(d.error ?? "The console declined that."); sfx.deny(); }
      else {
        setEntries((e) => [d.entry, ...(e ?? [])]);
        msgInput.value = "";
        setNote("Signed. Thanks for visiting.");
        sfx.confirm();
      }
    } catch {
      setNote("Couldn't reach the guestbook — try the deployed console.");
      sfx.deny();
    }
    setBusy(false);
  }

  return (
    <div class="gbook">
      <div class="gbook-head">
        <div class="panel-tag">GUESTBOOK — SIGN THE CONSOLE</div>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>

      <div class="gbook-form">
        <input
          ref={nameInput}
          class="ai-input gbook-name"
          maxLength={24}
          placeholder="your name"
          value={props.userName === "PLAYER 1" ? "" : props.userName}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { sfx.back(); props.onClose(); } }}
        />
        <textarea
          ref={msgInput}
          class="ai-input gbook-msg"
          maxLength={240}
          rows={2}
          placeholder="leave a note — it stays on the console"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sign(); }
            if (e.key === "Escape") { sfx.back(); props.onClose(); }
          }}
        />
        <button class="ps2-launch gbook-sign" disabled={busy()} onClick={sign}>✒ SIGN</button>
      </div>
      <Show when={note()}><div class="gbook-note">{note()}</div></Show>

      <div class="gbook-list">
        <Show when={entries()} fallback={<div class="guide-loading">Opening the book…</div>}>
          <Show when={!offline()} fallback={
            <div class="gbook-empty">The guestbook lives on the deployed console — visit the live site to sign it.</div>
          }>
            <Show when={entries()!.length} fallback={<div class="gbook-empty">First page is blank — be the first to sign.</div>}>
              <For each={entries()!}>
                {(e) => (
                  <div class="gbook-row">
                    <div class="gbook-who">
                      <span class="gbook-n">{e.n}</span>
                      <span class="gbook-t">{new Date(e.t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                    </div>
                    <div class="gbook-m">{e.m}</div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
      <div class="panel-hint guide-hint">ENTER — sign · <span class="btn-o" /> close</div>
    </div>
  );
}

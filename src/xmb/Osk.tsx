// PlayStation on-screen keyboard. Appears ONLY when a controller button
// (✕ or d-pad) is pressed while a text field has focus — never for keyboard,
// mouse or touch users — and drives typing entirely from the pad:
//   d-pad / left stick — move · ✕ type · □ delete · △ space · ◯ done
//   L1 shift · R1 symbols · Start = Enter (submit)
// While open it claims the pad (setOskBlock) so XMB nav stays quiet, and it
// bows out the moment real keyboard typing is detected.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { primaryPad, setOskBlock } from "../input";
import * as sfx from "../audio";

type Field = HTMLInputElement | HTMLTextAreaElement;

const ROWS_ABC = ["1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm@._"];
const ROWS_SYM = ["1234567890", "!@#$%^&*()", "-_=+;:'\"()", "?/\\~<>[]{}"];
// bottom row of wide action keys (also mouse-clickable)
const ACTIONS = [
  { id: "shift", label: "⇧ shift" },
  { id: "sym", label: "&123" },
  { id: "space", label: "space" },
  { id: "bksp", label: "⌫ delete" },
  { id: "enter", label: "⏎ enter" },
] as const;

const eligible = (el: unknown): el is Field => {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return ["text", "search", "url", "email", "password", "tel", ""].includes(el.type ?? "");
};

export default function Osk() {
  const [target, setTarget] = createSignal<Field | null>(null);
  const [row, setRow] = createSignal(0);
  const [col, setCol] = createSignal(0);
  const [shift, setShift] = createSignal(false);
  const [sym, setSym] = createSignal(false);
  const [value, setValue] = createSignal(""); // mirrored for the preview line

  const rows = () => (sym() ? ROWS_SYM : ROWS_ABC);
  const keyAt = (r: number, c: number) => rows()[r]?.[Math.min(c, rows()[r].length - 1)];

  // keep the preview honest even if the value changes outside the OSK (paste,
  // real typing before the auto-dismiss lands)
  const syncValue = () => { const el = target(); if (el) setValue(el.value); };
  function open(el: Field) {
    setTarget(el);
    setValue(el.value);
    el.addEventListener("input", syncValue);
    setOskBlock(true);
    sfx.tickH();
  }
  // blurField: pad-driven exits hand focus BACK to the app — otherwise the
  // field keeps focus and the "typing field owns the pad" guard leaves the
  // controller unable to navigate the results the user just searched for.
  function close(blurField = false) {
    const el = target();
    if (!el) return;
    el.removeEventListener("input", syncValue);
    setTarget(null);
    setOskBlock(false);
    if (blurField) el.blur();
    sfx.back();
  }

  // write through the native setter so Solid's onInput signals fire
  function write(fn: (cur: string, s: number, e: number) => [string, number]) {
    const el = target();
    if (!el) return;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    let s = el.value.length, e = el.value.length;
    try { s = el.selectionStart ?? s; e = el.selectionEnd ?? e; } catch { /* non-selectable input type */ }
    const [next, caret] = fn(el.value, s, e);
    if (el instanceof HTMLInputElement && el.maxLength > 0 && next.length > el.maxLength) return;
    setter.call(el, next);
    try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    setValue(el.value);
  }
  const typeChar = (ch: string) => {
    write((cur, s, e) => [cur.slice(0, s) + ch + cur.slice(e), s + ch.length]);
    if (shift()) setShift(false); // PS-style one-shot shift
    sfx.tickH();
  };
  const backspace = () => {
    write((cur, s, e) => (s === e && s > 0 ? [cur.slice(0, s - 1) + cur.slice(e), s - 1] : [cur.slice(0, s) + cur.slice(e), s]));
    sfx.tickH();
  };
  const submit = () => {
    const el = target();
    if (!el) return;
    sfx.confirm();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    close(true); // release focus so the pad can walk the results
  };

  function act(id: (typeof ACTIONS)[number]["id"]) {
    if (id === "shift") { setShift(!shift()); sfx.tickH(); }
    else if (id === "sym") { setSym(!sym()); sfx.tickH(); }
    else if (id === "space") typeChar(" ");
    else if (id === "bksp") backspace();
    else if (id === "enter") submit();
  }
  const pressFocused = () => {
    if (row() < rows().length) {
      const ch = keyAt(row(), col());
      if (ch) typeChar(shift() ? ch.toUpperCase() : ch);
    } else {
      act(ACTIONS[Math.min(col(), ACTIONS.length - 1)].id);
    }
  };

  onMount(() => {
    // —— follow focus while open; dismiss when the field is left ————————————
    const onFocusIn = (e: FocusEvent) => {
      // never SUMMON on focus — that's the pad's job. Only retarget if already open.
      if (target() && e.target !== target() && eligible(e.target)) {
        target()!.removeEventListener("input", syncValue);
        setTarget(e.target as Field);
        setValue((e.target as Field).value);
        (e.target as Field).addEventListener("input", syncValue);
      }
    };
    const onFocusOut = () => {
      // let the new focus settle; keep the OSK if focus stayed on the field
      setTimeout(() => { if (target() && document.activeElement !== target()) close(); }, 0);
    };
    // real keyboard typing while open = the user switched device — bow out.
    // Escape is special: it must close ONLY the keyboard, so it's swallowed in
    // the capture phase before any app's own Escape handler can also fire.
    const onRealKey = (e: KeyboardEvent) => {
      if (!target() || !e.isTrusted) return;
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(true); return; }
      if (e.key.length === 1 || ["Backspace", "Delete", "Enter"].includes(e.key)) close();
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onRealKey, true);

    // —— pad loop: edge-detected buttons + repeating directions ————————————
    const prev: Record<number, boolean> = {};
    const heldDir: Record<string, { t0: number; last: number }> = {};
    let raf = 0;
    const DELAY = 330, RATE = 80;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const p = primaryPad();
      if (!p) return;
      const b = (i: number) => !!p.buttons[i]?.pressed;
      const edge = (i: number) => { const on = b(i); const hit = on && !prev[i]; prev[i] = on; return hit; };

      if (!target()) {
        // hidden: ✕ or a d-pad press while a text field is focused summons it.
        // ◯ stays free to cancel modals; sticks are ignored (drift ≠ intent).
        const summon = [0, 12, 13, 14, 15].some((i) => edge(i));
        [1, 2, 3].forEach(edge); // keep edge state fresh for the other buttons
        if (summon && eligible(document.activeElement)) open(document.activeElement as Field);
        return;
      }

      // directions (d-pad or left stick) with XMB-style repeat
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      const dirs: Record<string, boolean> = {
        left: b(14) || ax < -0.5, right: b(15) || ax > 0.5,
        up: b(12) || ay < -0.5, down: b(13) || ay > 0.5,
      };
      for (const [d, on] of Object.entries(dirs)) {
        const fire = () => move(d as "left" | "right" | "up" | "down");
        if (on && !heldDir[d]) { heldDir[d] = { t0: now, last: now }; fire(); }
        else if (on && now - heldDir[d].t0 > DELAY && now - heldDir[d].last > RATE) { heldDir[d].last = now; fire(); }
        else if (!on) delete heldDir[d];
      }

      if (edge(0)) pressFocused();     // ✕ type
      if (edge(1)) close(true);        // ◯ done — hand focus back to the app
      if (edge(2)) backspace();        // □ delete
      if (edge(3)) typeChar(" ");      // △ space
      if (edge(4)) { setShift(!shift()); sfx.tickH(); } // L1
      if (edge(5)) { setSym(!sym()); sfx.tickH(); }     // R1
      if (edge(9)) submit();           // Start → Enter
    };
    raf = requestAnimationFrame(loop);

    onCleanup(() => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onRealKey, true);
      cancelAnimationFrame(raf);
      setOskBlock(false);
    });
  });

  function move(d: "left" | "right" | "up" | "down") {
    const maxRow = rows().length; // rows + action row
    if (d === "up") setRow(Math.max(0, row() - 1));
    if (d === "down") setRow(Math.min(maxRow, row() + 1));
    if (d === "left" || d === "right") {
      const width = row() < maxRow ? rows()[row()].length : ACTIONS.length;
      setCol((col() + (d === "left" ? -1 : 1) + width) % width);
    }
    // clamp col when changing row height
    const width = row() < maxRow ? rows()[row()].length : ACTIONS.length;
    if (col() >= width) setCol(width - 1);
    sfx.tickH();
  }

  return (
    <Show when={target()}>
      {/* mousedown is swallowed so clicks never steal focus from the field */}
      <div class="osk" onMouseDown={(e) => e.preventDefault()}>
        <div class="osk-preview">{value().length > 64 ? "…" + value().slice(-63) : value() || <span class="osk-ph">…</span>}<span class="osk-caret" /></div>
        <div class="osk-grid">
          <For each={rows()}>
            {(r, ri) => (
              <div class="osk-row">
                <For each={r.split("")}>
                  {(ch, ci) => (
                    <button
                      class="osk-key"
                      classList={{ focus: row() === ri() && Math.min(col(), r.length - 1) === ci() }}
                      onClick={() => { setRow(ri()); setCol(ci()); typeChar(shift() ? ch.toUpperCase() : ch); }}
                    >{shift() ? ch.toUpperCase() : ch}</button>
                  )}
                </For>
              </div>
            )}
          </For>
          <div class="osk-row">
            <For each={[...ACTIONS]}>
              {(a, i) => (
                <button
                  class="osk-key wide"
                  classList={{ focus: row() === rows().length && Math.min(col(), ACTIONS.length - 1) === i(), on: (a.id === "shift" && shift()) || (a.id === "sym" && sym()) }}
                  onClick={() => { setRow(rows().length); setCol(i()); act(a.id); }}
                >{a.id === "sym" && sym() ? "abc" : a.label}</button>
              )}
            </For>
          </div>
        </div>
        <div class="osk-legend">
          <span><span class="btn-x" /> type</span>
          <span><span class="btn-s" /> delete</span>
          <span><span class="btn-t" /> space</span>
          <span><span class="btn-o" /> done</span>
          <span>L1 shift · R1 symbols · start ⏎</span>
        </div>
      </div>
    </Show>
  );
}

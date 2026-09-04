// "Systems" on a shelf: what this shelf plays, how each system runs on THIS
// device, and the BIOS pocket for the systems that need firmware.
//
// One sheet per shelf rather than a settings page somewhere else, because the
// moment you learn a Sega CD game needs a BIOS is the moment you are adding one.
// Same sheet language as the PS2 emulator picker: head, scrolling body, Close.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { addBios, listBios, removeBios, type BiosRecord } from "../bios";
import { rateSpec, type Suitability } from "../labs";
import { SYSTEMS, biosStatus, type SystemDef } from "../systems";

// every system gets a verdict — a light 8-bit core simply rates "runs here"
const fitOf = (d: SystemDef): Suitability => {
  const f = d.fit ?? {};
  return rateSpec({ cpuHeavy: f.cpuHeavy, desktop: f.desktop, isolation: f.threads, minMemGB: f.minMemGB });
};
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function SystemsSheet(props: { systems: readonly string[] }) {
  const defs = () => props.systems.map((id) => SYSTEMS[id]).filter((d): d is SystemDef => !!d);
  // a single-system shelf with nothing to configure has nothing to say
  const relevant = () => defs().length > 1 || defs().some((d) => d.bios || d.fit?.note);
  const [open, setOpen] = createSignal(false);
  const [files, setFiles] = createSignal<BiosRecord[]>([]);
  const [note, setNote] = createSignal("");
  const refresh = async () => { try { setFiles(await listBios()); } catch (e) { console.warn("[bios] list failed", e); } };
  onMount(refresh);

  const filesFor = (id: string) => files().filter((f) => f.system === id);
  const status = (d: SystemDef) => biosStatus(d, filesFor(d.id).map((f) => f.name));
  const needing = () => defs().filter((d) => d.bios?.required && !status(d).ok).length;

  let pill!: HTMLButtonElement;
  let sheet!: HTMLElement;
  let body!: HTMLDivElement;
  let input!: HTMLInputElement;
  const [target, setTarget] = createSignal<string | null>(null);

  const close = () => { sfx.back(); setOpen(false); queueMicrotask(() => pill.focus({ preventScroll: true })); };
  const show = () => {
    sfx.tickH(); setOpen(true); void refresh();
    queueMicrotask(() => { body.scrollTop = 0; sheet.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }); });
  };
  const pick = (id: string) => { setTarget(id); input.value = ""; input.click(); };
  const onFiles = async (list: FileList | null) => {
    const sys = target();
    if (!sys || !list?.length) return;
    const d = SYSTEMS[sys];
    const expected = new Set((d?.bios?.files ?? []).map((f) => f.toLowerCase()));
    let added = 0, odd = 0;
    for (const f of Array.from(list)) {
      try { await addBios(sys, f); added++; if (expected.size && !expected.has(f.name.toLowerCase())) odd++; }
      catch (e) { console.warn("[bios] add failed", e); }
    }
    await refresh();
    sfx.confirm();
    setNote(added ? `${added} file${added === 1 ? "" : "s"} added${odd ? ` · ${odd} not a name this system usually expects` : ""}` : "Nothing added");
  };
  const remove = async (f: BiosRecord) => { await removeBios(f.key); await refresh(); sfx.back(); setNote(`Removed ${f.name}`); };

  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      if (!open()) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...sheet.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const i = rows.indexOf(document.activeElement as HTMLButtonElement);
        rows[(i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus({ preventScroll: true });
      }
      if (e.key !== "Tab") e.stopPropagation();
    };
    addEventListener("keydown", keys, true);
    onCleanup(() => removeEventListener("keydown", keys, true));
  });

  return (
    <Show when={relevant()}>
      <button class="hz-btn" ref={pill} aria-haspopup="dialog" aria-expanded={open()} onClick={show}>
        Systems · {defs().length}{needing() ? ` · ${needing()} need${needing() === 1 ? "s" : ""} a BIOS` : ""}
      </button>
      <input type="file" ref={input} hidden multiple onChange={(e) => void onFiles(e.currentTarget.files)} />

      <Show when={open()}><div class="hz-sheet-scrim" onClick={close} /></Show>
      <aside class="hz-sheet" ref={sheet} hidden={!open()} role="dialog" aria-label="Systems on this shelf">
        <div class="hz-sheet-head">
          <div>
            <div class="t">Systems on this shelf</div>
            <div class="s">{note() || "What each one needs, and how it runs on this device"}</div>
          </div>
        </div>
        <div class="hz-sheet-body" ref={body}>
          <For each={defs()}>{(d) => {
            const st = () => status(d);
            const fit = fitOf(d);
            return (
              <div class="hz-sys">
                <div class="hz-sys-head">
                  <span class="t">{d.name}</span>
                  <Show when={fit}>
                    <span class={`hz-fit ${fit!.level}`} title={fit!.notes.join(" · ")}>
                      {fit!.level === "ready" ? "runs here" : fit!.level === "caution" ? "may struggle here" : "not on this device"}
                    </span>
                  </Show>
                </div>
                <Show when={d.fit?.note || (fit && fit.notes[0])}>
                  <div class="s">{d.fit?.note ?? fit!.notes[0]}</div>
                </Show>
                <Show when={d.bios}>
                  <div class="hz-bios">
                    <span class={`hz-fit ${st().ok ? (st().have.length ? "ready" : "none") : "no"}`}>
                      {st().ok ? (st().have.length ? "BIOS ready" : d.bios!.required ? "BIOS ready" : "BIOS optional") : "BIOS missing"}
                    </span>
                    <span class="s">{d.bios!.note}{st().missing.length && (d.bios!.required || !st().have.length) ? ` — ${d.bios!.anyOf ? "one of" : "expects"}: ${st().missing.join(", ")}` : ""}</span>
                    <button class="hz-mini" onClick={() => pick(d.id)}>{filesFor(d.id).length ? "Add another file" : "Add BIOS file…"}</button>
                    <For each={filesFor(d.id)}>{(f) => (
                      <span class="hz-bios-file"><code>{f.name}</code><span class="s">{mb(f.size)}</span><button class="hz-mini warn" onClick={() => void remove(f)} aria-label={`Remove ${f.name}`}>remove</button></span>
                    )}</For>
                  </div>
                </Show>
              </div>
            );
          }}</For>
        </div>
        <button class="hz-srow hz-sheet-close" onClick={close}>
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </Show>
  );
}

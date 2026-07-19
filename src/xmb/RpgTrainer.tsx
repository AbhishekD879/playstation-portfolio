// RPG Maker MV/MZ trainer — a live cheat panel (GameShark/Lucky-Patcher in
// spirit). RPG Maker games are JavaScript and their whole state lives in named
// globals ($gameParty, $gameActors, $gameVariables, $data*), and our player runs
// the game in a SAME-ORIGIN iframe — so we don't scan bytes, we just read and
// write those objects. Tier 1: known-field edits (gold, HP/MP, level, items,
// variables) — works on any MV/MZ game with no searching. Edits are live; the
// player saves in-game to persist. Single-player only; it's the user's game.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";

type CatEntry = { id: number; name: string; kind: "item" | "weapon" | "armor"; data: unknown };

export default function RpgTrainer(props: {
  frame: () => HTMLIFrameElement | undefined;
  open: boolean;
  onClose: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = () => (props.frame()?.contentWindow as any) ?? null;
  const gp = () => win()?.$gameParty ?? null;

  const [tick, setTick] = createSignal(0);          // 1s pulse → re-read live values
  const [cat, setCat] = createSignal<CatEntry[]>([]); // item catalog, built once
  const [msg, setMsg] = createSignal("");
  const [goldInput, setGoldInput] = createSignal("");
  const [lvlInput, setLvlInput] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [amount, setAmount] = createSignal(99);
  const [varId, setVarId] = createSignal("");
  const [varVal, setVarVal] = createSignal("");

  let poll: ReturnType<typeof setInterval>;
  onMount(() => { poll = setInterval(() => { if (props.open) setTick((t) => t + 1); }, 1000); });
  onCleanup(() => clearInterval(poll));

  const ready = () => { tick(); return !!(gp() && typeof gp().gold === "function"); };
  const flash = (m: string) => { setMsg(m); try { sfx.tickV(); } catch { /* no audio */ } setTimeout(() => setMsg(""), 2400); };
  const bump = () => setTick((t) => t + 1);

  const currency = () => { tick(); return win()?.$dataSystem?.currencyUnit ?? "G"; };
  const gold = () => { tick(); const p = gp(); return p && p.gold ? p.gold() : 0; };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (): any[] => { const p = gp(); if (!p) return []; return (p.allMembers ? p.allMembers() : p.members?.()) || []; };

  const setGold = (v: number) => { const p = gp(); if (!p) return; p.gainGold(Math.floor(v) - p.gold()); flash(`Gold → ${p.gold().toLocaleString()}`); bump(); };
  const addGold = (d: number) => { const p = gp(); if (!p) return; p.gainGold(d); flash(`Gold → ${p.gold().toLocaleString()}`); bump(); };
  const fullHeal = () => { members().forEach((a) => a.recoverAll?.()); flash("Party fully healed"); bump(); };
  const setLevel = (n: number) => {
    members().forEach((a) => { try { a.changeLevel(Math.max(1, Math.min(n, a.maxLevel?.() ?? 99)), false); } catch { /* actor rejected it */ } });
    flash(`Party → level ${n}`); bump();
  };

  const buildCatalog = (): CatEntry[] => {
    const w = win(); if (!w) return [];
    const out: CatEntry[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const push = (arr: any[], kind: CatEntry["kind"]) => { if (!Array.isArray(arr)) return; for (let i = 1; i < arr.length; i++) { const d = arr[i]; if (d && d.name) out.push({ id: i, name: d.name, kind, data: d }); } };
    push(w.$dataItems, "item"); push(w.$dataWeapons, "weapon"); push(w.$dataArmors, "armor");
    return out;
  };
  // build the catalog once the game data is loaded (retried on the poll until ready)
  createEffect(() => { tick(); if (props.open && cat().length === 0) { const c = buildCatalog(); if (c.length) setCat(c); } });
  const filtered = () => { const f = filter().toLowerCase().trim(); const c = cat(); return (f ? c.filter((x) => x.name.toLowerCase().includes(f)) : c).slice(0, 80); };
  const give = (x: CatEntry) => { const p = gp(); if (!p) return; p.gainItem(x.data, amount(), false); flash(`+${amount()} ${x.name}`); };

  const setVariable = () => {
    const w = win(); const id = parseInt(varId(), 10); const v = Number(varVal());
    if (!w || !id || Number.isNaN(v)) { flash("Enter a variable # and a value"); return; }
    w.$gameVariables.setValue(id, v); flash(`Variable ${id} = ${v}`);
  };

  return (
    <Show when={props.open}>
      <div class="rpg-diag rpg-trainer">
        <div class="rpg-diag-head">
          <span>✨ TRAINER · {ready() ? "live" : "waiting for a save…"}</span>
          <span class="rpg-diag-btns">
            <button class="ps-act" onClick={() => { setCat([]); bump(); }}>refresh</button>
            <button class="ps-act" onClick={props.onClose}>close</button>
          </span>
        </div>

        <Show when={!ready()} fallback={
          <>
            <div class="rpg-diag-tip">Changes apply live — <b>save in-game</b> to keep them. It's your single-player game; go wild.</div>
            <Show when={msg()}><div class="rpg-tr-msg">{msg()}</div></Show>

            <div class="rpg-diag-sec">Gold — {gold().toLocaleString()} {currency()}</div>
            <div class="rpg-tr-row">
              <input class="rpg-tr-num" type="number" inputmode="numeric" placeholder="set to…" value={goldInput()} onInput={(e) => setGoldInput(e.currentTarget.value)} />
              <button class="ps-act" onClick={() => { const v = Number(goldInput()); if (!Number.isNaN(v) && goldInput() !== "") setGold(v); }}>set</button>
              <button class="ps-act" onClick={() => addGold(10000)}>+10k</button>
              <button class="ps-act" onClick={() => addGold(100000)}>+100k</button>
              <button class="ps-act" onClick={() => setGold(99999999)}>max</button>
            </div>

            <div class="rpg-diag-sec">Party</div>
            <div class="rpg-tr-row">
              <button class="ps-act" onClick={fullHeal}>full heal</button>
              <input class="rpg-tr-num" type="number" inputmode="numeric" placeholder="level" value={lvlInput()} onInput={(e) => setLvlInput(e.currentTarget.value)} />
              <button class="ps-act" onClick={() => { const n = parseInt(lvlInput(), 10); if (n) setLevel(n); }}>set level</button>
              <button class="ps-act" onClick={() => setLevel(99)}>lv 99</button>
            </div>

            <div class="rpg-diag-sec">Items — tap to add ×<input class="rpg-tr-num rpg-tr-amt" type="number" inputmode="numeric" value={amount()} onInput={(e) => setAmount(Math.max(1, parseInt(e.currentTarget.value, 10) || 1))} /></div>
            <div class="rpg-tr-row"><input class="rpg-tr-txt" placeholder="filter by name…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} /></div>
            <div class="rpg-tr-items">
              <For each={filtered()}>{(x) => (
                <button class="rpg-tr-item" onClick={() => give(x)} title={`add ${amount()}× ${x.name}`}>
                  <span class={`rpg-tr-kind k-${x.kind}`}>{x.kind[0].toUpperCase()}</span> {x.name}
                </button>
              )}</For>
              <Show when={filtered().length === 0}><div class="rpg-diag-row dim">no matching items</div></Show>
            </div>

            <div class="rpg-diag-sec">Advanced — set a variable by # (custom currencies/stats often live here)</div>
            <div class="rpg-tr-row">
              <input class="rpg-tr-num" type="number" inputmode="numeric" placeholder="var #" value={varId()} onInput={(e) => setVarId(e.currentTarget.value)} />
              <input class="rpg-tr-num" type="number" inputmode="numeric" placeholder="value" value={varVal()} onInput={(e) => setVarVal(e.currentTarget.value)} />
              <button class="ps-act" onClick={setVariable}>set</button>
            </div>
          </>
        }>
          <div class="rpg-diag-row dim">Start the game and load (or begin) a save first — then gold, party and items show up here.</div>
        </Show>
      </div>
    </Show>
  );
}

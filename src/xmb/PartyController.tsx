// The phone side of the Party Games pack. Opened via ?party=CODE (scan the QR
// on the host's screen). It is a GENERIC terminal: it renders whatever "screen"
// the host sends and reports interactions back — so every game reuses it and no
// game needs its own controller code. Nothing else of the console loads here.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { partyJoin, type PartyJoinHandle } from "../party/net";

type Screen =
  | { kind: "wait"; title: string; msg?: string }
  | { kind: "buttons"; title: string; sub?: string; options: string[]; colors?: string[] }
  | { kind: "text"; title: string; sub?: string; placeholder?: string; max?: number; repeat?: boolean }
  | { kind: "draw"; title: string; word: string }
  | { kind: "guess"; title: string; placeholder?: string; max?: number }
  | { kind: "hintguess"; title: string; placeholder?: string; max?: number }
  | { kind: "describe"; title: string; name: string; photo?: string; credit?: string; sub?: string; placeholder?: string; max?: number };

const tick = () => { try { navigator.vibrate?.(8); } catch { /* no haptics */ } };

// Incremental ink renderer shared by the drawer (local strokes) and guessers
// (relayed strokes). Coords are normalized 0..1; a null point lifts the pen.
function inkRenderer(el: HTMLCanvasElement) {
  const ctx = el.getContext("2d");
  if (ctx) { ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#eaf2ff"; }
  let last: [number, number] | null = null;
  return {
    seg(m: { p?: [number, number] | null; d?: boolean; clear?: boolean }) {
      if (!ctx) return;
      if (m.clear) { ctx.clearRect(0, 0, el.width, el.height); last = null; return; }
      if (m.d && Array.isArray(m.p)) {
        const x = m.p[0] * el.width, y = m.p[1] * el.height;
        if (last) { ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(x, y); ctx.stroke(); }
        last = [x, y];
      } else last = null;
    },
    clear() { if (ctx) ctx.clearRect(0, 0, el.width, el.height); last = null; },
  };
}

export default function PartyController(props: { room: string }) {
  const [status, setStatus] = createSignal("connecting…");
  const [joined, setJoined] = createSignal(false);
  const [name, setName] = createSignal("");
  const [me, setMe] = createSignal<{ name: string; color: string } | null>(null);
  const [screen, setScreen] = createSignal<Screen | null>(null);
  const [locked, setLocked] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal(false);
  let conn: PartyJoinHandle | null = null;
  // a guesser's spectator canvas registers here so relayed ink can reach it
  let onInk: ((m: any) => void) | null = null;
  // the Celebrity guesser's hint list registers here so relayed hints reach it
  let onHint: ((m: any) => void) | null = null;
  // stable identity so a reconnecting phone reclaims its seat + score (not a new player)
  const cid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const sendJoin = () => conn?.send({ t: "join", name: name(), cid });

  onMount(() => {
    conn = partyJoin(props.room, {
      onOpen: () => {
        setStatus("connected"); setReconnecting(false);
        if (joined()) sendJoin(); // reconnected → re-announce so the host relinks us
      },
      onClose: () => { setStatus("connection lost"); setReconnecting(false); },
      onStatus: (s) => { setStatus(s); if (s.startsWith("reconnecting")) setReconnecting(true); },
      onMessage: (m: any) => {
        if (m.t === "me") { setMe({ name: m.name, color: m.color }); return; }
        if (m.t === "ink") { onInk?.(m); return; }
        if (m.t === "hint") { onHint?.(m); return; }
        if (m.t === "screen") { setScreen(m.s as Screen); setLocked(false); }
      },
    }, { reconnect: true });
    onCleanup(() => conn?.stop());
  });

  const doJoin = () => {
    const n = name().trim().slice(0, 14) || "Player";
    setName(n);
    setJoined(true);
    sendJoin();
    setScreen({ kind: "wait", title: "You're in!", msg: "Watch the big screen — the game starts there." });
  };

  const sendInput = (v: unknown, lock = true) => { tick(); conn?.send({ t: "in", v }); if (lock) setLocked(true); };
  const draw = (msg: unknown) => conn?.send({ t: "draw", ...(msg as object) });
  const registerInk = (fn: ((m: any) => void) | null) => { onInk = fn; };
  const registerHint = (fn: ((m: any) => void) | null) => { onHint = fn; };

  return (
    <div class="pc-root">
      <div class="pc-bar">
        <span class="pc-code">ROOM {props.room}</span>
        <Show when={me()} fallback={<span class="pc-status">{status()}</span>}>
          <span class="pc-me"><i style={{ background: me()!.color }} />{me()!.name}</span>
        </Show>
      </div>
      <Show when={reconnecting()}><div class="pc-reconnect">Reconnecting…</div></Show>

      <Show when={!joined()}>
        <div class="pc-screen pc-join">
          <div class="pc-logo">PARTY</div>
          <p class="pc-lead">You're the controller. Pick a name and watch the big screen.</p>
          <input class="pc-name" placeholder="Your name" maxlength={14} value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") doJoin(); }} />
          <button class="pc-go" disabled={status() !== "connected"} onClick={doJoin}>
            {status() === "connected" ? "Join the game" : status()}
          </button>
        </div>
      </Show>

      <Show when={joined() && screen()} fallback={joined() ? <WaitScreen s={{ kind: "wait", title: "Ready", msg: "Waiting for the host…" }} /> : null}>
        {(() => {
          const s = screen()!;
          if (s.kind === "wait") return <WaitScreen s={s} />;
          if (s.kind === "buttons") return <ButtonsScreen s={s} locked={locked()} onPick={(i) => sendInput(i)} />;
          if (s.kind === "text") return <TextScreen s={s} locked={locked()} onSend={(t) => sendInput(t, !s.repeat)} />;
          if (s.kind === "guess") return <GuessScreen s={s} onGuess={(t) => sendInput(t, false)} registerInk={registerInk} />;
          if (s.kind === "hintguess") return <HintGuessScreen s={s} onGuess={(t) => sendInput(t, false)} registerHint={registerHint} />;
          if (s.kind === "describe") return <DescribeScreen s={s} onHint={(t) => sendInput(t, false)} />;
          return <DrawScreen s={s} draw={draw} />;
        })()}
      </Show>
    </div>
  );
}

function WaitScreen(props: { s: Extract<Screen, { kind: "wait" }> }) {
  return <div class="pc-screen pc-wait"><div class="pc-wait-title">{props.s.title}</div><Show when={props.s.msg}><p>{props.s.msg}</p></Show><div class="pc-dots"><i /><i /><i /></div></div>;
}

function ButtonsScreen(props: { s: Extract<Screen, { kind: "buttons" }>; locked: boolean; onPick: (i: number) => void }) {
  return (
    <div class="pc-screen">
      <div class="pc-q">{props.s.title}</div>
      <Show when={props.s.sub}><div class="pc-sub">{props.s.sub}</div></Show>
      <Show when={!props.locked} fallback={<div class="pc-locked">Locked in ✓</div>}>
        <div class="pc-opts">
          <For each={props.s.options}>
            {(opt, i) => <button class="pc-opt" style={props.s.colors ? { "--oc": props.s.colors![i()] } : undefined} onClick={() => props.onPick(i())}>{opt}</button>}
          </For>
        </div>
      </Show>
    </div>
  );
}

function TextScreen(props: { s: Extract<Screen, { kind: "text" }>; locked: boolean; onSend: (t: string) => void }) {
  const [sent, setSent] = createSignal<string[]>([]);
  let ta!: HTMLTextAreaElement;
  const go = () => {
    const t = ta.value.trim();
    if (!t) return;
    props.onSend(t);
    if (props.s.repeat) { setSent((x) => [t, ...x].slice(0, 5)); ta.value = ""; ta.focus(); }
  };
  return (
    <div class="pc-screen">
      <div class="pc-q">{props.s.title}</div>
      <Show when={props.s.sub}><div class="pc-sub">{props.s.sub}</div></Show>
      <Show when={!props.locked} fallback={<div class="pc-locked">Locked in ✓</div>}>
        <textarea ref={ta} class="pc-text" placeholder={props.s.placeholder ?? "Type here…"} maxlength={props.s.max ?? 60}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }} />
        <button class="pc-go" onClick={go}>Send</button>
        <Show when={props.s.repeat && sent().length}>
          <div class="pc-sentlog"><For each={sent()}>{(g) => <span>{g}</span>}</For></div>
        </Show>
      </Show>
    </div>
  );
}

// Guesser: watches the drawing (relayed strokes) AND types guesses — repeatedly.
function GuessScreen(props: { s: Extract<Screen, { kind: "guess" }>; onGuess: (t: string) => void; registerInk: (fn: ((m: any) => void) | null) => void }) {
  const [sent, setSent] = createSignal<string[]>([]);
  let input!: HTMLInputElement;
  const bind = (el: HTMLCanvasElement) => { const r = inkRenderer(el); props.registerInk((m) => r.seg(m)); };
  onCleanup(() => props.registerInk(null));
  const go = () => {
    const t = input.value.trim();
    if (!t) return;
    props.onGuess(t);
    setSent((x) => [t, ...x].slice(0, 4)); input.value = ""; input.focus();
  };
  return (
    <div class="pc-screen pc-guesswrap">
      <div class="pc-q pc-q-sm">{props.s.title}</div>
      <canvas class="pc-canvas pc-watch" width={640} height={640} ref={bind} />
      <div class="pc-guessrow">
        <input ref={input} class="pc-name pc-guessinput" placeholder={props.s.placeholder ?? "your guess"} maxlength={props.s.max ?? 24}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") go(); }} />
        <button class="pc-go pc-guesssend" onClick={go}>Guess</button>
      </div>
      <Show when={sent().length}><div class="pc-sentlog"><For each={sent()}>{(g) => <span>{g}</span>}</For></div></Show>
    </div>
  );
}

// Celebrity hint-giver: sees the target's name + Wikipedia photo and types hints.
function DescribeScreen(props: { s: Extract<Screen, { kind: "describe" }>; onHint: (t: string) => void }) {
  const [sent, setSent] = createSignal<string[]>([]);
  const [imgOk, setImgOk] = createSignal(true);
  let input!: HTMLInputElement;
  const go = () => {
    const t = input.value.trim();
    if (!t) return;
    props.onHint(t);
    setSent((x) => [t, ...x].slice(0, 4)); input.value = ""; input.focus();
  };
  return (
    <div class="pc-screen pc-describe">
      <div class="pc-describe-name">{props.s.name}</div>
      <Show when={props.s.photo && imgOk()}>
        <img class="pc-describe-photo" src={props.s.photo} alt={props.s.name} referrerpolicy="no-referrer" onError={() => setImgOk(false)} />
      </Show>
      <Show when={props.s.credit}><div class="pc-describe-credit">{props.s.credit}</div></Show>
      <Show when={props.s.sub}><div class="pc-sub">{props.s.sub}</div></Show>
      <div class="pc-guessrow">
        <input ref={input} class="pc-name pc-guessinput" placeholder={props.s.placeholder ?? "a hint…"} maxlength={props.s.max ?? 40}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") go(); }} />
        <button class="pc-go pc-guesssend" onClick={go}>Hint</button>
      </div>
      <Show when={sent().length}><div class="pc-sentlog"><For each={sent()}>{(h) => <span>{h}</span>}</For></div></Show>
    </div>
  );
}

// Celebrity guesser: watches hints stream in (relayed) AND types guesses — repeatedly.
function HintGuessScreen(props: { s: Extract<Screen, { kind: "hintguess" }>; onGuess: (t: string) => void; registerHint: (fn: ((m: any) => void) | null) => void }) {
  const [hints, setHints] = createSignal<string[]>([]);
  const [sent, setSent] = createSignal<string[]>([]);
  let input!: HTMLInputElement;
  props.registerHint((m) => setHints((h) => [...h, String(m.text ?? "")]));
  onCleanup(() => props.registerHint(null));
  const go = () => {
    const t = input.value.trim();
    if (!t) return;
    props.onGuess(t);
    setSent((x) => [t, ...x].slice(0, 4)); input.value = ""; input.focus();
  };
  return (
    <div class="pc-screen pc-guesswrap">
      <div class="pc-q pc-q-sm">{props.s.title}</div>
      <div class="pc-hints">
        <Show when={hints().length} fallback={<span class="pc-hints-wait">Hints will appear here…</span>}>
          <For each={hints()}>{(h) => <div class="pc-hint">{h}</div>}</For>
        </Show>
      </div>
      <div class="pc-guessrow">
        <input ref={input} class="pc-name pc-guessinput" placeholder={props.s.placeholder ?? "your guess"} maxlength={props.s.max ?? 30}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") go(); }} />
        <button class="pc-go pc-guesssend" onClick={go}>Guess</button>
      </div>
      <Show when={sent().length}><div class="pc-sentlog"><For each={sent()}>{(g) => <span>{g}</span>}</For></div></Show>
    </div>
  );
}

function DrawScreen(props: { s: Extract<Screen, { kind: "draw" }>; draw: (m: unknown) => void }) {
  let render: ReturnType<typeof inkRenderer> | null = null;
  const bind = (el: HTMLCanvasElement) => {
    render = inkRenderer(el);
    let drawing = false;
    let last: [number, number] | null = null;
    const at = (e: PointerEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault(); drawing = true; last = at(e);
      render!.seg({ p: last, d: true }); props.draw({ p: last, d: true });
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = at(e);
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.006) return;
      render!.seg({ p, d: true }); props.draw({ p, d: true });
      last = p;
    });
    const up = () => { if (drawing) { drawing = false; last = null; render!.seg({ p: null, d: false }); props.draw({ p: null, d: false }); } };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  };
  const clear = () => { tick(); render?.clear(); props.draw({ clear: true }); };
  return (
    <div class="pc-screen pc-drawwrap">
      <div class="pc-word">Draw: <b>{props.s.word}</b></div>
      <canvas class="pc-canvas" width={640} height={640} ref={bind} />
      <button class="pc-clear" onClick={clear}>Clear</button>
    </div>
  );
}

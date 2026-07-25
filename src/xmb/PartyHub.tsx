// Party Games — the HOST screen (this console = the shared TV). Phones join by
// scanning the room QR (?party=CODE → PartyController) and become controllers
// over WebRTC data channels. The host is authoritative: it runs the game,
// pushes each phone a "screen" to show, collects their inputs, and keeps score.
// Four generic games you'd actually play with friends: a fast trivia buzzer, a
// bluff-the-group fact game, a write-something-funny game, and draw & guess.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { renderSVG } from "uqr";
import { partyHost, partyUrl, newPartyCode, type PartyHostHandle } from "../party/net";
import { TRIVIA, BLUFF, QUIPS, DRAW_WORDS, CHAMELEON, WOULD_YOU_RATHER, HERD_PROMPTS, LIKELY_PROMPTS, STORY_THEMES, CELEBRITIES, BOT_NAMES, BOT_LINES, BOT_COMMON, BOT_GUESSES, quipsPool, herdPool, loadCustom, saveCustom, randomAcronym, PLAYER_COLORS, shuffle, norm } from "../party/games";
import { setNavEnabled } from "../input";
import { wikiPerson, fetchTrivia } from "../apps";
import { POSES, poseVisible, pointsFor, scorePose } from "../pose";
import { startPoseCam, type PoseCam } from "../poseCam";
import { Icon } from "./icons";
import * as sfx from "../audio";

interface Player { id: string; cid: string; name: string; color: string; score: number }
type ScreenMsg = { kind: string; [k: string]: any };
interface Engine {
  players: () => Player[];
  screen: (s: ScreenMsg) => void;             // broadcast to all phones
  screenTo: (id: string, s: ScreenMsg) => void;
  raw: (msg: unknown) => void;                 // broadcast a non-screen message (e.g. ink)
  rawTo: (id: string, msg: unknown) => void;   // send a non-screen message to one peer (e.g. a hint to the guesser)
  addScore: (id: string, pts: number) => void;
  onEnd: () => void;                           // game over → back to scoreboard
  setInput: (fn: ((id: string, v: any) => void) | null) => void;
  setDraw: (fn: ((id: string, m: any) => void) | null) => void;
}

type GameKey = "trivia" | "bluff" | "quips" | "draw" | "chameleon" | "wyr" | "herd" | "acro" | "likely" | "story" | "celeb" | "pose";
const GAMES: { key: GameKey; name: string; blurb: string; min: number; icon: string }[] = [
  { key: "trivia", name: "Trivia Buzzer", blurb: "General-knowledge quiz — fastest correct answer scores most.", min: 1, icon: "question" },
  { key: "bluff", name: "Bluff", blurb: "An obscure true fact. Write a fake answer, then spot the real one among everyone's lies.", min: 2, icon: "mask" },
  { key: "quips", name: "Quips", blurb: "A silly prompt. Write the funniest answer, then vote for the winner.", min: 2, icon: "pen" },
  { key: "draw", name: "Draw & Guess", blurb: "One player draws a secret word, everyone else races to guess it.", min: 2, icon: "palette" },
  { key: "chameleon", name: "Chameleon", blurb: "Everyone gets the secret word — except one faker. Give clues aloud, then vote out the impostor.", min: 3, icon: "search" },
  { key: "wyr", name: "Would You Rather", blurb: "Impossible choices. Vote and watch the room split — just for fun, no scores.", min: 2, icon: "sliders" },
  { key: "herd", name: "Herd Mentality", blurb: "Answer the prompt — but you only score if you match the crowd. Think like everyone else.", min: 3, icon: "users" },
  { key: "acro", name: "Acronym", blurb: "Three random letters. Invent what they stand for, then vote for the best.", min: 2, icon: "spark" },
  { key: "likely", name: "Most Likely To", blurb: "Who in the room is most likely to…? Everyone votes — no hiding.", min: 3, icon: "cursor" },
  { key: "story", name: "Story Builder", blurb: "Everyone writes one blind line; the console stitches them into glorious nonsense. Just for laughs.", min: 2, icon: "book" },
  { key: "pose", name: "Pose Off", blurb: "No phones for this one — the console watches through the camera. Copy the pose on screen; closest shape wins.", min: 1, icon: "users" },
  { key: "celeb", name: "Celebrity", blurb: "Everyone picks a real person (they vote on one), grabs their photo, and drops hints — one guesser races to name them.", min: 3, icon: "star" },
];

// —— a single reusable countdown, auto-stopped when its game unmounts ——
function useCountdown() {
  const [left, setLeft] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let deadline = 0;
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const start = (sec: number, onDone: () => void) => {
    stop(); deadline = Date.now() + sec * 1000; setLeft(sec);
    timer = setInterval(() => {
      const r = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(r);
      if (r <= 0) { stop(); onDone(); }
    }, 200);
  };
  onCleanup(stop);
  return { left, start, stop };
}

export default function PartyHub(props: { onClose: () => void; onTrophy?: (id: string) => void }) {
  const code = newPartyCode();
  const [players, setPlayers] = createSignal<Player[]>([]);
  const [status, setStatus] = createSignal("opening room…");
  const [mode, setMode] = createSignal<"lobby" | GameKey>("lobby");
  let net: PartyHostHandle | null = null;
  let inputHandler: ((id: string, v: any) => void) | null = null;
  let drawHandler: ((id: string, m: any) => void) | null = null;
  const dropTimers = new Map<string, ReturnType<typeof setTimeout>>(); // cid → pending grace-period removal

  // —— bot players ——————————————————————————————————————————————————————————
  // Several games need 3+ people; a visitor alone (or a pair) can top the room up
  // with bots. A bot is just a player whose "phone" is us: whenever a screen is
  // addressed to it we schedule a plausible answer back through the SAME
  // inputHandler a real phone would hit, so no game needs bot-specific code.
  const isBot = (id: string) => id.startsWith("bot-");
  const botTimers = new Set<ReturnType<typeof setTimeout>>();
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
  const botReply = (id: string, s: ScreenMsg) => {
    let value: any;
    if (s.kind === "buttons") value = Math.floor(Math.random() * Math.max(1, (s.options as string[])?.length ?? 1));
    // on "name a…" prompts bots have a herd instinct — they mostly say the same
    // obvious thing, so match-the-crowd games actually score instead of scattering
    else if (s.kind === "text") value = /name a|match/i.test(String(s.title ?? "") + String(s.sub ?? ""))
      ? (Math.random() < 0.65 ? BOT_COMMON[0] : pick(BOT_COMMON))
      : pick(BOT_LINES);
    else if (s.kind === "hintguess" || s.kind === "guess") value = pick(BOT_GUESSES);
    else if (s.kind === "describe") value = pick(BOT_LINES);
    else return; // wait / draw screens need nothing (bots never draw — see DrawGame)
    const t = setTimeout(() => { botTimers.delete(t); inputHandler?.(id, value); }, 1200 + Math.random() * 3200);
    botTimers.add(t);
  };
  const addBot = () => {
    setPlayers((ps) => {
      if (ps.length >= 7) return ps;
      const n = ps.filter((p) => isBot(p.id)).length;
      const id = `bot-${n + 1}`;
      return [...ps, { id, cid: id, name: `${BOT_NAMES[n % BOT_NAMES.length]} · bot`, color: PLAYER_COLORS[ps.length % PLAYER_COLORS.length], score: 0 }];
    });
    sfx.tickH?.();
  };

  const eng: Engine = {
    players,
    screen: (s) => { net?.broadcast({ t: "screen", s }); for (const p of players()) if (isBot(p.id)) botReply(p.id, s); },
    screenTo: (id, s) => { if (isBot(id)) { botReply(id, s); return; } net?.send(id, { t: "screen", s }); },
    raw: (msg) => net?.broadcast(msg),
    rawTo: (id, msg) => { if (!isBot(id)) net?.send(id, msg); }, // bots have no screen to relay to
    addScore: (id, pts) => setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, score: p.score + pts } : p))),
    onEnd: () => { inputHandler = null; drawHandler = null; sfx.confirm?.(); setMode("lobby"); eng.screen({ kind: "wait", title: "Round over!", msg: "Check the big screen — pick the next game." }); },
    setInput: (fn) => (inputHandler = fn),
    setDraw: (fn) => (drawHandler = fn),
  };

  onMount(() => {
    setNavEnabled(false);
    props.onTrophy?.("partyhost"); // opening a room is the achievement here
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back?.(); props.onClose(); } };
    addEventListener("keydown", esc);
    net = partyHost(code, {
      onStatus: (s) => setStatus(s),
      onJoin: () => {},
      // A drop starts a GRACE timer, not an instant removal — a phone that
      // auto-reconnects (same cid) within the window keeps its seat + score.
      onLeave: (id) => setPlayers((ps) => {
        const p = ps.find((x) => x.id === id);
        if (!p || dropTimers.has(p.cid)) return ps;
        dropTimers.set(p.cid, setTimeout(() => { dropTimers.delete(p.cid); setPlayers((cur) => cur.filter((x) => x.cid !== p.cid)); }, 18000));
        return ps;
      }),
      onMessage: (id, m) => {
        if (m?.t === "join") {
          const cid = String(m.cid || id);
          const name = String(m.name || "Player").slice(0, 14);
          const t = dropTimers.get(cid); if (t) { clearTimeout(t); dropTimers.delete(cid); } // reconnected in time
          setPlayers((ps) => {
            const prev = ps.find((p) => p.cid === cid);
            if (prev) { // reconnect: relink to the new peer id, keep name/color/score
              queueMicrotask(() => {
                net?.send(id, { t: "me", name: prev.name, color: prev.color });
                if (mode() !== "lobby") net?.send(id, { t: "screen", s: { kind: "wait", title: "Reconnected ✓", msg: "You're back — hang on for the next round." } });
              });
              return ps.map((p) => (p.cid === cid ? { ...p, id } : p));
            }
            const color = PLAYER_COLORS[ps.length % PLAYER_COLORS.length];
            queueMicrotask(() => {
              net?.send(id, { t: "me", name, color });
              if (mode() !== "lobby") net?.send(id, { t: "screen", s: { kind: "wait", title: "Hang tight", msg: "You'll be in on the next round." } });
            });
            return [...ps, { id, cid, name, color, score: 0 }];
          });
          sfx.tickH?.();
        } else if (m?.t === "in") inputHandler?.(id, m.v);
        else if (m?.t === "draw") drawHandler?.(id, m);
      },
    });
    onCleanup(() => {
      removeEventListener("keydown", esc);
      for (const t of dropTimers.values()) clearTimeout(t);
      for (const t of botTimers) clearTimeout(t);
      net?.stop(); setNavEnabled(true);
    });
  });

  // custom prompt pack editor (host-side, persisted, mixed into the pools)
  const [packOpen, setPackOpen] = createSignal(false);
  const [packQuips, setPackQuips] = createSignal("");
  const [packHerd, setPackHerd] = createSignal("");
  const savePack = () => {
    saveCustom({ quips: packQuips().split("\n"), herd: packHerd().split("\n") });
    sfx.confirm?.(); setPackOpen(false);
  };

  const start = (g: GameKey) => {
    const need = GAMES.find((x) => x.key === g)!.min;
    if (players().length < need) return;
    sfx.confirm?.();
    setMode(g);
  };

  createEffect(() => { if (players().length >= 4) props.onTrophy?.("fullhouse"); });

  const sorted = () => [...players()].sort((a, b) => b.score - a.score);

  return (
    /* pad-focus-scope: L1/R1 walk focus so a controller can drive the host screen */
    <div class="ph-root pad-focus-scope">
      <div class="ph-head">
        <div class="panel-tag">PARTY GAMES</div>
        <div class="ph-code">ROOM <b>{code}</b></div>
        <button class="ps-act" onClick={() => { sfx.back?.(); props.onClose(); }}><span class="btn-o" /> close</button>
      </div>

      <Show when={mode() === "lobby"}>
        <div class="ph-lobby">
          <div class="ph-join">
            <div class="ph-qr" innerHTML={renderSVG(partyUrl(code))} />
            <div class="ph-joininfo">
              <h2>Everyone grab a phone</h2>
              <p>Open the camera and scan, or go to</p>
              <div class="ph-url">{partyUrl(code).replace(/^https?:\/\//, "")}</div>
              <p class="ph-small">Up to 7 players · {status()}</p>
              {/* solo or short-handed? bots make the 3+ player games reachable */}
              <button class="ps-act ph-lobact" onClick={addBot}>Add a bot player</button>
              <button class="ps-act ph-lobact" onClick={() => { const c = loadCustom(); setPackQuips(c.quips.join("\n")); setPackHerd(c.herd.join("\n")); setPackOpen(true); }}>Your own prompts</button>
            </div>
          </div>

          <div class="ph-players">
            <Show when={players().length} fallback={<div class="ph-empty">No players yet — waiting for phones to join…</div>}>
              <For each={sorted()}>
                {(p) => <div class="ph-player"><i style={{ background: p.color }} /><span>{p.name}</span><b>{p.score}</b></div>}
              </For>
            </Show>
          </div>

          <div class="ph-games bg-tiles">
            <For each={GAMES}>
              {(g) => (
                <button class="ph-game bg-tile" disabled={players().length < g.min} onClick={() => start(g.key)}>
                  <span class="bg-tile-ic"><Icon name={g.icon} /></span>
                  <span class="bg-tile-name">{g.name}</span>
                  <span class="bg-tile-p">{g.min === 1 ? "ANY NUMBER" : `${g.min}+ PLAYERS`}</span>
                  <span class="bg-tile-sub">{g.blurb}</span>
                  <Show when={players().length < g.min}><span class="ph-game-need">needs {g.min - players().length} more</span></Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* custom pack editor — one prompt per line, saved on this console */}
      <Show when={packOpen()}>
        <div class="ph-pack">
          <div class="ph-pack-box">
            <h2>Your own prompts</h2>
            <p>One per line. These get mixed in with the built-in ones — they never replace them.</p>
            <label>Quips prompts <span>“A terrible name for a boat”</span></label>
            <textarea value={packQuips()} onInput={(e) => setPackQuips(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={"The worst gift for our group chat\nSomething Dave would definitely say"} />
            <label>Herd prompts <span>“Name a colour”</span></label>
            <textarea value={packHerd()} onInput={(e) => setPackHerd(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={"Name a takeaway we always order\nName someone always late"} />
            <div class="ph-pack-acts">
              <button class="ps-act" onClick={savePack}><span class="btn-x" /> save pack</button>
              <button class="ps-act" onClick={() => setPackOpen(false)}><span class="btn-o" /> cancel</button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={mode() === "trivia"}><TriviaGame eng={eng} /></Show>
      <Show when={mode() === "bluff"}><BluffGame eng={eng} /></Show>
      <Show when={mode() === "quips"}><QuipsGame eng={eng} /></Show>
      <Show when={mode() === "draw"}><DrawGame eng={eng} /></Show>
      <Show when={mode() === "chameleon"}><ChameleonGame eng={eng} /></Show>
      <Show when={mode() === "wyr"}><WouldYouRatherGame eng={eng} /></Show>
      <Show when={mode() === "herd"}><HerdGame eng={eng} /></Show>
      <Show when={mode() === "acro"}><AcronymGame eng={eng} /></Show>
      <Show when={mode() === "likely"}><LikelyGame eng={eng} /></Show>
      <Show when={mode() === "story"}><StoryGame eng={eng} /></Show>
      <Show when={mode() === "pose"}><PoseGame eng={eng} /></Show>
      <Show when={mode() === "celeb"}><CelebGame eng={eng} /></Show>

      {/* running leaderboard, always visible during a game */}
      <Show when={mode() !== "lobby" && players().length}>
        <div class="ph-score">
          <For each={sorted()}>{(p) => <span class="ph-chip"><i style={{ background: p.color }} />{p.name} <b>{p.score}</b></span>}</For>
        </div>
      </Show>
    </div>
  );
}

const OPT_COLORS = ["#ff5c8a", "#4aa3ff", "#ffc94a", "#43d9a3"];

// ————————————————————————————————————————————— TRIVIA
function TriviaGame(props: { eng: Engine }) {
  const eng = props.eng;
  // Questions come from OpenTDB (the same live source the Trivia Arcade uses) so
  // the quiz never repeats party to party; the built-in list is the offline
  // fallback. `qs` is mutable because the fetch lands after the first render.
  const [qs, setQs] = createSignal(
    shuffle(TRIVIA).slice(0, 6).map((q) => { const opts = shuffle(q.options); return { q: q.q, opts, correct: opts.indexOf(q.options[0]) }; }),
  );
  const [live, setLive] = createSignal(false);
  const [qi, setQi] = createSignal(0);
  const [phase, setPhase] = createSignal<"q" | "reveal">("q");
  const [answered, setAnswered] = createSignal(0);
  const answers = new Map<string, { idx: number; t: number }>();
  let askedAt = 0;
  const cd = useCountdown();
  const cur = () => qs()[qi()];

  const ask = () => {
    answers.clear(); setAnswered(0); setPhase("q"); askedAt = Date.now();
    eng.screen({ kind: "buttons", title: cur().q, sub: `Question ${qi() + 1} of ${qs().length}`, options: cur().opts, colors: OPT_COLORS });
    cd.start(15, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    for (const [id, a] of answers) if (a.idx === cur().correct) eng.addScore(id, Math.round(1000 - 500 * Math.min(1, a.t / 15000)));
    for (const p of eng.players()) {
      const a = answers.get(p.id);
      eng.screenTo(p.id, { kind: "wait", title: a && a.idx === cur().correct ? "Correct! ✓" : "Nope ✗", msg: `Answer: ${cur().opts[cur().correct]}` });
    }
    cd.start(4, () => { if (qi() < qs().length - 1) { setQi(qi() + 1); ask(); } else eng.onEnd(); });
  };

  onMount(() => {
    // try live questions first; if they arrive before question 2 we swap them in
    fetchTrivia()
      .then((rows) => {
        const fresh = rows.filter((r) => r.answers?.length === 4).slice(0, 6)
          .map((r) => ({ q: r.q, opts: r.answers, correct: r.correct }));
        if (fresh.length >= 4 && qi() === 0) { setQs(fresh); setLive(true); ask(); }
      })
      .catch(() => { /* offline → the built-in questions are already loaded */ });
    ask();
  });
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() !== "q" || typeof v !== "number" || answers.has(id)) return;
    answers.set(id, { idx: v, t: Date.now() - askedAt });
    setAnswered(answers.size);
    if (eng.players().every((p) => answers.has(p.id))) reveal();
  });

  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-question">{cur().q}</div>
      <div class="ph-grid4">
        <For each={cur().opts}>
          {(o, i) => (
            <div class="ph-tri-opt" classList={{ correct: phase() === "reveal" && i() === cur().correct, dim: phase() === "reveal" && i() !== cur().correct }}
              style={{ "--oc": OPT_COLORS[i()] }}>
              <span class="ph-tri-letter">{String.fromCharCode(65 + i())}</span>{o}
            </div>
          )}
        </For>
      </div>
      <div class="ph-hint">{phase() === "q" ? `${answered()} / ${eng.players().length} answered — tap on your phone` : "Next question…"}</div>
    </div>
  );
}

// ————————————————————————————————————————————— BLUFF
function BluffGame(props: { eng: Engine }) {
  const eng = props.eng;
  const rounds = shuffle(BLUFF).slice(0, 3);
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"write" | "vote" | "reveal">("write");
  const [count, setCount] = createSignal(0);
  const [opts, setOpts] = createSignal<{ text: string; owner: string | null }[]>([]);
  const [tally, setTally] = createSignal<number[]>([]);
  let lies = new Map<string, string>();
  let votes = new Map<string, number>();
  const cd = useCountdown();
  const cur = () => rounds[ri()];

  const startWrite = () => {
    lies = new Map(); setCount(0); setPhase("write");
    eng.screen({ kind: "text", title: cur().q, sub: "Invent a convincing FAKE answer to fool everyone.", placeholder: "your fake answer", max: 40 });
    cd.start(35, toVote);
  };
  const toVote = () => {
    cd.stop(); votes = new Map(); setCount(0);
    const seen = new Set([norm(cur().answer)]);
    const list: { text: string; owner: string | null }[] = [{ text: cur().answer, owner: null }];
    for (const [id, lie] of lies) { const n = norm(lie); if (n && !seen.has(n)) { seen.add(n); list.push({ text: lie, owner: id }); } }
    setOpts(shuffle(list)); setPhase("vote");
    eng.screen({ kind: "buttons", title: "Which is the REAL answer?", sub: cur().q, options: opts().map((o) => o.text) });
    cd.start(25, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    const t = opts().map(() => 0);
    for (const [voter, idx] of votes) {
      const o = opts()[idx]; if (!o) continue; t[idx]++;
      if (o.owner === null) eng.addScore(voter, 1000);
      else if (o.owner !== voter) eng.addScore(o.owner, 500);
    }
    setTally(t);
    for (const p of eng.players()) { const v = votes.get(p.id); eng.screenTo(p.id, { kind: "wait", title: v != null && opts()[v]?.owner === null ? "You found it! ✓" : "Fooled! ✗", msg: `Real answer: ${cur().answer}` }); }
    cd.start(7, () => { if (ri() < rounds.length - 1) { setRi(ri() + 1); startWrite(); } else eng.onEnd(); });
  };

  onMount(startWrite);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() === "write" && typeof v === "string") {
      const t = v.trim().slice(0, 40); if (!t) return;
      lies.set(id, t); setCount(lies.size);
      eng.screenTo(id, { kind: "wait", title: "Lie submitted 😈", msg: "Waiting for the others…" });
      if (eng.players().every((p) => lies.has(p.id))) toVote();
    } else if (phase() === "vote" && typeof v === "number") {
      if (votes.has(id)) return;
      votes.set(id, v); setCount(votes.size);
      eng.screenTo(id, { kind: "wait", title: "Vote cast", msg: "Waiting for the others…" });
      if (eng.players().every((p) => votes.has(p.id))) reveal();
    }
  });

  const ownerName = (oid: string | null) => oid === null ? "THE TRUTH" : (eng.players().find((p) => p.id === oid)?.name ?? "?");
  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {rounds.length} · Bluff</div>
      <div class="ph-question">{cur().q}</div>
      <Show when={phase() === "write"}><div class="ph-hint">Writing fake answers on phones… {count()} / {eng.players().length} in</div></Show>
      <Show when={phase() !== "write"}>
        <div class="ph-list">
          <For each={opts()}>
            {(o, i) => (
              <div class="ph-bluff-opt" classList={{ truth: phase() === "reveal" && o.owner === null }}>
                <span class="ph-bluff-text">{o.text}</span>
                <Show when={phase() === "reveal"}><span class="ph-bluff-owner">{ownerName(o.owner)}{tally()[i()] ? ` · ${tally()[i()]} vote${tally()[i()] > 1 ? "s" : ""}` : ""}</span></Show>
              </div>
            )}
          </For>
        </div>
        <Show when={phase() === "vote"}><div class="ph-hint">Vote on your phone — {count()} / {eng.players().length} voted</div></Show>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— QUIPS
function QuipsGame(props: { eng: Engine }) {
  const eng = props.eng;
  const prompts = shuffle(quipsPool()).slice(0, 3);
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"write" | "vote" | "reveal">("write");
  const [count, setCount] = createSignal(0);
  const [opts, setOpts] = createSignal<{ text: string; owner: string }[]>([]);
  const [tally, setTally] = createSignal<number[]>([]);
  let answers = new Map<string, string>();
  let votes = new Map<string, number>();
  const cd = useCountdown();
  const cur = () => prompts[ri()];

  const startWrite = () => {
    answers = new Map(); setCount(0); setPhase("write");
    eng.screen({ kind: "text", title: cur(), sub: "Write the funniest answer you can.", placeholder: "your answer", max: 80 });
    cd.start(35, toVote);
  };
  const toVote = () => {
    cd.stop(); votes = new Map(); setCount(0);
    const list = [...answers].map(([owner, text]) => ({ owner, text }));
    setOpts(shuffle(list)); setPhase("vote");
    if (!list.length) { cd.start(1, () => { if (ri() < prompts.length - 1) { setRi(ri() + 1); startWrite(); } else eng.onEnd(); }); return; }
    eng.screen({ kind: "buttons", title: "Vote for the funniest", sub: cur(), options: opts().map((o) => o.text) });
    cd.start(25, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    const t = opts().map(() => 0);
    for (const [voter, idx] of votes) { const o = opts()[idx]; if (!o) continue; t[idx]++; if (o.owner !== voter) eng.addScore(o.owner, 200); }
    setTally(t);
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "Votes are in", msg: "Check the big screen 👀" });
    cd.start(7, () => { if (ri() < prompts.length - 1) { setRi(ri() + 1); startWrite(); } else eng.onEnd(); });
  };

  onMount(startWrite);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() === "write" && typeof v === "string") {
      const t = v.trim().slice(0, 80); if (!t) return;
      answers.set(id, t); setCount(answers.size);
      eng.screenTo(id, { kind: "wait", title: "Answer locked 🔒", msg: "Waiting for the others…" });
      if (eng.players().every((p) => answers.has(p.id))) toVote();
    } else if (phase() === "vote" && typeof v === "number") {
      if (votes.has(id)) return;
      votes.set(id, v); setCount(votes.size);
      eng.screenTo(id, { kind: "wait", title: "Vote cast", msg: "Waiting for the others…" });
      if (eng.players().every((p) => votes.has(p.id))) reveal();
    }
  });

  const name = (oid: string) => eng.players().find((p) => p.id === oid)?.name ?? "?";
  const ranked = () => opts().map((o, i) => ({ ...o, v: tally()[i] ?? 0 })).sort((a, b) => b.v - a.v);
  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {prompts.length} · Quips</div>
      <div class="ph-question">{cur()}</div>
      <Show when={phase() === "write"}><div class="ph-hint">Answering on phones… {count()} / {eng.players().length} in</div></Show>
      <Show when={phase() === "vote"}>
        <div class="ph-list"><For each={opts()}>{(o) => <div class="ph-quip-opt">{o.text}</div>}</For></div>
        <div class="ph-hint">Vote on your phone — {count()} / {eng.players().length} voted</div>
      </Show>
      <Show when={phase() === "reveal"}>
        <div class="ph-list"><For each={ranked()}>{(o, i) => <div class="ph-quip-opt" classList={{ win: i() === 0 && o.v > 0 }}><span>{o.text}</span><span class="ph-bluff-owner">{name(o.owner)} · {o.v} vote{o.v === 1 ? "" : "s"}</span></div>}</For></div>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— DRAW & GUESS
function DrawGame(props: { eng: Engine }) {
  const eng = props.eng;
  const total = Math.min(Math.max(eng.players().length, 2), 4); // one round per player, cap 4
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"draw" | "reveal">("draw");
  const [drawer, setDrawer] = createSignal("");
  const [gotIt, setGotIt] = createSignal<string[]>([]);
  let word = "";
  let drawerId = "";
  let order = 0;
  const correct = new Set<string>();
  const cd = useCountdown();
  let canvas: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let lastPt: [number, number] | null = null;
  const W = 900, H = 560;

  const bindCanvas = (el: HTMLCanvasElement) => { canvas = el; ctx = el.getContext("2d"); if (ctx) { ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#eaf2ff"; } };
  const clearCanvas = () => { if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height); lastPt = null; };

  const startRound = () => {
    const ps = eng.players();
    if (ps.length < 2) { eng.onEnd(); return; }
    correct.clear(); setGotIt([]); clearCanvas(); setPhase("draw");
    // bots can't draw, so the pen always goes to a real person
    const pens = ps.filter((p) => !p.id.startsWith("bot-"));
    const pool = pens.length ? pens : ps;
    drawerId = pool[order % pool.length].id; order++;
    setDrawer(ps.find((p) => p.id === drawerId)?.name ?? "?");
    word = shuffle(DRAW_WORDS)[0];
    for (const p of ps) {
      if (p.id === drawerId) eng.screenTo(p.id, { kind: "draw", title: "You're drawing!", word });
      else eng.screenTo(p.id, { kind: "guess", title: "Guess the drawing!", placeholder: "your guess", max: 24 });
    }
    cd.start(70, endRound);
  };
  const endRound = () => {
    cd.stop(); setPhase("reveal");
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "Round over", msg: `The word was “${word}”` });
    cd.start(5, () => { if (ri() < total - 1) { setRi(ri() + 1); startRound(); } else eng.onEnd(); });
  };

  onMount(startRound);
  onCleanup(() => { eng.setInput(null); eng.setDraw(null); });
  eng.setDraw((id, m) => {
    if (id !== drawerId) return;
    eng.raw({ t: "ink", p: m.p, d: m.d, clear: m.clear }); // relay to the guessers' phones
    if (!ctx || !canvas) return;
    if (m.clear) { clearCanvas(); return; }
    if (m.d && Array.isArray(m.p)) {
      const x = m.p[0] * canvas.width, y = m.p[1] * canvas.height;
      if (lastPt) { ctx.beginPath(); ctx.moveTo(lastPt[0], lastPt[1]); ctx.lineTo(x, y); ctx.stroke(); }
      lastPt = [x, y];
    } else lastPt = null;
  });
  eng.setInput((id, v) => {
    if (phase() !== "draw" || id === drawerId || correct.has(id) || typeof v !== "string") return;
    if (norm(v) === norm(word)) {
      correct.add(id);
      const guessers = eng.players().filter((p) => p.id !== drawerId);
      setGotIt(guessers.filter((p) => correct.has(p.id)).map((p) => p.name));
      eng.addScore(id, Math.max(100, 400 - (correct.size - 1) * 100));
      eng.addScore(drawerId, 100);
      eng.screenTo(id, { kind: "wait", title: "Correct! 🎉", msg: `It was “${word}”` });
      if (guessers.every((p) => correct.has(p.id))) endRound();
    }
  });

  return (
    <div class="ph-stage ph-drawstage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {total} · <b>{drawer()}</b> is drawing{phase() === "reveal" ? ` — it was “${word}”` : ""}</div>
      <canvas class="ph-canvas" width={W} height={H} ref={bindCanvas} />
      <div class="ph-hint">
        <Show when={gotIt().length} fallback="Everyone else: guess on your phone!">Guessed it: {gotIt().join(", ")}</Show>
      </div>
    </div>
  );
}

// ————————————————————————————————————————————— CHAMELEON (social deduction)
function ChameleonGame(props: { eng: Engine }) {
  const eng = props.eng;
  const ROUNDS = 3;
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"clue" | "vote" | "reveal">("clue");
  const [category, setCategory] = createSignal("");
  const [count, setCount] = createSignal(0);
  const [result, setResult] = createSignal<{ word: string; chameleon: string; accused: string | null; caught: boolean } | null>(null);
  let word = "";
  let chameleonId = "";
  let voteList: Player[] = [];
  let votes = new Map<string, number>();
  const cd = useCountdown();

  const startClue = () => {
    votes = new Map(); setCount(0); setResult(null); setPhase("clue");
    const cat = shuffle(CHAMELEON)[0];
    setCategory(cat.name);
    word = shuffle(cat.words)[0];
    const ps = eng.players();
    chameleonId = ps[Math.floor(Math.random() * ps.length)].id;
    for (const p of ps) {
      if (p.id === chameleonId) eng.screenTo(p.id, { kind: "wait", title: "You're the CHAMELEON 🦎", msg: `Category: ${cat.name}. Blend in — you don't know the secret word!` });
      else eng.screenTo(p.id, { kind: "wait", title: `Secret word: ${word}`, msg: `Category: ${cat.name}. Say a one-word clue out loud.` });
    }
    cd.start(60, toVote);
  };
  const toVote = () => {
    cd.stop(); votes = new Map(); setCount(0); setPhase("vote");
    voteList = eng.players();
    eng.screen({ kind: "buttons", title: "Who is the Chameleon? 🦎", sub: `Category: ${category()}`, options: voteList.map((p) => p.name) });
    cd.start(25, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    const tally = new Map<string, number>();
    for (const [, idx] of votes) { const c = voteList[idx]; if (c) tally.set(c.id, (tally.get(c.id) ?? 0) + 1); }
    let accused: string | null = null, max = 0;
    for (const [id, n] of tally) if (n > max) { max = n; accused = id; }
    const tiedTop = [...tally.values()].filter((n) => n === max).length;
    const caught = accused === chameleonId && tiedTop === 1 && max > 0;
    if (caught) { for (const [voter, idx] of votes) if (voter !== chameleonId && voteList[idx]?.id === chameleonId) eng.addScore(voter, 500); }
    else eng.addScore(chameleonId, 1000);
    const chamName = eng.players().find((p) => p.id === chameleonId)?.name ?? "?";
    const accName = accused ? (eng.players().find((p) => p.id === accused)?.name ?? "?") : null;
    setResult({ word, chameleon: chamName, accused: accName, caught });
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: caught ? "Chameleon caught! 🎉" : "Chameleon escaped! 🦎", msg: `It was ${chamName} · word: ${word}` });
    cd.start(8, () => { if (ri() < ROUNDS - 1) { setRi(ri() + 1); startClue(); } else eng.onEnd(); });
  };

  onMount(startClue);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() !== "vote" || typeof v !== "number" || votes.has(id)) return;
    votes.set(id, v); setCount(votes.size);
    eng.screenTo(id, { kind: "wait", title: "Vote cast", msg: "Waiting for the others…" });
    if (eng.players().every((p) => votes.has(p.id))) reveal();
  });

  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {ROUNDS} · Chameleon</div>
      <Show when={phase() === "clue"}>
        <div class="ph-question">Category · <b>{category()}</b></div>
        <div class="ph-cham-note">🦎 One of you is the Chameleon and doesn't know the word. Everyone say a <b>one-word clue</b> about the secret word out loud — then vote.</div>
        <button class="ps-act ph-lobact" onClick={toVote}><span class="btn-x" /> everyone's given a clue — vote now</button>
      </Show>
      <Show when={phase() === "vote"}>
        <div class="ph-question">Who is the Chameleon? 🦎</div>
        <div class="ph-hint">Vote on your phone — {count()} / {eng.players().length} voted</div>
      </Show>
      <Show when={phase() === "reveal" && result()}>
        <div class="ph-cham-result" classList={{ caught: result()!.caught }}>{result()!.caught ? "Caught! 🎉" : "The Chameleon escaped! 🦎"}</div>
        <div class="ph-question">It was <b>{result()!.chameleon}</b></div>
        <div class="ph-hint">The secret word was “{result()!.word}”{result()!.accused ? ` · the room accused ${result()!.accused}` : ""}</div>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— WOULD YOU RATHER (poll, no score)
function WouldYouRatherGame(props: { eng: Engine }) {
  const eng = props.eng;
  const rounds = shuffle(WOULD_YOU_RATHER).slice(0, 6);
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"vote" | "reveal">("vote");
  const [count, setCount] = createSignal(0);
  const [split, setSplit] = createSignal<[number, number]>([0, 0]);
  let votes = new Map<string, number>();
  const cd = useCountdown();
  const cur = () => rounds[ri()];

  const ask = () => {
    votes = new Map(); setCount(0); setSplit([0, 0]); setPhase("vote");
    eng.screen({ kind: "buttons", title: "Would you rather…", options: [...cur()], colors: ["#4aa3ff", "#ff5c8a"] });
    cd.start(20, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    let a = 0, b = 0; for (const [, v] of votes) v === 0 ? a++ : b++;
    setSplit([a, b]);
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "See the big screen 👀", msg: "" });
    cd.start(6, () => { if (ri() < rounds.length - 1) { setRi(ri() + 1); ask(); } else eng.onEnd(); });
  };

  onMount(ask);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() !== "vote" || typeof v !== "number" || votes.has(id)) return;
    votes.set(id, v); setCount(votes.size);
    eng.screenTo(id, { kind: "wait", title: "Locked in", msg: "Waiting for the others…" });
    if (eng.players().every((p) => votes.has(p.id))) reveal();
  });

  const pct = (n: number) => { const t = split()[0] + split()[1]; return t ? Math.round((n / t) * 100) : 0; };
  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">{ri() + 1} / {rounds.length} · Would You Rather</div>
      <div class="ph-wyr">
        <div class="ph-wyr-opt" style={{ "--oc": "#4aa3ff" }}>
          <span class="ph-wyr-text">{cur()[0]}</span>
          <Show when={phase() === "reveal"}><span class="ph-wyr-pct">{pct(split()[0])}%</span><div class="ph-bar" style={{ width: pct(split()[0]) + "%", background: "#4aa3ff" }} /></Show>
        </div>
        <div class="ph-wyr-or">OR</div>
        <div class="ph-wyr-opt" style={{ "--oc": "#ff5c8a" }}>
          <span class="ph-wyr-text">{cur()[1]}</span>
          <Show when={phase() === "reveal"}><span class="ph-wyr-pct">{pct(split()[1])}%</span><div class="ph-bar" style={{ width: pct(split()[1]) + "%", background: "#ff5c8a" }} /></Show>
        </div>
      </div>
      <div class="ph-hint">{phase() === "vote" ? `Vote on your phone — ${count()} / ${eng.players().length} in` : "Just for fun — no points here 😌"}</div>
    </div>
  );
}

// ————————————————————————————————————————————— HERD MENTALITY (match the crowd)
function HerdGame(props: { eng: Engine }) {
  const eng = props.eng;
  const prompts = shuffle(herdPool()).slice(0, 4);
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"write" | "reveal">("write");
  const [count, setCount] = createSignal(0);
  const [groups, setGroups] = createSignal<{ answer: string; names: string[] }[]>([]);
  let answers = new Map<string, string>();
  const cd = useCountdown();
  const cur = () => prompts[ri()];

  const ask = () => {
    answers = new Map(); setCount(0); setGroups([]); setPhase("write");
    eng.screen({ kind: "text", title: cur(), sub: "Match the group! You only score if others say the same thing.", placeholder: "your answer", max: 30 });
    cd.start(30, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    const byNorm = new Map<string, { display: string; ids: string[] }>();
    for (const [id, ans] of answers) { const n = norm(ans); if (!n) continue; const g = byNorm.get(n); if (g) g.ids.push(id); else byNorm.set(n, { display: ans, ids: [id] }); }
    for (const { ids } of byNorm.values()) if (ids.length > 1) for (const id of ids) eng.addScore(id, (ids.length - 1) * 200);
    const gs = [...byNorm.values()].map((g) => ({ answer: g.display, names: g.ids.map((id) => eng.players().find((p) => p.id === id)?.name ?? "?") })).sort((a, b) => b.names.length - a.names.length);
    setGroups(gs);
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "Answers are in", msg: "Check the big screen 👀" });
    cd.start(7, () => { if (ri() < prompts.length - 1) { setRi(ri() + 1); ask(); } else eng.onEnd(); });
  };

  onMount(ask);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() !== "write" || typeof v !== "string") return;
    const t = v.trim().slice(0, 30); if (!t) return;
    answers.set(id, t); setCount(answers.size);
    eng.screenTo(id, { kind: "wait", title: "Answer locked 🔒", msg: "Waiting for the others…" });
    if (eng.players().every((p) => answers.has(p.id))) reveal();
  });

  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {prompts.length} · Herd Mentality</div>
      <div class="ph-question">{cur()}</div>
      <Show when={phase() === "write"}><div class="ph-hint">Answering on phones… {count()} / {eng.players().length} in</div></Show>
      <Show when={phase() === "reveal"}>
        <div class="ph-list">
          <For each={groups()}>
            {(g, i) => (
              <div class="ph-bluff-opt" classList={{ truth: i() === 0 && g.names.length > 1 }}>
                <span class="ph-bluff-text">{g.answer} <span class="ph-herd-x">×{g.names.length}</span></span>
                <span class="ph-bluff-owner">{g.names.join(", ")}</span>
              </div>
            )}
          </For>
        </div>
        <div class="ph-hint">The herd wins — matching answers score points 🐑</div>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— ACRONYM (invent + vote)
function AcronymGame(props: { eng: Engine }) {
  const eng = props.eng;
  const ROUNDS = 3;
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"write" | "vote" | "reveal">("write");
  const [count, setCount] = createSignal(0);
  const [acro, setAcro] = createSignal("");
  const [opts, setOpts] = createSignal<{ text: string; owner: string }[]>([]);
  const [tally, setTally] = createSignal<number[]>([]);
  let answers = new Map<string, string>();
  let votes = new Map<string, number>();
  const cd = useCountdown();
  const next = () => { if (ri() < ROUNDS - 1) { setRi(ri() + 1); startWrite(); } else eng.onEnd(); };

  const startWrite = () => {
    answers = new Map(); setCount(0); setPhase("write");
    const a = randomAcronym(3); setAcro(a);
    eng.screen({ kind: "text", title: a.split("").join(". ") + ".", sub: "What does it stand for? Make it count.", placeholder: "e.g. Giant Purple Turtle", max: 40 });
    cd.start(35, toVote);
  };
  const toVote = () => {
    cd.stop(); votes = new Map(); setCount(0);
    const list = [...answers].map(([owner, text]) => ({ owner, text }));
    setOpts(shuffle(list)); setPhase("vote");
    if (!list.length) { cd.start(1, next); return; }
    eng.screen({ kind: "buttons", title: `Best “${acro()}”?`, options: opts().map((o) => o.text) });
    cd.start(25, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    const t = opts().map(() => 0);
    for (const [voter, idx] of votes) { const o = opts()[idx]; if (!o) continue; t[idx]++; if (o.owner !== voter) eng.addScore(o.owner, 200); }
    setTally(t);
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "Votes are in", msg: "Check the big screen 👀" });
    cd.start(7, next);
  };

  onMount(startWrite);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() === "write" && typeof v === "string") {
      const t = v.trim().slice(0, 40); if (!t) return;
      answers.set(id, t); setCount(answers.size);
      eng.screenTo(id, { kind: "wait", title: "Submitted 🔤", msg: "Waiting for the others…" });
      if (eng.players().every((p) => answers.has(p.id))) toVote();
    } else if (phase() === "vote" && typeof v === "number") {
      if (votes.has(id)) return;
      votes.set(id, v); setCount(votes.size);
      eng.screenTo(id, { kind: "wait", title: "Vote cast", msg: "Waiting for the others…" });
      if (eng.players().every((p) => votes.has(p.id))) reveal();
    }
  });

  const name = (oid: string) => eng.players().find((p) => p.id === oid)?.name ?? "?";
  const ranked = () => opts().map((o, i) => ({ ...o, v: tally()[i] ?? 0 })).sort((a, b) => b.v - a.v);
  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {ROUNDS} · Acronym</div>
      <div class="ph-acro"><For each={acro().split("")}>{(c) => <span>{c}</span>}</For></div>
      <Show when={phase() === "write"}><div class="ph-hint">Inventing meanings… {count()} / {eng.players().length} in</div></Show>
      <Show when={phase() === "vote"}>
        <div class="ph-list"><For each={opts()}>{(o) => <div class="ph-quip-opt">{o.text}</div>}</For></div>
        <div class="ph-hint">Vote on your phone — {count()} / {eng.players().length} voted</div>
      </Show>
      <Show when={phase() === "reveal"}>
        <div class="ph-list"><For each={ranked()}>{(o, i) => <div class="ph-quip-opt" classList={{ win: i() === 0 && o.v > 0 }}><span>{o.text}</span><span class="ph-bluff-owner">{name(o.owner)} · {o.v}</span></div>}</For></div>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— MOST LIKELY TO (vote a player)
function LikelyGame(props: { eng: Engine }) {
  const eng = props.eng;
  const prompts = shuffle(LIKELY_PROMPTS).slice(0, 3);
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"vote" | "reveal">("vote");
  const [count, setCount] = createSignal(0);
  const [result, setResult] = createSignal<{ name: string; votes: number }[]>([]);
  let voteList: Player[] = [];
  let votes = new Map<string, number>();
  const cd = useCountdown();
  const cur = () => prompts[ri()];

  const ask = () => {
    votes = new Map(); setCount(0); setResult([]); setPhase("vote");
    voteList = eng.players();
    eng.screen({ kind: "buttons", title: cur() + "?", sub: "Point the finger 👉", options: voteList.map((p) => p.name) });
    cd.start(20, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    const tally = new Map<string, number>();
    for (const [, idx] of votes) { const c = voteList[idx]; if (c) tally.set(c.id, (tally.get(c.id) ?? 0) + 1); }
    for (const [pid, n] of tally) eng.addScore(pid, n * 100);
    setResult(voteList.map((p) => ({ name: p.name, votes: tally.get(p.id) ?? 0 })).filter((r) => r.votes > 0).sort((a, b) => b.votes - a.votes));
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "Votes are in", msg: "Check the big screen 👀" });
    cd.start(7, () => { if (ri() < prompts.length - 1) { setRi(ri() + 1); ask(); } else eng.onEnd(); });
  };

  onMount(ask);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() !== "vote" || typeof v !== "number" || votes.has(id)) return;
    votes.set(id, v); setCount(votes.size);
    eng.screenTo(id, { kind: "wait", title: "Vote cast", msg: "Waiting for the others…" });
    if (eng.players().every((p) => votes.has(p.id))) reveal();
  });

  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {prompts.length} · Most Likely To</div>
      <div class="ph-question">{cur()}?</div>
      <Show when={phase() === "vote"}><div class="ph-hint">Vote on your phone — {count()} / {eng.players().length} voted</div></Show>
      <Show when={phase() === "reveal"}>
        <div class="ph-list">
          <For each={result()}>{(r, i) => <div class="ph-bluff-opt" classList={{ truth: i() === 0 }}><span class="ph-bluff-text">{i() === 0 ? "👑 " : ""}{r.name}</span><span class="ph-bluff-owner">{r.votes} vote{r.votes === 1 ? "" : "s"}</span></div>}</For>
        </div>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— POSE OFF (the console watches you)
// The one game where the phone isn't the controller — your body is. Each player
// takes a turn in front of the console's camera while their phone just says
// "you're up"; the console shows a pose to copy and scores the shape you make.
// Scoring is on JOINT ANGLES (see pose.ts), so height, distance and body size
// don't affect your score — only whether you actually made the shape.
function PoseGame(props: { eng: Engine }) {
  const eng = props.eng;
  const order = shuffle(eng.players());
  const targets = shuffle(POSES).slice(0, Math.max(3, Math.min(5, order.length + 1)));
  const [pi, setPi] = createSignal(0);          // whose turn
  const [ri, setRi] = createSignal(0);          // which pose
  const [phase, setPhase] = createSignal<"ready" | "hold" | "result" | "denied">("ready");
  const [live, setLive] = createSignal(0);      // live match %
  const [got, setGot] = createSignal(0);        // locked-in score
  const [err, setErr] = createSignal("");
  const cd = useCountdown();
  let cam: PoseCam | null = null;
  let raf = 0;
  let best = 0;
  let preview: HTMLVideoElement | undefined;

  const who = () => order[pi() % order.length];
  const target = () => targets[ri() % targets.length];

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const lm = cam?.landmarks();
    if (!lm || !poseVisible(lm)) { setLive(0); return }
    const s = scorePose(lm, target());
    setLive(s);
    // the round keeps your BEST instant, so a wobble on the way into the pose
    // doesn't cost you the shot
    if (phase() === "hold") best = Math.max(best, s);
  };

  const beginTurn = () => {
    best = 0; setGot(0); setLive(0); setPhase("ready");
    const p = who();
    eng.screen({ kind: "wait", title: `${p.name} is up`, msg: "Watch the big screen 👀" });
    eng.screenTo(p.id, { kind: "wait", title: "YOU'RE UP", msg: "Put the phone down and copy the pose!" });
    cd.start(4, () => { setPhase("hold"); cd.start(6, finish) });
  };

  const finish = () => {
    cd.stop();
    setGot(best);
    setPhase("result");
    const pts = pointsFor(best);
    if (pts) eng.addScore(who().id, pts);
    eng.screenTo(who().id, { kind: "wait", title: `${best}% match`, msg: pts ? `+${pts} points!` : "Not quite — next time!" });
    cd.start(4, () => {
      const nextP = pi() + 1;
      if (nextP >= order.length) { setPi(0); setRi(ri() + 1) } else setPi(nextP);
      if (ri() >= targets.length) { eng.onEnd(); return }
      beginTurn();
    });
  };

  onMount(async () => {
    try {
      cam = await startPoseCam();
      if (preview) { preview.srcObject = cam.video.srcObject; void preview.play().catch(() => {}) }
      raf = requestAnimationFrame(tick);
      beginTurn();
    } catch {
      // No camera, or the user said no. Say so plainly and hand the round back
      // rather than leaving the party staring at a dead screen.
      setPhase("denied");
      setErr("The console needs the camera for this one. Allow it and pick Pose Off again.");
      eng.screen({ kind: "wait", title: "Pose Off needs the camera", msg: "Ask the host to allow it" });
      cd.start(5, eng.onEnd);
    }
  });
  onCleanup(() => { cancelAnimationFrame(raf); cd.stop(); cam?.stop(); eng.setInput(null) });

  return (
    <div class="ph-stage pose-stage">
      <Show when={phase() !== "denied"} fallback={<div class="ph-question">{err()}</div>}>
        <div class="ph-timer">{cd.left()}s</div>
        <div class="ph-round">Pose {ri() + 1} / {targets.length} · {who()?.name}'s turn</div>
        <div class="ph-question">{target().name}</div>

        <div class="pose-row">
          <svg class="pose-figure" viewBox="0 0 100 100" aria-label={`${target().name} silhouette`}>
            <For each={target().figure}>
              {(seg) => (
                <polyline
                  points={seg.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
                  fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"
                />
              )}
            </For>
            <circle cx="50" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="5" />
          </svg>

          <div class="pose-cam">
            {/* mirrored, because a non-mirrored preview makes people move the wrong way */}
            <video ref={preview} class="pose-vid" autoplay playsinline muted />
            <div class="pose-meter" style={{ "--m": `${phase() === "result" ? got() : live()}%` }}>
              <span>{phase() === "result" ? got() : live()}%</span>
            </div>
          </div>
        </div>

        <Show when={phase() === "ready"}><div class="ph-hint">Get ready — strike the pose when the timer turns</div></Show>
        <Show when={phase() === "hold"}><div class="ph-hint pose-hold">HOLD IT!</div></Show>
        <Show when={phase() === "result"}>
          <div class="ph-hint">{got() >= 80 ? "Perfect!" : got() >= 55 ? "Close enough!" : got() >= 40 ? "We'll allow it." : "…that was something."} {pointsFor(got()) ? `+${pointsFor(got())}` : ""}</div>
        </Show>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— STORY BUILDER (blind lines, for laughs)
function StoryGame(props: { eng: Engine }) {
  const eng = props.eng;
  const themes = shuffle(STORY_THEMES).slice(0, 2);
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"write" | "reveal">("write");
  const [count, setCount] = createSignal(0);
  const [story, setStory] = createSignal<{ name: string; color: string; line: string }[]>([]);
  let lines = new Map<string, string>();
  const cd = useCountdown();
  const cur = () => themes[ri()];

  const ask = () => {
    lines = new Map(); setCount(0); setStory([]); setPhase("write");
    eng.screen({ kind: "text", title: "Write ONE line of the story", sub: `Theme: ${cur()} — and no peeking, nobody sees yours!`, placeholder: "once upon a time…", max: 80 });
    cd.start(40, reveal);
  };
  const reveal = () => {
    cd.stop(); setPhase("reveal");
    setStory(eng.players().filter((p) => lines.has(p.id)).map((p) => ({ name: p.name, color: p.color, line: lines.get(p.id)! })));
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "The story is told 📖", msg: "Check the big screen 👀" });
    cd.start(9, () => { if (ri() < themes.length - 1) { setRi(ri() + 1); ask(); } else eng.onEnd(); });
  };

  onMount(ask);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    if (phase() !== "write" || typeof v !== "string") return;
    const t = v.trim().slice(0, 80); if (!t) return;
    lines.set(id, t); setCount(lines.size);
    eng.screenTo(id, { kind: "wait", title: "Line submitted ✍️", msg: "Waiting for the others…" });
    if (eng.players().every((p) => lines.has(p.id))) reveal();
  });

  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {themes.length} · Story Builder</div>
      <div class="ph-question">{cur()}</div>
      <Show when={phase() === "write"}><div class="ph-hint">Writing blind lines… {count()} / {eng.players().length} in</div></Show>
      <Show when={phase() === "reveal"}>
        <div class="ph-story"><For each={story()}>{(s) => <p class="ph-story-line"><i style={{ background: s.color }} /><b>{s.name}:</b> {s.line}</p>}</For></div>
        <div class="ph-hint">…the end. 📖</div>
      </Show>
    </div>
  );
}

// ————————————————————————————————————————————— CELEBRITY (crowd-sourced + Wikipedia photos)
// Never goes stale: each round the NON-guessers type a real person (anyone —
// star, athlete, influencer), the group VOTES which to use, the host fetches
// that person's Wikipedia photo, and the hint-givers describe them (name + photo
// on their phones only) while the rotating guesser races to name them. The
// target never touches the host screen during play (the guesser watches it).
function CelebGame(props: { eng: Engine }) {
  const eng = props.eng;
  const total = Math.min(Math.max(eng.players().length, 2), 4);
  const [ri, setRi] = createSignal(0);
  const [phase, setPhase] = createSignal<"suggest" | "vote" | "loading" | "play" | "reveal">("suggest");
  const [guesser, setGuesser] = createSignal("");
  const [submitted, setSubmitted] = createSignal(0);
  const [voted, setVoted] = createSignal(0);
  const [hints, setHints] = createSignal<{ name: string; color: string; text: string }[]>([]);
  const [solved, setSolved] = createSignal(false);
  const [photo, setPhoto] = createSignal("");
  const [revealName, setRevealName] = createSignal("");
  let guesserId = "", order = 0, done = false;
  let targetName = "", targetTitle = "", credit = "";
  let voteOpts: string[] = [];
  let suggestions = new Map<string, string>();
  let votes = new Map<string, number>();
  const cd = useCountdown();
  const nonGuessers = () => eng.players().filter((p) => p.id !== guesserId);

  const startRound = () => {
    const ps = eng.players();
    if (ps.length < 3) { eng.onEnd(); return; } // need a guesser + at least 2 to suggest/vote
    suggestions = new Map(); votes = new Map(); voteOpts = [];
    setSubmitted(0); setVoted(0); setHints([]); setSolved(false); setPhoto(""); done = false;
    // a bot guessing wastes the round — humans take the guesser seat
    const humans = ps.filter((p) => !p.id.startsWith("bot-"));
    const gpool = humans.length ? humans : ps;
    guesserId = gpool[order % gpool.length].id; order++;
    const gname = ps.find((p) => p.id === guesserId)?.name ?? "?";
    setGuesser(gname); setPhase("suggest");
    for (const p of ps) {
      if (p.id === guesserId) eng.screenTo(p.id, { kind: "wait", title: "You're guessing! 🕵️", msg: "The others are secretly picking someone for you…" });
      else eng.screenTo(p.id, { kind: "text", title: `Name someone for ${gname} to guess`, sub: "Anyone famous — actor, athlete, musician, influencer…", placeholder: "a famous name", max: 40 });
    }
    cd.start(30, toVote);
  };

  const toVote = () => {
    cd.stop(); votes = new Map(); setVoted(0);
    const uniq = [...new Set([...suggestions.values()].map((s) => s.trim()).filter(Boolean))];
    voteOpts = uniq.length ? shuffle(uniq) : [shuffle(CELEBRITIES)[0]]; // fallback if nobody typed one
    if (voteOpts.length === 1) { resolveVote(); return; } // no vote needed
    setPhase("vote");
    for (const p of nonGuessers()) eng.screenTo(p.id, { kind: "buttons", title: `Who should ${guesser()} guess?`, options: voteOpts });
    eng.screenTo(guesserId, { kind: "wait", title: "Almost ready…", msg: "The others are voting on your mystery person." });
    cd.start(20, resolveVote);
  };

  const resolveVote = async () => {
    cd.stop();
    let win = voteOpts[0];
    if (votes.size) {
      const tally = new Map<string, number>();
      for (const [, idx] of votes) { const o = voteOpts[idx]; if (o) tally.set(o, (tally.get(o) ?? 0) + 1); }
      let max = 0; for (const [o, n] of tally) if (n > max) { max = n; win = o; }
    }
    setPhase("loading");
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: "Finding them… 🔎", msg: "" });
    let page = null;
    try { page = await wikiPerson(win); } catch { /* no photo */ }
    targetName = win;
    targetTitle = page?.title ?? win;
    credit = page ? "📷 via Wikipedia" : "";
    setPhoto(page?.thumb ?? ""); setRevealName(targetTitle);
    startPlay();
  };

  const startPlay = () => {
    setPhase("play"); setHints([]); done = false; setSolved(false);
    for (const p of eng.players()) {
      if (p.id === guesserId) eng.screenTo(p.id, { kind: "hintguess", title: "Guess who! 🕵️", placeholder: "your guess", max: 40 });
      else eng.screenTo(p.id, { kind: "describe", title: "Describe this person", name: targetTitle, photo: photo(), credit, sub: "Type hints — don't say (or spell) the name!", placeholder: "a hint…", max: 40 });
    }
    cd.start(75, endRound);
  };

  const endRound = () => {
    cd.stop(); setPhase("reveal");
    for (const p of eng.players()) eng.screenTo(p.id, { kind: "wait", title: solved() ? "Got it! 🎉" : "Time's up", msg: `It was ${targetTitle}` });
    cd.start(7, () => { if (ri() < total - 1) { setRi(ri() + 1); startRound(); } else eng.onEnd(); });
  };

  const matches = (g: string) => {
    const n = norm(g); if (n.length < 2) return false;
    for (const c of [targetTitle, targetName]) { const cn = norm(c); if (cn && (cn === n || (n.length >= 4 && cn.includes(n)))) return true; }
    return false;
  };

  onMount(startRound);
  onCleanup(() => eng.setInput(null));
  eng.setInput((id, v) => {
    const ph = phase();
    if (ph === "suggest" && id !== guesserId && typeof v === "string") {
      const name = v.trim().slice(0, 40); if (!name) return;
      suggestions.set(id, name); setSubmitted(suggestions.size);
      eng.screenTo(id, { kind: "wait", title: "Locked in ✓", msg: "Waiting for the others…" });
      if (nonGuessers().every((p) => suggestions.has(p.id))) toVote();
    } else if (ph === "vote" && id !== guesserId && typeof v === "number") {
      if (votes.has(id)) return;
      votes.set(id, v); setVoted(votes.size);
      eng.screenTo(id, { kind: "wait", title: "Vote cast", msg: "Waiting for the others…" });
      if (nonGuessers().every((p) => votes.has(p.id))) resolveVote();
    } else if (ph === "play" && typeof v === "string") {
      const t = v.trim(); if (!t) return;
      if (id === guesserId) {
        if (done) return;
        if (matches(t)) {
          done = true; setSolved(true);
          eng.addScore(guesserId, 400);
          for (const p of nonGuessers()) eng.addScore(p.id, 150);
          endRound();
        }
      } else {
        const clue = t.slice(0, 40);
        if (matches(clue) || norm(clue).includes(norm(targetTitle)) || norm(targetTitle).includes(norm(clue))) { eng.rawTo(id, { t: "hint", text: "⚠️ too close to the name — rephrase" }); return; }
        const p = eng.players().find((x) => x.id === id);
        setHints((h) => [...h, { name: p?.name ?? "?", color: p?.color ?? "#8aa", text: clue }]);
        eng.rawTo(guesserId, { t: "hint", text: clue });
      }
    }
  });

  return (
    <div class="ph-stage">
      <div class="ph-timer">{cd.left()}s</div>
      <div class="ph-round">Round {ri() + 1} / {total} · <b>{guesser()}</b> is guessing</div>
      <Show when={phase() === "suggest"}>
        <div class="ph-question">Everyone else: pick a mystery person 🤫</div>
        <div class="ph-hint">Type a famous name on your phone — {submitted()} / {Math.max(0, eng.players().length - 1)} in. (Hidden from {guesser()}!)</div>
      </Show>
      <Show when={phase() === "vote"}>
        <div class="ph-question">Voting on who {guesser()} will guess…</div>
        <div class="ph-hint">{voted()} / {Math.max(0, eng.players().length - 1)} voted — options are on your phones (not shown here).</div>
      </Show>
      <Show when={phase() === "loading"}><div class="ph-question">🔎 Finding them on Wikipedia…</div></Show>
      <Show when={phase() === "play"}>
        <div class="ph-list ph-hintlist">
          <Show when={hints().length} fallback={<div class="ph-hint">Hint-givers: describe them on your phone — clues appear here and on {guesser()}'s phone.</div>}>
            <For each={hints()}>{(h) => <div class="ph-bluff-opt"><span class="ph-bluff-text">{h.text}</span><span class="ph-bluff-owner">{h.name}</span></div>}</For>
          </Show>
        </div>
      </Show>
      <Show when={phase() === "reveal"}>
        <div class="ph-cham-result" classList={{ caught: solved() }}>{solved() ? "Guessed it! 🎉" : "Time's up"}</div>
        <div class="ph-celeb-reveal">
          <Show when={photo()}><img class="ph-celeb-photo" src={photo()} alt={revealName()} referrerpolicy="no-referrer" /></Show>
          <div class="ph-question">{revealName()}</div>
          <Show when={credit}><div class="ph-hint">📷 via Wikipedia</div></Show>
        </div>
      </Show>
    </div>
  );
}

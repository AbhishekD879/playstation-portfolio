// Trivia arcade — 10 questions from the Open Trivia DB, quiz-show style.
import { For, Show, createSignal, onMount } from "solid-js";
import { fetchTrivia, type TriviaQ } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";

export default function Trivia(props: {
  onScore: (score: number) => void;
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const [qs, setQs] = createSignal<TriviaQ[] | null>(null);
  const [i, setI] = createSignal(0);
  const [sel, setSel] = createSignal(0);
  const [reveal, setReveal] = createSignal(false);
  const [score, setScore] = createSignal(0);
  const [done, setDone] = createSignal(false);

  onMount(() => { fetchTrivia().then(setQs).catch(() => setQs([])); });

  function answer() {
    if (reveal()) {
      // advance
      setReveal(false);
      setSel(0);
      if (i() + 1 >= (qs()?.length ?? 0)) {
        setDone(true);
        props.onScore(score());
      } else setI(i() + 1);
      return;
    }
    setReveal(true);
    if (sel() === qs()![i()].correct) { setScore(score() + 1); sfx.confirm(); }
    else sfx.deny();
  }

  props.bind((a) => {
    if (done() || !qs()?.length) {
      if (a === "back" || a === "confirm") { sfx.back(); props.onClose(); }
      return;
    }
    if (a === "up" && !reveal()) { setSel((sel() + 3) % 4); sfx.tickV(); }
    if (a === "down" && !reveal()) { setSel((sel() + 1) % 4); sfx.tickV(); }
    if (a === "confirm") answer();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="trivia">
      <Show when={qs()} fallback={<div class="guide-loading">Warming up the host…</div>}>
        <Show
          when={!done() && qs()!.length}
          fallback={
            <div class="trivia-end">
              <div class="panel-tag">FINAL SCORE</div>
              <div class="trivia-score">{score()} / {qs()!.length}</div>
              <div class="trivia-verdict">
                {score() >= 8 ? "Quizmaster. Trophy earned." : score() >= 5 ? "Respectable." : "The buzzer was broken, surely."}
              </div>
              <div class="panel-hint guide-hint"><span class="btn-x" /> done</div>
            </div>
          }
        >
          <div class="panel-tag">TRIVIA ARCADE — {qs()![i()].category.toUpperCase()} · {i() + 1}/{qs()!.length} · SCORE {score()}</div>
          <div class="trivia-q">{qs()![i()].q}</div>
          <div class="trivia-answers">
            <For each={qs()![i()].answers}>
              {(ans, j) => (
                <div
                  class="trivia-a"
                  classList={{
                    selected: j() === sel() && !reveal(),
                    right: reveal() && j() === qs()![i()].correct,
                    wrong: reveal() && j() === sel() && j() !== qs()![i()].correct,
                  }}
                  onClick={() => { if (!reveal()) { setSel(j()); answer(); } else answer(); }}
                >
                  {ans}
                </div>
              )}
            </For>
          </div>
          <div class="panel-hint guide-hint">
            ↑↓ choose · <span class="btn-x" /> {reveal() ? "next" : "lock it in"} · <span class="btn-o" /> quit
          </div>
        </Show>
      </Show>
    </div>
  );
}

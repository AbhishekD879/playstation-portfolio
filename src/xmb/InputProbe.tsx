import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

// Live input readout for the PS2 app.
//
// Exists because "player one doesn't work" was debugged four times by guessing.
// It reads ONLY — no listeners on the game's input path, nothing dispatched —
// so it cannot itself affect what it measures. It answers, at a glance:
//
//   does the browser see a pad?  are its buttons registering?
//   is a key reaching the page?  who currently holds focus?
//
// Toggle with the on-screen chip, or ?probe=1 to have it open on load.

export default function InputProbe() {
  const [open, setOpen] = createSignal(new URLSearchParams(location.search).has("probe"));
  const [pads, setPads] = createSignal<{ index: number; id: string; pressed: number[] }[]>([]);
  const [lastKey, setLastKey] = createSignal("—");
  const [focus, setFocus] = createSignal("—");

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!open()) return;
    setPads(
      [...(navigator.getGamepads?.() ?? [])]
        .filter((p): p is Gamepad => !!p)
        .map((p) => ({
          index: p.index,
          id: p.id.slice(0, 28),
          pressed: p.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0),
        })),
    );
    const a = document.activeElement;
    setFocus(a ? `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}` : "none");
  };

  // Capture phase, passive, never preventDefault: observes without consuming.
  const onKey = (e: KeyboardEvent) => setLastKey(`${e.key} (${e.code})`);

  onMount(() => {
    raf = requestAnimationFrame(tick);
    addEventListener("keydown", onKey, { capture: true, passive: true });
  });
  onCleanup(() => {
    cancelAnimationFrame(raf);
    removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  });

  return (
    <div class="probe" classList={{ open: open() }}>
      <button class="probe-chip" onClick={() => setOpen((v) => !v)}>
        {open() ? "hide input" : "input?"}
      </button>
      <Show when={open()}>
        <div class="probe-body">
          <div class="probe-row">
            <span class="probe-k">gamepads</span>
            <span class="probe-v">{pads().length === 0 ? "none seen — press a button on it" : `${pads().length}`}</span>
          </div>
          <For each={pads()}>
            {(p) => (
              <div class="probe-row">
                <span class="probe-k">#{p.index}</span>
                <span class="probe-v">
                  {p.id}
                  {p.pressed.length > 0 && <b> ← {p.pressed.join(" ")}</b>}
                </span>
              </div>
            )}
          </For>
          <div class="probe-row">
            <span class="probe-k">last key</span>
            <span class="probe-v">
              {lastKey()}
              {/* Once the iframe holds focus, keydown never reaches this
                  document — the game is receiving it instead. Blank here with
                  focus=iframe is CORRECT, so say so rather than look broken. */}
              <Show when={lastKey() === "—" && focus() === "iframe"}>
                <b> (keys are going to the game — correct)</b>
              </Show>
            </span>
          </div>
          <div class="probe-row">
            <span class="probe-k">focus</span>
            <span class="probe-v">
              {focus()}
              <Show when={focus() !== "iframe"}><b class="bad"> ← not the game; click the picture</b></Show>
            </span>
          </div>
          <p class="probe-hint">
            <b>Controller:</b> press any button — its number should light up next to the pad name.
            Nothing listed at all means the browser cannot see it, which is not something the
            console controls. <b>Focus</b> must read <i>iframe</i>, or nothing reaches the game.
          </p>
        </div>
      </Show>
    </div>
  );
}

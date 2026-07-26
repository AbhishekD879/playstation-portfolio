// The Horizon shell for a search-and-browse app.
//
// Six apps — Art Gallery, Archive Cinema, Flash Arcade, Library, Podcasts and
// YouTube — each drew their own header, their own search box and their own
// hint line. They already shared TileGrid; it was only the chrome around it
// that had been rebuilt six times, in six sizes, with the count in a different
// corner each time. This is that chrome, once.
//
// Everything per-app lives in props: the app supplies a fetcher and a grid and
// nothing else. Layout is a grid template rather than stacked margins, and the
// Control Center is the same bar the shelves use, so leaving works the same way
// everywhere.
import { Show } from "solid-js";
import * as sfx from "../audio";

export default function HzScreen(props: {
  /** eyebrow — what this app is, e.g. "Art Gallery · the Met, New York" */
  kick: string;
  /** the search field. Omitted for screens that don't search. */
  search?: {
    value: string;
    placeholder: string;
    onInput: (v: string) => void;
    onEnter?: () => void;
    ref?: (el: HTMLInputElement) => void;
  };
  /** right-hand readout, e.g. "21 works" */
  count?: string;
  /** Control Center label: the bold line names the buttons that do something */
  hints: string;
  sub?: string;
  onClose: () => void;
  children: any;
}) {
  // The console's own shortcuts, so the bar's icons do real things rather than
  // decorate: / opens search, ` opens the full Control Center overlay.
  const tap = (key: string) => dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  let field: HTMLInputElement | undefined;

  return (
    <div class="hz hz-browse">
      <div class="hz-scrim" />
      <div class="hz-lay">
        <div class="hz-top">
          <span class="who"><span class="av" />{props.kick}</span>
          <span class="sp">{props.count ?? ""}</span>
        </div>

        <Show when={props.search}>
          <div class="hz-head">
            <label class="hz-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" />
              </svg>
              <input
                ref={(el) => { field = el; props.search!.ref?.(el); }}
                value={props.search!.value}
                placeholder={props.search!.placeholder}
                aria-label={props.search!.placeholder}
                onInput={(e) => props.search!.onInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // the crossbar owns these keys globally; inside a field they
                  // belong to the field
                  e.stopPropagation();
                  if (e.key === "Enter") { e.preventDefault(); props.search!.onEnter?.(); }
                  if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.blur(); }
                  if (e.key === "Escape") { sfx.back(); props.onClose(); }
                }}
              />
            </label>
          </div>
        </Show>

        <div class="hz-body">{props.children}</div>

        <div class="hz-cc">
          <button class="hz-cc-i on" title="Home" onClick={() => { sfx.back(); props.onClose(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 10.5 12 4l8 6.5V20H4z" /></svg>
          </button>
          <Show when={props.search}>
            <button class="hz-cc-i" title="Search" onClick={() => field?.focus()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
            </button>
          </Show>
          <button class="hz-cc-i" title="Control Center" onClick={() => tap("`")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3.1" /><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" /></svg>
          </button>
          <div class="hz-cc-lbl"><b>{props.hints}</b>{props.sub ?? ""}</div>
        </div>
      </div>
    </div>
  );
}

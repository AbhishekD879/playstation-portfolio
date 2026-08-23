// Ren'Py host (experimental) — plays a Ren'Py WEB build: self-contained HTML5 +
// CPython/SDL WASM with all-relative paths, so RpgPlayer just points a sandboxed
// iframe at it, served from OPFS by the /rpgm/renpy/ service-worker route.
//
// Two kinds of game arrive here. One was exported for the web by its author. The
// other was a desktop build that the importer converted, by pairing its game/
// tree with the official WebAssembly engine for its Ren'Py version (see
// src/renpyConvert.ts). A converted build can carry caveats the player should
// read before starting — chiefly that .rpa archives and video have to live in
// memory — so they are surfaced here rather than buried in a log.
import { createResource, Show } from "solid-js";
import type { NavAction } from "../input";
import { labEnabled } from "../labs";
import { renpyNotes, type RpgGame } from "../rpgm";
import RpgPlayer from "./RpgPlayer";

export default function RpgRenPy(props: { game: RpgGame; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [notes] = createResource(() => props.game.id, renpyNotes);
  return (
    <>
      <Show when={(notes() ?? []).length > 0}>
        <div class="rpg-renpy-notes">
          <b>Converted from a desktop build.</b>
          <ul>{(notes() ?? []).map((n) => <li>{n}</li>)}</ul>
        </div>
      </Show>
      <RpgPlayer
        game={props.game}
        // The engine's own error banner is suppressed unless asked for. Passed in
        // the URL because the service worker injects the shim that acts on it and
        // cannot read the app's settings itself.
        src={`/rpgm/renpy/${props.game.id}/${props.game.entry || "index.html"}${labEnabled("engineerrors") ? "?engineErrors=1" : ""}`}
        sublabel="Ren'Py · experimental"
        bootNote="first run unpacks the Ren'Py engine"
        onClose={props.onClose}
        bind={props.bind}
      />
    </>
  );
}

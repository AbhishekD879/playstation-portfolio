// Ren'Py host (experimental) — plays a Ren'Py WEB build (exported from the
// Ren'Py launcher's "Web" build). It's self-contained HTML5 + CPython/SDL WASM
// with all-relative paths, so RpgPlayer just points a sandboxed iframe at it,
// served from OPFS by the /rpgm/renpy/ service-worker route. Desktop Ren'Py
// builds can't run in a browser (see rpgm.ts detect) and never reach here.
import type { NavAction } from "../input";
import type { RpgGame } from "../rpgm";
import RpgPlayer from "./RpgPlayer";

export default function RpgRenPy(props: { game: RpgGame; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  return (
    <RpgPlayer
      game={props.game}
      src={`/rpgm/renpy/${props.game.id}/${props.game.entry || "index.html"}`}
      sublabel="Ren'Py · experimental"
      bootNote="first run downloads the ~35 MB Ren'Py engine"
      onClose={props.onClose}
      bind={props.bind}
    />
  );
}

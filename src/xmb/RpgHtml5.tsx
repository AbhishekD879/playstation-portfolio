// MV / MZ player — RPG Maker's modern HTML5 output runs natively (PixiJS), so
// this is not emulation. The extracted game lives in OPFS; the scoped /rpgm/
// service worker serves it at a real same-origin URL, which RpgPlayer points a
// sandboxed iframe at. PixiJS's XHR/fetch resource loading then Just Works.
import type { NavAction } from "../input";
import type { RpgGame } from "../rpgm";
import RpgPlayer from "./RpgPlayer";

export default function RpgHtml5(props: { game: RpgGame; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  return (
    <RpgPlayer
      game={props.game}
      src={`/rpgm/fs/${props.game.id}/${props.game.entry || "index.html"}`}
      onClose={props.onClose}
      bind={props.bind}
    />
  );
}

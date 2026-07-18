// Web-game host — plays a game the user already exported "for web": a Godot
// HTML5 export, a Unity WebGL build, a Wolf RPG "Browser-Woditor" build, or any
// plain HTML5/WebGL game. There is NO emulation: the browser runs these
// natively. RpgPlayer just points a sandboxed iframe at the build, served from
// OPFS by the /rpgm/web/ service-worker route (which adds cross-origin-isolation
// headers, so threaded Godot 4 / Unity builds get SharedArrayBuffer). Desktop
// binaries can't run here and are never routed to this host (see rpgm.ts detect).
import type { NavAction } from "../input";
import { ENGINE_LABEL, type RpgGame } from "../rpgm";
import RpgPlayer from "./RpgPlayer";

export default function RpgWeb(props: { game: RpgGame; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  return (
    <RpgPlayer
      game={props.game}
      src={`/rpgm/web/${props.game.id}/${props.game.entry || "index.html"}`}
      sublabel={ENGINE_LABEL[props.game.engine]}
      bootNote="loads the game's own engine — keyboard, mouse & gamepad supported"
      onClose={props.onClose}
      bind={props.bind}
    />
  );
}

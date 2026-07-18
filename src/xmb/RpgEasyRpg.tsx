// EasyRPG host — RPG Maker 2000/2003. We self-host the EasyRPG Player
// (Emscripten/WASM) under /rpgm/easyrpg/, so its game fetches resolve to
// /rpgm/easyrpg/games/<id>/* — which our service worker serves out of OPFS
// (the game's files + a generated index.json manifest, with the bundled
// CC-BY RTP filling any gaps). RpgPlayer runs it in a sandboxed iframe.
import type { NavAction } from "../input";
import type { RpgGame } from "../rpgm";
import RpgPlayer from "./RpgPlayer";

export default function RpgEasyRpg(props: { game: RpgGame; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  return (
    <RpgPlayer
      game={props.game}
      src={`/rpgm/easyrpg/play.html?game=${props.game.id}`}
      sublabel="EasyRPG"
      bootNote="first run downloads the ~9 MB engine"
      onClose={props.onClose}
      bind={props.bind}
    />
  );
}

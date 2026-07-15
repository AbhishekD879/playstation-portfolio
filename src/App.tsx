import { Match, Show, Switch, createSignal } from "solid-js";
import Boot from "./boot/Boot";
import ProfileSelect from "./profileSelect";
import Wave from "./xmb/Wave";
import XMB from "./xmb/XMB";
import GameSession from "./emulator/GameSession";
import { loadProfiles, type Profile } from "./profiles";
import type { GameRecord } from "./gamesdb";

type Stage = "boot" | "profiles" | "xmb";

export default function App() {
  // ejecting a disc restarts the console — resume straight to the XMB
  const resumeId = sessionStorage.getItem("asp.resume");
  const resumed = resumeId ? loadProfiles().find((p) => p.id === resumeId) : undefined;
  sessionStorage.removeItem("asp.resume");

  const [stage, setStage] = createSignal<Stage>(resumed ? "xmb" : "boot");
  const [profile, setProfile] = createSignal<Profile | null>(resumed ?? null);
  const [session, setSession] = createSignal<GameRecord | null>(null);

  return (
    <>
      <Switch>
        <Match when={stage() === "boot"}>
          <Boot onDone={() => setStage("profiles")} />
        </Match>
        <Match when={stage() === "profiles"}>
          <Wave />
          <ProfileSelect
            onSelect={(p) => {
              setProfile(p);
              setStage("xmb");
            }}
          />
        </Match>
        <Match when={stage() === "xmb" && profile()}>
          <Wave />
          <XMB
            profile={profile()!}
            onSwitchUser={() => setStage("profiles")}
            onPlay={(g) => setSession(g)}
          />
        </Match>
      </Switch>
      <Show when={session()}>
        <GameSession game={session()!} profileId={profile()!.id} />
      </Show>
    </>
  );
}

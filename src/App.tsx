import { Match, Show, Switch, createSignal } from "solid-js";
import Boot from "./boot/Boot";
import ProfileSelect from "./profileSelect";
import Wave from "./xmb/Wave";
import XMB from "./xmb/XMB";
import Osk from "./xmb/Osk";
import GameSession from "./emulator/GameSession";
import { createProfile, loadProfiles, updateProfile, type Profile } from "./profiles";
import type { GameRecord } from "./gamesdb";

type Stage = "boot" | "profiles" | "xmb";

// no forced "who's playing?" — sign in as the most recent profile,
// creating PLAYER 1 on a first visit. The picker stays under Users → Switch User.
function defaultProfile(): Profile {
  const all = loadProfiles();
  const p = all.length ? all.reduce((a, b) => (b.lastLogin > a.lastLogin ? b : a)) : createProfile("PLAYER 1", 0);
  p.lastLogin = Date.now();
  updateProfile(p);
  return p;
}

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
          <Boot onDone={() => { setProfile(defaultProfile()); setStage("xmb"); }} />
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
      {/* controller users get the PS on-screen keyboard on any text field */}
      <Osk />
    </>
  );
}

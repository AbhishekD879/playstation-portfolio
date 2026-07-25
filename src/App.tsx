import { Match, Show, Switch, createSignal } from "solid-js";
import Boot from "./boot/Boot";
import ProfileSelect from "./profileSelect";
import Wave from "./xmb/Wave";
import XMB from "./xmb/XMB";
import Osk from "./xmb/Osk";
import MobileNudge from "./xmb/MobileNudge";
import PhonePad from "./xmb/PhonePad";
import PartyController from "./xmb/PartyController";
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
  // ?pad=CODE → this device IS a controller (opened by scanning the console's
  // QR). Render only the touch pad — no boot, no wave, no XMB.
  const padRoom = new URLSearchParams(location.search).get("pad");
  if (padRoom && /^[A-Za-z0-9]{1,8}$/.test(padRoom)) {
    return <PhonePad room={padRoom.toUpperCase()} />;
  }

  // ?party=CODE → this device is a party-game controller (scanned the QR on the
  // host's screen). Render only the controller — no boot, no wave, no XMB.
  const partyRoom = new URLSearchParams(location.search).get("party");
  if (partyRoom && /^[A-Za-z0-9]{1,8}$/.test(partyRoom)) {
    return <PartyController room={partyRoom.toUpperCase()} />;
  }

  // ejecting a disc restarts the console — resume straight to the XMB
  const resumeId = sessionStorage.getItem("asp.resume");
  const resumed = resumeId ? loadProfiles().find((p) => p.id === resumeId) : undefined;
  sessionStorage.removeItem("asp.resume");

  // a ?watch=CODE invite link → open the Watch Party app (which auto-joins that
  // room from the query). Add the app hash so the router opens it, keeping ?watch.
  if (/[?&]watch=[A-Za-z0-9]{3,8}/.test(location.search) && !/^#\/app\//.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search + "#/app/watch");
  }
  // a ?board=CODE invite link → open Board Games (it auto-joins that room)
  if (/[?&]board=[A-Za-z0-9]{1,8}/.test(location.search) && !/^#\/app\//.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search + "#/app/board");
  }
  // a ?tv=CODE link → Console TV, tuned to that room. Deliberately NOT ?watch=,
  // which already belongs to the YouTube watch party.
  if (/[?&]tv=[A-Za-z0-9]{1,8}/.test(location.search) && !/^#\/app\//.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search + "#/app/consoletv");
  }
  // deep link into an app (#/app/<id>) → skip the boot animation and land in the
  // app immediately, so a refresh doesn't replay the intro just to get back.
  const deepLinkApp = /^#\/app\/[a-z0-9-]+/i.test(location.hash);
  const initialProfile = resumed ?? (deepLinkApp ? defaultProfile() : null);

  const [stage, setStage] = createSignal<Stage>(initialProfile ? "xmb" : "boot");
  const [profile, setProfile] = createSignal<Profile | null>(initialProfile);
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
      {/* phone visitors (the WhatsApp crowd) get a one-time nudge to desktop */}
      <MobileNudge />
    </>
  );
}

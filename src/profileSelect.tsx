// PS3-style user select: a row of avatar tiles + Create New User.
import { For, Show, createSignal, onMount } from "solid-js";
import { AVATARS, createProfile, loadProfiles, type Profile } from "./profiles";
import * as sfx from "./audio";
import { onNav, setNavEnabled } from "./input";

export default function ProfileSelect(props: { onSelect: (p: Profile, isNew: boolean) => void }) {
  const [profiles, setProfiles] = createSignal<Profile[]>(loadProfiles());
  const [idx, setIdx] = createSignal(0);
  const [creating, setCreating] = createSignal(false);
  const [avatar, setAvatar] = createSignal(0);
  let nameInput!: HTMLInputElement;

  const tiles = () => [...profiles(), null]; // null = "new user" tile

  function choose() {
    const t = tiles()[idx()];
    if (t === null || t === undefined) {
      sfx.confirm();
      setCreating(true);
      setAvatar(Math.floor(Math.random() * AVATARS.length));
      setTimeout(() => { setNavEnabled(false); nameInput.focus(); }, 50);
    } else {
      sfx.confirm();
      t.lastLogin = Date.now();
      props.onSelect(t, false);
    }
  }

  function submitNew() {
    const name = nameInput.value.trim();
    if (!name) { sfx.deny(); return; }
    const p = createProfile(name, avatar());
    setNavEnabled(true);
    props.onSelect(p, true);
  }

  onNav((a) => {
    if (creating()) {
      if (a === "back") { sfx.back(); setNavEnabled(true); setCreating(false); }
      if (a === "left") { setAvatar((avatar() + AVATARS.length - 1) % AVATARS.length); sfx.tickH(); }
      if (a === "right") { setAvatar((avatar() + 1) % AVATARS.length); sfx.tickH(); }
      if (a === "confirm") submitNew();
      return;
    }
    if (a === "left" && idx() > 0) { setIdx(idx() - 1); sfx.tickH(); }
    if (a === "right" && idx() < tiles().length - 1) { setIdx(idx() + 1); sfx.tickH(); }
    if (a === "confirm") choose();
  });

  onMount(() => setProfiles(loadProfiles()));

  return (
    <div class="pselect">
      <div class="pselect-title">Who's playing?</div>
      <Show
        when={!creating()}
        fallback={
          <div class="pcreate">
            <div class="pcreate-avatar" style={{ background: AVATARS[avatar()].bg }}>{AVATARS[avatar()].glyph}</div>
            <div class="pcreate-arrows">◀ &nbsp;choose avatar&nbsp; ▶</div>
            <input
              ref={nameInput}
              class="pcreate-name"
              maxLength={16}
              placeholder="ENTER NAME"
              onFocus={() => setNavEnabled(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
                if (e.key === "Escape") { setNavEnabled(true); setCreating(false); }
                if (e.key === "ArrowLeft" && !e.currentTarget.value) { setAvatar((avatar() + AVATARS.length - 1) % AVATARS.length); sfx.tickH(); }
                if (e.key === "ArrowRight" && !e.currentTarget.value) { setAvatar((avatar() + 1) % AVATARS.length); sfx.tickH(); }
              }}
            />
            <div class="pselect-hint">ENTER — create · ESC — back</div>
          </div>
        }
      >
        <div class="pselect-row">
          <For each={tiles()}>
            {(p, i) => (
              <div
                class="ptile"
                classList={{ active: i() === idx() }}
                onClick={() => { setIdx(i()); choose(); }}
              >
                <Show
                  when={p}
                  fallback={<><div class="ptile-avatar new">＋</div><div class="ptile-name">New User</div></>}
                >
                  <Show
                    when={p!.avatarImg}
                    fallback={<div class="ptile-avatar" style={{ background: AVATARS[p!.avatar]?.bg }}>{AVATARS[p!.avatar]?.glyph}</div>}
                  >
                    <img class="ptile-avatar" src={p!.avatarImg} alt="" />
                  </Show>
                  <div class="ptile-name">{p!.name}</div>
                  <div class="ptile-meta">🏆 {Object.keys(p!.trophies).length}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="pselect-hint">←→ choose · ENTER select · profiles live in this browser only</div>
      </Show>
    </div>
  );
}

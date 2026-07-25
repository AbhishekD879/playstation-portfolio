// Console Analytics — ask the console questions about itself.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { PRESETS, SCHEMA, closeAnalytics, openAnalytics, runQuery, type QueryResult } from "../analytics";
import { listGames } from "../gamesdb";
import { setNavEnabled } from "../input";
import { Icon } from "./icons";
import * as sfx from "../audio";

export default function Analytics(props: { onClose: () => void; profileId: string; profileName: string; playtime: number; trophies: number }) {
  const [ready, setReady] = createSignal(false);
  const [err, setErr] = createSignal("");
  const [sql, setSql] = createSignal(PRESETS[0].sql);
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [busy, setBusy] = createSignal(false);
  let conn: Awaited<ReturnType<typeof openAnalytics>> | null = null;

  const run = async (q: string) => {
    if (!conn || busy()) return;
    setSql(q); setBusy(true); setErr("");
    try {
      setResult(await runQuery(conn, q));
    } catch (e) {
      // DuckDB's messages are genuinely good — show them rather than "error"
      setErr(String((e as Error)?.message ?? e).replace(/^Error:\s*/, ""));
      setResult(null);
    } finally { setBusy(false) }
  };

  onMount(async () => {
    setNavEnabled(true);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() };
    addEventListener("keydown", esc);
    onCleanup(() => { removeEventListener("keydown", esc); void closeAnalytics() });

    try {
      const commits = (await import("../data/commits.json")).default as any[];
      const games = (await listGames(props.profileId).catch(() => [])) as any[];
      conn = await openAnalytics(commits, {
        playtime: props.playtime,
        trophies: props.trophies,
        profile: props.profileName,
        games: games.map((g) => ({ name: g.name, system: g.sys ?? g.core ?? "?", plays: g.plays ?? 0 })),
      });
      setReady(true);
      void run(PRESETS[0].sql);
    } catch (e) {
      setErr(`couldn't start the query engine — ${String((e as Error)?.message ?? e).slice(0, 140)}`);
    }
  });

  return (
    <div class="bg-root pad-focus-scope an-root">
      <div class="bg-head">
        <div class="panel-tag">CONSOLE ANALYTICS</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose() }}><span class="btn-o" /> back</button>
      </div>

      <Show when={ready()} fallback={
        <div class="an-boot">
          <Show when={!err()} fallback={<p class="an-err">{err()}</p>}>
            <div class="bg-spinner" />
            <p>Starting the query engine…</p>
            <span>DuckDB runs entirely in this tab. Your data never leaves the device.</span>
          </Show>
        </div>
      }>
        <div class="an-body">
          <div class="an-side">
            <div class="an-label">ASK</div>
            <For each={PRESETS}>
              {(p) => (
                <button class="an-preset" classList={{ on: sql() === p.sql }} onClick={() => { sfx.tickH(); void run(p.sql) }}>
                  {p.q}
                </button>
              )}
            </For>
            <div class="an-label an-label-2">TABLES</div>
            <For each={SCHEMA}>
              {(t) => (
                <div class="an-table">
                  <b>{t.name}</b>
                  <span>{t.about}</span>
                </div>
              )}
            </For>
          </div>

          <div class="an-main">
            <textarea
              class="an-sql" spellcheck={false} value={sql()}
              onInput={(e) => setSql(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                // Cmd/Ctrl+Enter runs — Enter alone has to stay a newline
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(sql()) }
              }}
            />
            <div class="an-bar">
              <button class="ps-act" disabled={busy()} onClick={() => void run(sql())}>
                <span class="btn-x" /> {busy() ? "running…" : "run"}
              </button>
              <span class="an-hint">⌘/Ctrl + Enter</span>
              <Show when={result()}>
                <span class="an-stat">{result()!.rows.length} rows · {result()!.ms} ms</span>
              </Show>
            </div>

            <Show when={err()}><div class="an-err">{err()}</div></Show>

            <Show when={result()}>
              <div class="an-scroll">
                <table class="an-table-out">
                  <thead>
                    <tr><For each={result()!.cols}>{(c) => <th>{c}</th>}</For></tr>
                  </thead>
                  <tbody>
                    <For each={result()!.rows}>
                      {(row) => (
                        <tr>
                          <For each={row}>
                            {(cell) => (
                              <td classList={{ num: typeof cell === "number" }}>
                                {cell === null ? "—" : typeof cell === "number" ? cell.toLocaleString() : String(cell)}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
                <Show when={!result()!.rows.length}>
                  <div class="an-empty"><Icon name="search" /><p>No rows.</p></div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

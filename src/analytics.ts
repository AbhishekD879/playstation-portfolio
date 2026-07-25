// Console analytics — real SQL over the console's own data.
//
// A generic "run SQL in your browser" box is a demo, not a feature. What makes
// this worth having is the DATA: 200-odd commits with per-file line counts, the
// games in your library, your playtime and trophies. Questions like "which file
// have I rewritten most" have actual answers here.
//
// DuckDB is columnar and reads JSON natively, which is exactly the shape of
// what we have. It's ~30 MB of wasm from jsDelivr, so it loads only when the
// app is opened.
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

export interface QueryResult { cols: string[]; rows: unknown[][]; ms: number }

let dbPromise: Promise<AsyncDuckDBConnection> | null = null;
let dbRef: AsyncDuckDB | null = null;

/** Tables the console exposes, with a one-line description for the UI. */
export const SCHEMA: { name: string; about: string }[] = [
  { name: "commits", about: "every commit — hash, date, subject, files touched, lines added/removed" },
  { name: "changes", about: "one row per file per commit — the line-level detail" },
  { name: "games", about: "what's in your library right now" },
  { name: "console", about: "a single row: playtime, trophies, profile" },
];

/** Questions worth asking, in the order they're worth asking them. */
export const PRESETS: { q: string; sql: string }[] = [
  {
    q: "What have I worked on most?",
    sql: `SELECT path, count(*) AS commits, sum(added) AS lines_added
FROM changes GROUP BY path ORDER BY commits DESC LIMIT 15`,
  },
  {
    q: "How has the project grown over time?",
    sql: `SELECT strftime(date, '%Y-%m') AS month, count(*) AS commits,
       sum(added) AS added, sum(removed) AS removed
FROM commits GROUP BY month ORDER BY month`,
  },
  {
    q: "Which day do I commit on?",
    sql: `SELECT dayname(date) AS day, count(*) AS commits
FROM commits GROUP BY day ORDER BY commits DESC`,
  },
  {
    q: "What are my biggest commits?",
    sql: `SELECT strftime(date, '%Y-%m-%d') AS on_day, subject, added + removed AS churn, files
FROM commits ORDER BY churn DESC LIMIT 10`,
  },
  {
    q: "Which parts of the console are biggest?",
    sql: `SELECT regexp_extract(path, '^([^/]+/[^/]+)', 1) AS area,
       sum(added) - sum(removed) AS net_lines, count(DISTINCT path) AS files
FROM changes WHERE path LIKE 'src/%'
GROUP BY area HAVING net_lines > 0 ORDER BY net_lines DESC LIMIT 15`,
  },
  {
    q: "What have I been playing?",
    sql: `SELECT name, system, plays FROM games ORDER BY plays DESC, name LIMIT 20`,
  },
];

interface CommitRow { h: string; d: number; s: string; f: [string, number, number][] }

export interface ConsoleFacts {
  playtime: number;
  trophies: number;
  profile: string;
  games: { name: string; system: string; plays: number }[];
}

/** Boot DuckDB and load the console's data into it. Idempotent. */
export async function openAnalytics(commits: CommitRow[], facts: ConsoleFacts): Promise<AsyncDuckDBConnection> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const duckdb = await import("@duckdb/duckdb-wasm");
    // jsDelivr hosts the wasm + worker bundles; selectBundle picks the right
    // one for this browser (threaded vs not, eh vs mvp).
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const worker = await duckdb.createWorker(bundle.mainWorker!);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    dbRef = db;
    const conn = await db.connect();

    // Newline-delimited JSON is the cheapest thing DuckDB can ingest, and it
    // avoids building a giant multi-row INSERT string.
    const ndjson = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");

    await db.registerFileText("commits.ndjson", ndjson(commits.map((c) => ({
      hash: c.h,
      // git stamps seconds; DuckDB wants milliseconds for to_timestamp-free casts
      date: new Date(c.d * 1000).toISOString(),
      subject: c.s,
      files: c.f.length,
      added: c.f.reduce((n, f) => n + f[1], 0),
      removed: c.f.reduce((n, f) => n + f[2], 0),
    }))));
    await conn.query(`CREATE TABLE commits AS SELECT * REPLACE (CAST(date AS TIMESTAMP) AS date)
                      FROM read_ndjson_auto('commits.ndjson')`);

    const changes = commits.flatMap((c) =>
      c.f.map((f) => ({ hash: c.h, date: new Date(c.d * 1000).toISOString(), path: f[0], added: f[1], removed: f[2] })),
    );
    await db.registerFileText("changes.ndjson", ndjson(changes));
    await conn.query(`CREATE TABLE changes AS SELECT * REPLACE (CAST(date AS TIMESTAMP) AS date)
                      FROM read_ndjson_auto('changes.ndjson')`);

    await db.registerFileText("games.ndjson", ndjson(facts.games));
    await conn.query(
      facts.games.length
        ? `CREATE TABLE games AS SELECT * FROM read_ndjson_auto('games.ndjson')`
        // an empty library still needs the table to exist, or the preset errors
        : `CREATE TABLE games (name VARCHAR, system VARCHAR, plays INTEGER)`,
    );

    await db.registerFileText("console.ndjson", ndjson([{
      profile: facts.profile, playtime_seconds: facts.playtime, trophies: facts.trophies,
    }]));
    await conn.query(`CREATE TABLE console AS SELECT * FROM read_ndjson_auto('console.ndjson')`);

    return conn;
  })();
  return dbPromise;
}

export async function runQuery(conn: AsyncDuckDBConnection, sql: string): Promise<QueryResult> {
  const t0 = performance.now();
  const res = await conn.query(sql);
  const cols = res.schema.fields.map((f: { name: string }) => f.name);
  // Arrow gives typed columns; normalise to plain JS so the UI stays dumb.
  const rows = res.toArray().map((r: Record<string, unknown>) =>
    cols.map((c) => {
      const v = (r as any)[c];
      if (v === null || v === undefined) return null;
      if (typeof v === "bigint") return Number(v);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "object") {
        // SUM() over integers comes back as HUGEINT/DECIMAL — an Arrow object,
        // not a JS number. Left as a string it renders left-aligned among the
        // other numbers, so recover the number when it genuinely is one.
        const s = String(v);
        return /^-?\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : s;
      }
      return v;
    }),
  );
  return { cols, rows, ms: Math.round(performance.now() - t0) };
}

export async function closeAnalytics() {
  try { (await dbPromise)?.close(); await dbRef?.terminate() } catch { /* already gone */ }
  dbPromise = null; dbRef = null;
}

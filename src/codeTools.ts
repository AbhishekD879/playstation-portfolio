// Formatting & linting for the Code Playground — all in-browser, no server.
// JS uses Prettier (format) + ESLint's browser Linter (lint). Python tooling
// (black / pyflakes) lives in the Pyodide worker, so this file only handles JS;
// the worker handles Python via its own "format"/"lint" ops. Everything is
// lazy-loaded on first use.
export interface Diag { line: number; col: number; msg: string; severity: "error" | "warn" }

let prettier: any = null;
let prettierPlugins: any[] = [];
let Linter: any = null;

async function loadPrettier() {
  if (!prettier) {
    prettier = await import("prettier/standalone");
    prettierPlugins = [(await import("prettier/plugins/babel")).default, (await import("prettier/plugins/estree")).default];
  }
  return prettier;
}

/** Prettify JS. Throws (with a readable message) on a syntax error. */
export async function formatJs(code: string): Promise<string> {
  const p = await loadPrettier();
  return (await p.format(code, { parser: "babel", plugins: prettierPlugins, semi: true, singleQuote: false, printWidth: 90 })).trimEnd();
}

// A small, useful rule set — real linting without dragging in a full config.
const RULES = {
  "no-unused-vars": "warn", "no-undef": "warn", "no-unreachable": "warn",
  "no-const-assign": "error", "no-dupe-keys": "error", "no-dupe-args": "error",
  "use-isnan": "error", "valid-typeof": "error", "no-cond-assign": "warn",
  "no-constant-condition": "warn", "no-empty": "warn", "no-func-assign": "error",
} as const;
const GLOBALS = { console: "readonly", setTimeout: "readonly", setInterval: "readonly", clearTimeout: "readonly", clearInterval: "readonly", Math: "readonly", JSON: "readonly", Date: "readonly", Promise: "readonly", fetch: "readonly", Array: "readonly", Object: "readonly", String: "readonly", Number: "readonly", Boolean: "readonly", Map: "readonly", Set: "readonly", Symbol: "readonly", structuredClone: "readonly", globalThis: "readonly" };

/** Lint JS → diagnostics with line/col. */
export async function lintJs(code: string): Promise<Diag[]> {
  if (!Linter) Linter = (await import("eslint-linter-browserify")).Linter;
  const linter = new Linter();
  const messages = linter.verify(code, {
    languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: GLOBALS as any },
    rules: RULES as any,
  });
  return messages.map((m: any) => ({
    line: m.line ?? 1,
    col: m.column ?? 1,
    msg: m.message + (m.ruleId ? `  (${m.ruleId})` : ""),
    severity: m.severity === 2 || m.fatal ? "error" : "warn",
  }));
}

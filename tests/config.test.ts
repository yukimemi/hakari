// The three config facts this project cannot let drift.
//
// All three were reverted at once on 2026-08-23 by an automated
// template refresh (PR #14) that reset them to the upstream defaults.
// The loud one — a catch-all SPA rewrite — took the whole API down for
// 25 minutes. The quiet two would have stayed indefinitely: a tsconfig
// that no longer looks at `api/` still exits 0, and a missing
// `maxDuration` only shows up as a 504 on the slowest requests.
//
// The template layers were fixed so kata no longer owns these keys, but
// "nothing should touch this" is not a thing a manifest can promise.
// These assertions are the thing that fails when something does.
//
// Written against behaviour, not text: the rewrite check runs the
// pattern, and the timeout check reads the real constant out of
// `api/_lib/providers.ts` rather than repeating the number.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The tsconfigs are JSONC — they carry block-comment section headers,
// which is also why kata cannot merge them key-wise. Strip comments
// outside string literals, so a `//` inside a URL survives.
function stripComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

const readJson = <T>(path: string): T => JSON.parse(stripComments(read(path))) as T;

type Tsconfig = { include?: string[] };
type Vercel = {
  regions?: string[];
  functions?: Record<string, { maxDuration?: number }>;
  rewrites?: { source: string; destination: string }[];
};

describe("tsconfig include", () => {
  // `shared/` is consumed by both halves, so both projects must look at
  // it — otherwise a type error there surfaces only in the half that
  // still includes it, or in neither.
  it("type-checks shared/ from the browser project", () => {
    expect(readJson<Tsconfig>("tsconfig.app.json").include).toEqual(
      expect.arrayContaining(["src", "shared"]),
    );
  });

  // The node project is the only thing that type-checks the server: the
  // API routes, the dev-server plugin that mounts them, and these
  // tests. Dropping an entry here silently stops checking that code.
  it("type-checks the whole server half from the node project", () => {
    expect(readJson<Tsconfig>("tsconfig.node.json").include).toEqual(
      expect.arrayContaining(["vite.config.ts", "vite-plugin-api.ts", "api", "shared", "tests"]),
    );
  });
});

describe("vercel.json", () => {
  it("pins the Tokyo region", () => {
    expect(readJson<Vercel>("vercel.json").regions).toEqual(["hnd1"]);
  });

  // A provider call may run for PROVIDER_TIMEOUT_MS; the function it
  // runs inside must outlive it — strictly, so the provider's own abort
  // is what ends a slow call. At parity the platform kill races it and
  // the caller gets a 504 instead of the error the route would return.
  it("gives functions longer than a provider call is allowed to take", () => {
    const source = read("api/_lib/providers.ts");
    const match = /PROVIDER_TIMEOUT_MS\)\s*\|\|\s*([\d_]+)/.exec(source);
    expect(match, "PROVIDER_TIMEOUT_MS default not found in api/_lib/providers.ts").not.toBeNull();
    const providerTimeoutMs = Number(match![1].replaceAll("_", ""));

    const maxDuration = readJson<Vercel>("vercel.json").functions?.["api/*.ts"]?.maxDuration;
    expect(maxDuration, 'vercel.json functions["api/*.ts"].maxDuration is missing').toBeDefined();
    expect(maxDuration! * 1000).toBeGreaterThan(providerTimeoutMs);
  });

  // The SPA rewrite sends unknown paths to index.html. If it also
  // matches /api/*, every route returns the app shell as HTML and the
  // API is gone while the deploy stays green.
  it("routes app paths to the shell without swallowing the API", () => {
    const rewrites = readJson<Vercel>("vercel.json").rewrites ?? [];
    expect(rewrites.length).toBeGreaterThan(0);

    const matched = (path: string) =>
      rewrites.find(({ source }) => new RegExp(`^${source}$`).test(path));

    // Matching is not enough: the rewrite that claims an app path has to
    // send it to the shell, or deep links land somewhere else entirely.
    for (const appPath of ["/", "/today", "/meals"]) {
      expect(matched(appPath), `${appPath} must be rewritten to the shell`).toMatchObject({
        destination: "/",
      });
    }
    for (const apiPath of ["/api", "/api/", "/api/models", "/api/analyze-meal"]) {
      expect(matched(apiPath), `${apiPath} must reach the function, not index.html`).toBeUndefined();
    }
  });
});

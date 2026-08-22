// Serves the `api/` directory during `pnpm dev`.
//
// In production these files are Vercel Functions. They are written against
// the Web-standard `Request`/`Response` pair, which means nothing about them
// is actually Vercel-specific — so rather than requiring the Vercel CLI just
// to exercise the AI features locally, this plugin mounts the same handlers
// on Vite's dev server. `pnpm dev` is then the whole app, not just the
// front end, and edits to `api/` hot-reload like any other module.

import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { type Plugin, loadEnv } from "vite";

/** `/api/analyze-meal?x=1` -> `analyze-meal`. Anything with a slash or an
 *  unexpected character is refused rather than turned into a path. */
function routeName(url: string): string | null {
  const path = url.split("?")[0].slice("/api/".length).replace(/\/+$/, "");
  return /^[a-z0-9-]+$/i.test(path) ? path : null;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }

  const method = req.method ?? "GET";
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }

  return new Request(url, { method, headers, body });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

export function apiRoutes(): Plugin {
  return {
    name: "hakari-api-routes",
    apply: "serve",

    config(_config, { mode }) {
      // Vite only exposes VITE_-prefixed variables, and only to the browser.
      // The handlers read `process.env`, so mirror the unprefixed values
      // across. Following dotenv's convention, anything already present in
      // the shell wins — which is how the provider keys exported by the
      // user's shell profile reach the functions without being copied into
      // the repo.
      const env = loadEnv(mode, process.cwd(), "");
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();

        const name = routeName(url);
        const file = name && resolve(process.cwd(), "api", `${name}.ts`);
        if (!file || !existsSync(file)) return next();

        void (async () => {
          try {
            // Vercel selects the Web Request/Response signature by the
            // export name, so a route exports GET or POST rather than a
            // default. Dispatch the same way here, and answer 405 for a
            // method the route does not export — which is what Vercel
            // does in production.
            const module = await server.ssrLoadModule(file);
            const method = (req.method ?? "GET").toUpperCase();
            const handler = module[method] as
              | ((r: Request) => Promise<Response>)
              | undefined;
            if (typeof handler !== "function") {
              res.statusCode = 405;
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: `${method} は許可されていません` }));
              return;
            }
            await send(res, await handler(await toWebRequest(req)));
          } catch (err) {
            server.ssrFixStacktrace(err as Error);
            server.config.logger.error(`[api] ${name} failed`, { error: err as Error });
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: String((err as Error).message ?? err) }));
          }
        })();
      });
    },
  };
}

// Small helpers shared by every route: JSON responses, body parsing with
// zod validation, and one error funnel that maps our typed errors onto
// status codes so each handler stays a straight line.

import { z } from "zod";
import { AuthError } from "./auth.js";
import { UsageError } from "./usage.js";
import { ProviderError } from "./providers.js";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export class BadRequest extends Error {
  readonly status = 400;
}

/** Parses and validates the request body, or throws `BadRequest`. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BadRequest("リクエストボディが JSON ではありません");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join(", ");
    throw new BadRequest(`リクエストが不正です: ${detail}`);
  }
  return parsed.data;
}

/**
 * Wraps a handler so thrown errors become sensible JSON responses.
 * Anything unrecognised is logged and reported as a generic 500 — the
 * message may carry provider internals we do not want to echo back.
 */
export function route(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (
        err instanceof AuthError ||
        err instanceof UsageError ||
        err instanceof ProviderError ||
        err instanceof BadRequest
      ) {
        return json({ error: err.message }, err.status);
      }
      console.error("unhandled route error", err);
      return json({ error: "サーバ内部エラーが発生しました" }, 500);
    }
  };
}


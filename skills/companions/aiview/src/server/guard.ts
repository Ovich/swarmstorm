// Request admission (trust-adaptations#D3, #D4, #D22): the one place a request's Host, Origin,
// content type and token are read. A web page open in the person's browser reaches 127.0.0.1
// too; it can neither drive aiview (no token, no JSON without a preflight) nor read it (its
// Origin is foreign), and a DNS-rebound name fails on Host. Routes never read these themselves.
import crypto from "node:crypto";
import type http from "node:http";

export type Refusal = { status: 403 | 415 | 421; reason: string };

/** The header the CLI sends the token in; the viewer sends it as the cookie instead. */
export const TOKEN_HEADER = "x-aiview-token";
export const TOKEN_COOKIE = "aiview_token";

/** A fresh server token: 32 random bytes, hex. */
export const newServerToken = (): string => crypto.randomBytes(32).toString("hex");

/** The Set-Cookie value handing the viewer the token, set only on its index.html. */
export const tokenCookie = (token: string): string => `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;

type GuardOptions = { port: number; token: string; devOrigins?: string[] };
type Check = (req: http.IncomingMessage) => Refusal | null;

const header = (req: http.IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const cookieToken = (req: http.IncomingMessage): string | undefined => {
  for (const part of (header(req, "cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === TOKEN_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
};

const sameToken = (given: string | undefined, token: string): boolean => {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function makeGuard({ port, token, devOrigins = [] }: GuardOptions): { check(req: http.IncomingMessage): Refusal | null } {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...devOrigins]);
  const isPost = (req: http.IncomingMessage) => req.method === "POST";
  // in order: the first that refuses answers
  const checks: Check[] = [
    (req) => (hosts.has((header(req, "host") ?? "").toLowerCase()) ? null : { status: 421, reason: "host not allowed" }),
    (req) => {
      const origin = header(req, "origin");
      return origin === undefined || origins.has(origin) ? null : { status: 403, reason: "origin not allowed" };
    },
    (req) =>
      !isPost(req) || (header(req, "content-type") ?? "").split(";")[0].trim().toLowerCase() === "application/json"
        ? null
        : { status: 415, reason: "a POST is application/json" },
    (req) =>
      !isPost(req) || sameToken(header(req, TOKEN_HEADER) ?? cookieToken(req), token)
        ? null
        : { status: 403, reason: "missing or wrong token" },
  ];
  return {
    check(req) {
      for (const check of checks) {
        const refusal = check(req);
        if (refusal) return refusal;
      }
      return null;
    },
  };
}

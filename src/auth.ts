/**
 * Optional login — off unless a password is set via AUTH_PASSWORD or
 * ⚙ Settings → Security. Sessions are stateless signed cookies.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { signSession, verifySession } from "./crypto.ts";
import { authRequired, authGeneration, verifyAuthPassword } from "./settings.ts";
import { HttpError } from "./http.ts";

export const LOGIN_PAGE = fs.readFileSync(path.join(import.meta.dirname, "public", "login.html"), "utf8");

const SESSION_COOKIE = "jt_session";
const loginFailures = new Map<string, { n: number; until: number }>();
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function cookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie, ignore */ }
  }
  return out;
}
export function isAuthed(req: http.IncomingMessage): boolean {
  return !authRequired() || Boolean(verifySession(cookies(req)[SESSION_COOKIE] ?? "", authGeneration()));
}
export function setSessionCookie(res: http.ServerResponse) {
  const token = signSession(Date.now() + SESSION_MS, authGeneration());
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}`);
}
export function clearSessionCookie(res: http.ServerResponse) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
/** Reachable without a session: login itself, static JS, and the bookmarklet's
 * cross-origin capture drop (it only queues page text for the app to claim
 * after login — nothing readable comes back from it). */
export function isPublicRoute(method: string | undefined, pathname: string): boolean {
  if (pathname === "/api/login" && method === "POST") return true;
  if (pathname === "/app.js" && method === "GET") return true;
  if (pathname === "/favicon.ico" && method === "GET") return true;
  if (pathname.startsWith("/fonts/") && method === "GET") return true;
  if (pathname === "/api/bookmarklet" && method === "GET") return true;
  if (pathname === "/api/captures" && (method === "POST" || method === "OPTIONS")) return true;
  if (pathname.startsWith("/api/autofill") && method === "OPTIONS") return true; // CORS preflight carries no credentials
  return false;
}

/** The autofill bookmarklet runs on another site, so it can't send the session cookie; it carries a
 * signed token instead (same signing as sessions, so a password change revokes every old bookmarklet). */
export const AUTOFILL_TOKEN_MS = 365 * 24 * 60 * 60 * 1000;
export function autofillToken(): string {
  return signSession(Date.now() + AUTOFILL_TOKEN_MS, authGeneration());
}
export function autofillAuthed(req: http.IncomingMessage, pathname: string): boolean {
  if (!pathname.startsWith("/api/autofill")) return false;
  const token = req.headers["x-jt-token"];
  return typeof token === "string" && verifySession(token, authGeneration());
}


/** Check a login attempt with per-IP backoff after repeated failures. Throws HttpError on failure. */
export async function attemptLogin(ip: string, password: unknown) {
  const fails = loginFailures.get(ip) ?? { n: 0, until: 0 };
  if (Date.now() < fails.until) throw new HttpError(429, `Too many attempts — try again in ${Math.ceil((fails.until - Date.now()) / 1000)}s`);
  if (typeof password !== "string" || !verifyAuthPassword(password)) {
    fails.n++;
    fails.until = fails.n >= 5 ? Date.now() + Math.min(60_000, 2 ** (fails.n - 5) * 5_000) : 0; // 5s, 10s, 20s … capped at 60s
    loginFailures.set(ip, fails);
    await new Promise((r) => setTimeout(r, 300));
    throw new HttpError(401, "Incorrect password");
  }
  loginFailures.delete(ip);
}

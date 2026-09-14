import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.ts";

const KEY_PATH = path.join(DATA_DIR, "secret.key");
const ENC_PREFIX = "v1:";

/** Random secret generated on first run, used for both API-key encryption and
 * session signing. Losing it makes saved keys and sessions unrecoverable —
 * back it up alongside tracker.db, or just re-paste keys and log in again. */
let cached: Buffer | null = null;
function secret(): Buffer {
  if (cached) return cached;
  cached = fs.existsSync(KEY_PATH)
    ? Buffer.from(fs.readFileSync(KEY_PATH, "utf8").trim(), "hex")
    : crypto.randomBytes(32);
  if (!fs.existsSync(KEY_PATH)) fs.writeFileSync(KEY_PATH, cached.toString("hex"), { mode: 0o600 });
  return cached;
}

export function looksEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/** AES-256-GCM. Output is self-contained (iv + auth tag + ciphertext, base64). */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(payload: string): string {
  if (!looksEncrypted(payload)) throw new Error("Not an encrypted value");
  const raw = Buffer.from(payload.slice(ENC_PREFIX.length), "base64");
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Login password hashing (scrypt, random salt per password) — never stored raw. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a), bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) { crypto.timingSafeEqual(bufA, bufA); return false; }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Stateless session token — a signed expiry timestamp, so no server-side store is needed. */
export function signSession(expiresAt: number): string {
  const mac = crypto.createHmac("sha256", secret()).update(String(expiresAt)).digest("hex");
  return `${expiresAt}.${mac}`;
}

export function verifySession(token: string): boolean {
  const [expiresAtStr, mac] = token.split(".");
  if (!expiresAtStr || !mac) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = crypto.createHmac("sha256", secret()).update(expiresAtStr).digest("hex");
  return timingSafeEqualStr(mac, expected);
}

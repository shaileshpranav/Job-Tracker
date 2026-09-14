/** Tiny HTTP helpers shared by the routes and auth. */
import http from "node:http";

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

export const MAX_BODY = 8 * 1024 * 1024;
export async function readJson(req: http.IncomingMessage): Promise<any> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new HttpError(413, "Request body too large");
  }
  if (!body.trim()) return {};
  try { return JSON.parse(body); } catch { throw new HttpError(400, "Body is not valid JSON"); }
}
export function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : (body as string));
}

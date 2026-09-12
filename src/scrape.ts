import { extractJob, fetchJobViaLLM, type JobExtract } from "./ai.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/**
 * Most career sites embed a schema.org JobPosting as JSON-LD — cleaner than
 * the rendered page. Returns it as text to lead the extraction, or "".
 */
export function jobPostingFromJsonLd(html: string): string {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: any;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes: any[] = [];
    const walk = (n: any) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { nodes.push(n); if (n["@graph"]) walk(n["@graph"]); } };
    walk(data);
    for (const n of nodes) {
      const type = Array.isArray(n["@type"]) ? n["@type"].join(",") : n["@type"];
      if (!/JobPosting/i.test(String(type ?? ""))) continue;
      const loc = [n.jobLocation].flat().filter(Boolean).map((l: any) => [l?.address?.addressLocality, l?.address?.addressRegion, l?.address?.addressCountry].filter(Boolean).join(", ")).filter(Boolean).join(" / ");
      const sal = n.baseSalary?.value ? [n.baseSalary.value.minValue, n.baseSalary.value.maxValue].filter(Boolean).join("–") + (n.baseSalary.currency ? ` ${n.baseSalary.currency}` : "") + (n.baseSalary.value.unitText ? ` per ${String(n.baseSalary.value.unitText).toLowerCase()}` : "") : "";
      out.push([
        `Title: ${n.title ?? ""}`, `Company: ${n.hiringOrganization?.name ?? ""}`, loc && `Location: ${loc}`,
        n.jobLocationType && `Location type: ${n.jobLocationType}`, n.employmentType && `Employment type: ${[n.employmentType].flat().join(", ")}`,
        sal && `Salary: ${sal}`, n.datePosted && `Posted: ${n.datePosted}`, "", htmlToText(String(n.description ?? "")),
      ].filter((x) => x !== false && x !== undefined).join("\n"));
    }
  }
  return out.join("\n\n");
}

/** Crude HTML -> text: drop scripts/styles/nav, collapse whitespace. */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|footer|header|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * The site wants a human: a verification check, a login wall, or a hard block.
 * We never try to solve or bypass these — the job parks and asks the user to
 * open the page themselves, which is both the honest and the reliable answer.
 */
export class CaptureBlocked extends Error {
  url: string;
  reason: string;
  constructor(url: string, reason: string) { super(reason); this.url = url; this.reason = reason; }
}

const CHALLENGE_MARKERS: [RegExp, string][] = [
  [/just a moment\.\.\.|checking your browser before|cf[-_]chl|challenge-platform|cf_chl_opt/i, "Cloudflare is running a browser check"],
  [/verify (you are|you're) (a )?human|are you a robot|confirm you are human|human verification/i, "the site is asking for human verification"],
  [/recaptcha\/api\.js|g-recaptcha|hcaptcha\.com|h-captcha|px-captcha|perimeterx|datadome|incapsula|_Incapsula_Resource|kasada/i, "the page is behind a CAPTCHA or bot-protection service"],
  [/access denied|attention required|request blocked|unusual traffic from your computer/i, "the site blocked this request"],
  [/please (sign in|log ?in) to (view|continue|see)|sign in to view this job|members? only/i, "the posting needs you to be signed in"],
];

/** Why a fetched page can't be used, or null if it looks like a real posting. */
export function detectChallenge(status: number, html: string): string | null {
  if (status === 401 || status === 403) return "the site refused the request (HTTP " + status + ")";
  if (status === 429) return "the site is rate-limiting this machine (HTTP 429)";
  if (status === 503 && /cloudflare|cf-chl|just a moment/i.test(html)) return "Cloudflare is running a browser check";
  const head = html.slice(0, 60_000);
  for (const [re, why] of CHALLENGE_MARKERS) if (re.test(head)) return why;
  return null;
}

/**
 * Fetch a posting locally. If the page is JS-rendered or blocked, fall back to
 * the provider's server-side fetch (Anthropic web_fetch) where available, and
 * otherwise hand the page to the user to open themselves.
 *
 * `verifiedText` is page text the user captured after passing the check.
 */
export async function captureFromUrl(url: string, verifiedText?: string): Promise<JobExtract & { source_text: string }> {
  if (verifiedText?.trim()) {
    const text = verifiedText.trim();
    return { ...(await extractJob(text, url)), source_text: text };
  }

  let text = "", blocked: string | null = null;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const html = res.headers.get("content-type")?.includes("html") !== false ? await res.text() : "";
    blocked = detectChallenge(res.status, html);
    if (res.ok && !blocked) {
      const ld = jobPostingFromJsonLd(html);
      text = ld ? `${ld}\n\n----- page text -----\n${htmlToText(html)}` : htmlToText(html);
    }
  } catch (e: any) {
    blocked = /timeout|aborted/i.test(e?.message ?? "") ? "the site did not respond in time" : null;
  }

  if (text.length >= 800) return { ...(await extractJob(text, url)), source_text: text };

  // The provider's own fetcher sometimes gets through where we can't.
  try {
    return await fetchJobViaLLM(url);
  } catch (e: any) {
    throw new CaptureBlocked(url, blocked ?? (text ? "the page had too little text to read (it is probably rendered by JavaScript)" : e.message));
  }
}

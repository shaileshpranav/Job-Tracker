import { extractJob, fetchJobViaLLM, type JobExtract } from "./ai.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** Crude HTML -> text: drop scripts/styles/nav, collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|footer|header|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Fetch a posting locally; if the page is JS-rendered or blocked, fall back to
 * the provider's server-side fetch (Anthropic web_fetch), if it has one.
 */
export async function captureFromUrl(url: string): Promise<JobExtract & { source_text: string }> {
  let text = "";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (res.ok) text = htmlToText(await res.text());
  } catch { /* fall through to provider fetch */ }

  if (text.length >= 800) return { ...(await extractJob(text, url)), source_text: text };
  return fetchJobViaLLM(url);
}

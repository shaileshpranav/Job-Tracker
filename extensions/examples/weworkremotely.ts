/**
 * Example extension — We Work Remotely (aggregator).
 *
 * A worked example of why extensions exist: WWR publishes public, intended-for-consumption RSS
 * feeds (their robots.txt allows them), but they're XML rather than JSON, so they don't fit the
 * core rule that bundled sources are official JSON endpoints. Out here, that's fine.
 *
 * To use it: copy this file up one level into `extensions/`, restart the server, then enable
 * "We Work Remotely (extension)" in the feed settings.
 */

/** WWR's category feeds. Trim this list to the ones you care about. */
const FEEDS = [
  "remote-programming-jobs",
  "remote-devops-sysadmin-jobs",
  "remote-design-jobs",
  "remote-product-jobs",
];

const tag = (xml: string, name: string) =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1] ?? "";

/** RSS puts escaped HTML inside <description>; undo one layer so htmlToText can do its job. */
const unescapeXml = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

export default {
  id: "wwr",
  label: "We Work Remotely",
  kind: "aggregator" as const,

  async fetch(_token: string, ctx: any) {
    const postings = [];
    const seen = new Set<string>();

    for (const feed of FEEDS) {
      ctx.progress(`We Work Remotely: ${feed}`);
      let xml: string;
      try {
        xml = await ctx.fetchText(`https://weworkremotely.com/categories/${feed}.rss`);
      } catch (e: any) {
        console.error(`[wwr] ${feed}: ${e.message}`);
        continue; // one bad feed shouldn't lose the others
      }

      for (const block of xml.split("<item>").slice(1)) {
        const url = tag(block, "link").trim() || tag(block, "guid").trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);

        // WWR titles read "Company: Role" — split so the company lands in its own column.
        const full = unescapeXml(tag(block, "title")).trim();
        const split = full.match(/^(.{1,80}?):\s+(.+)$/);

        postings.push({
          id: url,
          company: split?.[1]?.trim() || "We Work Remotely",
          title: (split?.[2] ?? full).trim(),
          location: unescapeXml(tag(block, "region")).trim() || "Remote",
          remote: true, // everything on WWR is
          url,
          description: ctx.htmlToText(unescapeXml(tag(block, "description"))),
          posted_at: tag(block, "pubDate").trim() || null,
        });
      }
    }
    return postings;
  },
};

/**
 * Example extension — a board connector template, with capture.
 *
 * Copy this up one level into `extensions/`, rename it, and point it at a real board.
 * Nothing here talks to a real service as written; it's a starting shape, not a working source.
 *
 * "board" means one instance per company: the user adds `mytracker:acme` under Company boards in
 * the feed settings, and `token` below is "acme". For a single global source that isn't per-company,
 * use `kind: "aggregator"` instead (see weworkremotely.ts) — then `token` is always "".
 */

export default {
  id: "mytracker",
  label: "My ATS",
  kind: "board" as const,

  /**
   * Optional. Lets "Find board" turn a pasted careers URL into `mytracker:<token>`, instead of the
   * user having to know the id. Return the token, or null if this isn't one of your URLs.
   */
  match(url: string): string | null {
    return /(?:^|\/\/)([\w-]+)\.myats\.example\//.exec(url)?.[1] ?? null;
  },

  async fetch(token: string, ctx: any) {
    // Paginate if the API makes you; keep it to a handful of requests per refresh.
    const data = await ctx.fetchJson(`https://${token}.myats.example/api/v1/postings`);

    return (data.postings ?? []).map((j: any) => ({
      id: j.id,                                   // optional — defaults to the url
      title: j.name,                              // required
      company: j.company_name || token,           // optional — defaults to this extension's label
      location: [j.city, j.country].filter(Boolean).join(", "),
      remote: j.workplace_type === "remote",
      salary: j.compensation ?? "",
      url: j.public_url,                          // required, must be http(s)
      // Descriptions matter: the ATS keyword screen and the model fit score both read this.
      // If the list endpoint doesn't include one, it's usually worth a second request per posting —
      // but only if the board is small enough that that isn't rude.
      description: ctx.htmlToText(j.description_html ?? ""),
      posted_at: j.published_at,                  // Date, ISO string or unix seconds
    }));
  },

  /**
   * Optional and independent of `kind`: improve single-posting capture for URLs you recognise.
   * Without this, capturing one of these URLs uses the generic path (fetch the page, prefer its
   * JSON-LD, fall back to the provider's own fetcher). With it, you can go straight to the API.
   *
   * Return page text for the extractor, or null to fall through to the generic path.
   */
  capture: {
    matches: (url: string) => /\.myats\.example\/jobs\//.test(url),

    async fetch(url: string, ctx: any) {
      const id = /\/jobs\/([\w-]+)/.exec(url)?.[1];
      if (!id) return null;
      try {
        const j = await ctx.fetchJson(`https://api.myats.example/v1/postings/${id}`);
        return [
          `Title: ${j.name}`,
          `Company: ${j.company_name ?? ""}`,
          `Location: ${[j.city, j.country].filter(Boolean).join(", ")}`,
          "",
          ctx.htmlToText(j.description_html ?? ""),
        ].join("\n");
      } catch {
        return null; // let the normal capture path try
      }
    },
  },
};

/**
 * ATS keyword check — deterministic, no model. Pulls the terms a screening
 * system would look for out of the posting (its extracted requirements first,
 * then technical terms from the description), and reports which appear in a
 * resume, how often, and what's missing.
 */

const STOP = new Set(("a an the and or of to in on for with at by from as is are be been being this that these those it its into over under about " +
  "you your we our they their who what which when where how not no nor but if then than so such very can will would should may might must shall " +
  "have has had do does did done having using use used uses via per each any all some more most other others another both either neither own same " +
  "up down out off again further once here there while during before after above below between through across within without also just only ever " +
  "new old good great strong solid proven excellent ability able experience experienced years year plus minimum least required requirements requirement " +
  "preferred nice bonus responsibilities responsibility role roles team teams work working knowledge skills skill understanding familiarity familiar " +
  "background degree bachelor master phd equivalent related field relevant hands hand demonstrated track record etc eg ie including include includes " +
  "candidate candidates ideal apply application job position company we're you'll you're join looking seeking want need needs environment fast paced " +
  "opportunity benefits salary competitive package remote hybrid onsite office location full time part contract permanent senior junior mid level staff lead principal " +
  "engineer engineering engineers developer development software technical technology technologies tools tool platform platforms system systems solution solutions " +
  "build building built design designing designed develop developing developed deliver delivering implement implementing maintain maintaining support supporting " +
  "collaborate collaborating communicate communication written verbal problem solving problems complex scale scalable high quality best practices practice " +
  "product products customer customers business stakeholders cross functional agile scrum ci cd similar equivalent comparable modern various multiple").split(/\s+/));
// Fine inside a phrase ("data pipelines"), meaningless as a keyword on their own.
const GENERIC_ALONE = new Set(["data", "science", "computer science", "information", "management", "analysis", "services", "service", "process", "processes", "language", "languages", "framework", "frameworks", "concepts", "principles", "methodologies", "techniques"]);

// Common aliases so "Postgres" satisfies "PostgreSQL" and "k8s" satisfies "Kubernetes".
const ALIASES: Record<string, string[]> = {
  postgresql: ["postgres"], kubernetes: ["k8s"], javascript: ["js"], typescript: ["ts"], "machine learning": ["ml"], "artificial intelligence": ["ai"],
  "large language models": ["llm", "llms"], "large language model": ["llm", "llms"], "natural language processing": ["nlp"], "continuous integration": ["ci"],
  "amazon web services": ["aws"], "google cloud": ["gcp", "google cloud platform"], "microsoft azure": ["azure"], "node.js": ["node", "nodejs"], "react.js": ["react"],
  "c++": ["cpp"], "c#": ["csharp"], "golang": ["go"], "retrieval augmented generation": ["rag"], "infrastructure as code": ["iac", "terraform"],
};

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
/** Word-boundary-ish regex that tolerates plurals and hyphen/space variants. */
function termRe(term: string) {
  const t = escapeRe(norm(term)).replace(/[\s-]+/g, "[\\s-]*");
  return new RegExp(`(?<![a-z0-9+#])${t}(?:s|es)?(?![a-z0-9+#])`, "g");
}

/** Terms worth checking, from the posting's requirement list and description. */
export function postingTerms(description: string, requirements: string[]): { required: string[]; mentioned: string[] } {
  const required = new Set<string>();
  for (const r of requirements) {
    // "Go or Python (3+ years)" → Go, Python. Split on connectors, drop generic words, keep short phrases.
    for (const part of r.split(/[,;/()]|\s+(?:or|and|with|in|of|using|including)\s+/i)) {
      const words = part.replace(/\d+\+?\s*(?:years?|yrs?)/gi, " ").split(/\s+/).map((w) => w.replace(/^[^\w+#.]+|[^\w+#.]+$/g, "")).filter((w) => w && !STOP.has(norm(w)));
      if (!words.length || words.length > 4) continue;
      const phrase = words.join(" ");
      if (GENERIC_ALONE.has(norm(phrase))) continue;
      required.add(phrase);
    }
  }
  // Description: capitalised words / acronyms / tech-looking tokens (C++, S3, .NET) that recur or look like proper tech nouns.
  const counts = new Map<string, { n: number; display: string; mid: boolean }>();
  for (const sentence of description.split(/(?<=[.!?:;])\s+|\n+/)) {
    // Group runs of Capitalised words into one phrase ("GitHub Actions"); everything else stays a single token.
    const tokens: string[] = [];
    for (const chunk of sentence.split(/[,;/()|&]|\s[-–—]\s/)) { // punctuation ends a phrase
      const words = chunk.match(/\.?[A-Za-z][A-Za-z0-9+#.]*/g) ?? [];
      let first = true;
      for (const w of words) {
        const cap = /^[A-Z]/.test(w), prev = tokens[tokens.length - 1];
        if (!first && cap && prev && /^[A-Z]/.test(prev) && !STOP.has(norm(prev)) && !STOP.has(norm(w))) tokens[tokens.length - 1] = `${prev} ${w}`;
        else tokens.push(w);
        first = false;
      }
    }
    tokens.forEach((raw, i) => {
      const tok = raw.replace(/\.$/, "");
      const capitalised = /^\.?[A-Z][A-Za-z0-9+#.]*(?:\s[A-Z][A-Za-z0-9+#.]*)*$/.test(tok), techy = /[+#]|\d|^[A-Z]{2,}$|^\.[A-Za-z]|\.[a-z]|\s/.test(tok);
      const key = norm(tok);
      if ((!capitalised && !techy) || STOP.has(key) || key.length < 2 || GENERIC_ALONE.has(key)) return;
      if (key.split(" ").every((w) => STOP.has(w))) return;
      const cur = counts.get(key) ?? { n: 0, display: tok, mid: false };
      cur.n++; if (i > 0 || techy) cur.mid = true; // sentence-initial capitals ("Build", "Own") don't count unless seen mid-sentence
      counts.set(key, cur);
    });
  }
  const reqKeys = new Set([...required].map(norm));
  const mentioned = [...counts.entries()].filter(([k, v]) => !reqKeys.has(k) && v.mid).sort((a, b) => b[1].n - a[1].n).slice(0, 30).map(([, v]) => v.display);
  return { required: [...required].slice(0, 40), mentioned };
}

export interface AtsTerm { term: string; count: number; required: boolean; aliasHit?: string }
export interface AtsReport { coverage: number; requiredCoverage: number; words: number; matched: AtsTerm[]; missing: AtsTerm[]; overused: string[] }

export function atsCheck(description: string, requirements: string[], resumeMd: string): AtsReport {
  const { required, mentioned } = postingTerms(description, requirements);
  const text = norm(resumeMd);
  const words = resumeMd.split(/\s+/).filter(Boolean).length || 1;
  const matched: AtsTerm[] = [], missing: AtsTerm[] = [];
  const seen = new Set<string>();
  const canonical = (k: string) => { for (const [c, al] of Object.entries(ALIASES)) if (c === k || al.includes(k)) return c; return k; };
  for (const [list, isReq] of [[required, true], [mentioned, false]] as const) {
    for (const term of list) {
      const key = norm(term), canon = canonical(key);
      if (seen.has(canon)) continue; seen.add(canon); // "Postgres" and "PostgreSQL" are one term
      let count = (text.match(termRe(term)) ?? []).length, aliasHit: string | undefined;
      if (!count) for (const alias of ALIASES[key] ?? []) { const n = (text.match(termRe(alias)) ?? []).length; if (n) { count = n; aliasHit = alias; break; } }
      if (!count) for (const [canon, aliases] of Object.entries(ALIASES)) if (aliases.includes(key)) { const n = (text.match(termRe(canon)) ?? []).length; if (n) { count = n; aliasHit = canon; break; } }
      (count ? matched : missing).push({ term, count, required: isReq, aliasHit });
    }
  }
  const req = [...matched, ...missing].filter((t) => t.required);
  const reqHit = matched.filter((t) => t.required).length;
  const all = matched.length + missing.length;
  return {
    coverage: all ? Math.round((matched.length / all) * 100) : 100,
    requiredCoverage: req.length ? Math.round((reqHit / req.length) * 100) : 100,
    words,
    matched: matched.sort((a, b) => Number(b.required) - Number(a.required) || b.count - a.count),
    missing: missing.sort((a, b) => Number(b.required) - Number(a.required)),
    overused: matched.filter((t) => t.count / words > 0.012 && t.count >= 6).map((t) => `${t.term} ×${t.count}`),
  };
}

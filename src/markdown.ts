/** Minimal Markdown -> HTML for print-ready documents (headings, lists, emphasis, links). */
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\*)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)/.exec(line);
    const li = /^\s*[-*+]\s+(.*)/.exec(line);
    const oli = /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (li || oli) {
      flushPara();
      const want = li ? "ul" : "ol";
      if (list !== want) { closeList(); list = want; out.push(`<${want}>`); }
      out.push(`<li>${inline((li ?? oli)![1])}</li>`);
    }
    else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); closeList(); out.push("<hr>"); }
    else if (line.trim() === "") { flushPara(); closeList(); }
    else { closeList(); para.push(line.trim()); }
  }
  flushPara(); closeList();
  return out.join("\n");
}

export function printPage(title: string, md: string, kind: "resume" | "cover_letter" = "resume"): string {
  const compact = kind === "resume";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: Letter; margin: ${compact ? "0.55in 0.6in" : "0.9in 1in"}; }
  body { font: ${compact ? "10.5pt/1.32" : "11pt/1.5"} "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; max-width: 7.5in; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 20pt; margin: 0 0 2pt; letter-spacing: -0.01em; }
  h1 + p { margin-top: 0; color: #444; font-size: 9.5pt; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #999; padding-bottom: 1.5pt; margin: ${compact ? "9pt 0 4pt" : "14pt 0 6pt"}; }
  h3 { font-size: 10.5pt; margin: ${compact ? "5pt 0 1pt" : "8pt 0 2pt"}; }
  p { margin: ${compact ? "2.5pt 0" : "6pt 0"}; } ul, ol { margin: 1pt 0 ${compact ? "4pt" : "8pt"}; padding-left: 16pt; } li { margin: ${compact ? "0.5pt 0" : "2pt 0"}; }
  h2, h3 { break-after: avoid; } li, p { break-inside: avoid; }
  a { color: inherit; } hr { border: 0; border-top: 1px solid #ccc; margin: 10pt 0; }
  .bar { position: fixed; top: 0; right: 0; padding: 8px 12px; background: #fff; border: 1px solid #ddd; border-radius: 0 0 0 8px; font-size: 12px; }
  .bar button { font: inherit; cursor: pointer; }
  @media print { .bar { display: none; } body { margin: 0; } }
</style></head><body>
<div class="bar"><button onclick="print()">Print / Save as PDF</button></div>
${mdToHtml(md)}
</body></html>`;
}

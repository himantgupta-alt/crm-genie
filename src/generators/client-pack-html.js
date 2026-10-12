// Builds one A4 document per client-pack entry (docs/client-pack/pack.json), ready to print to PDF:
// cover, document control, contents, then numbered sections with numbered figures. Markdown is converted here
// in Node; diagrams are drawn in the browser by mermaid loaded from node_modules, so nothing comes from a CDN.
// Used by render-client-pack.ps1.
//
//   node src/generators/client-pack-html.js <outDir>
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Marked } = require('marked');
const P = require('../paths');

const SRC = path.join(P.ROOT, 'docs', 'client-pack');
const OUT = process.argv[2] || path.join(SRC, '.html');
const MERMAID = pathToFileURL(require.resolve('mermaid/dist/mermaid.min.js')).href;
const pack = JSON.parse(fs.readFileSync(path.join(SRC, 'pack.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date().toISOString().slice(0, 10);
const longDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// Ascendion footer mark, from the slide layout in presentations/Salesforce-Exit-Approach.pptx.
const svgUrl = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const LOGO = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 78.1 82.45"><path d="M39.05 0 22.34 3.55 0 82.45 19.11 78.38 25.8 54.11 39.05 51.29 39.05 34.79 30.71 36.54 39.05 6.4Z"/><path d="M39.05 0 39.05 6.4 47.4 36.54 39.05 34.79 39.05 51.29 52.3 54.11 58.99 78.38 78.1 82.45 55.76 3.55Z" fill="#616161"/></svg>');
const LINE = '<svg class="asc-line" viewBox="0 0 12190038 170257" preserveAspectRatio="none"><path d="M12190038 161210L12188267 170195L11819153 169815L11088330 11895L10337133 170258L0 170131L1772 161147L10322201 161337L11091304 0L11831048 160894Z"/></svg>';

const CSS = `
@page { size: A4; margin: 20mm 18mm 22mm 20mm;
  @bottom-left { content: counter(page); font: 8.5pt "Segoe UI", sans-serif; color: #444; vertical-align: top; padding-top: 6mm; }
  @bottom-center { content: "Ascendion Confidential"; font: 8.5pt "Segoe UI", sans-serif; color: #444; vertical-align: top; padding-top: 6mm; }
  @bottom-right { content: ""; background: ${LOGO} no-repeat right 6mm / 3.6mm auto; }
}
@page cover { margin: 0; @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; background: none; } }
* { box-sizing: border-box; }
html, body { margin: 0; font-family: "Segoe UI", Aptos, Calibri, sans-serif; color: #111; background: #fff; font-size: 10pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { page: cover; width: 210mm; height: 297mm; padding: 38mm 22mm 30mm 24mm; position: relative; display: flex; flex-direction: column; break-after: page; }
.cover .kicker { font-size: 10pt; letter-spacing: 2px; text-transform: uppercase; color: #444; margin-bottom: 10mm; }
.cover h1 { font-size: 30pt; line-height: 1.12; margin: 0 0 5mm; font-weight: 700; letter-spacing: -0.5px; border: 0; }
.cover .sub { font-size: 14pt; color: #333; margin-bottom: 14mm; }
.cover .rule { width: 34mm; height: 2.2mm; background: #111; margin-bottom: 12mm; }
.cover dl { display: grid; grid-template-columns: 38mm 1fr; gap: 2.5mm 6mm; font-size: 10.5pt; margin: 0; }
.cover dt { color: #555; } .cover dd { margin: 0; }
.cover .foot { margin-top: auto; font-size: 9pt; color: #444; }
.cover .asc-line { position: absolute; left: 0; bottom: 14mm; width: 210mm; height: 4.7mm; }
.cover .logo { position: absolute; right: 24mm; bottom: 22mm; width: 9mm; height: 9.5mm; background: ${LOGO} no-repeat center / contain; }
.front { break-after: page; }
h1.part { font-size: 17pt; margin: 0 0 5mm; padding-bottom: 2mm; border-bottom: 1.5px solid #111; }
h2 { font-size: 14.5pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #111; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 6mm 0 2mm; break-after: avoid; }
h2 + h3 { margin-top: 3mm; }
h4 { font-size: 10pt; margin: 4mm 0 1.5mm; break-after: avoid; }
p { margin: 0 0 2.5mm; } ul, ol { margin: 0 0 3mm; padding-left: 6mm; } li { margin-bottom: 1mm; }
table { border-collapse: collapse; width: 100%; margin: 2mm 0 4mm; font-size: 8.8pt; line-height: 1.35; }
thead { display: table-header-group; } tr { break-inside: avoid; }
th { text-align: left; padding: 1.6mm 2.2mm; font-weight: 600; background: #EDEDED; border-top: 1.2px solid #111; border-bottom: 1.2px solid #111; }
td { padding: 1.5mm 2.2mm; border-bottom: 0.6px solid #BBB; vertical-align: top; overflow-wrap: break-word; }
table.control td:first-child { width: 42mm; color: #444; }
code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 0.88em; background: #F3F3F3; padding: 0 0.6mm; overflow-wrap: anywhere; }
.agent { border-left: 1.2mm solid #111; background: #F6F6F6; padding: 3mm 4mm 1mm; margin: 0 0 4mm; break-inside: avoid; }
.agent p { margin-bottom: 1.5mm; } .agent ul { margin-bottom: 2.5mm; }
figure { margin: 3mm 0 5mm; break-inside: avoid; text-align: center; }
figure .mermaid { display: flex; justify-content: center; }
figure svg { max-width: 100% !important; max-height: 205mm; height: auto; }
figcaption { font-size: 8.8pt; color: #333; margin-top: 2mm; font-style: italic; }
figcaption b { font-style: normal; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { display: flex; gap: 3mm; padding: 0.9mm 0; border-bottom: 0.6px dotted #999; margin: 0; }
.toc li.l3 { padding-left: 8mm; font-size: 9pt; color: #333; }
.toc .figs li { font-size: 9pt; }
.src { font-size: 8.5pt; color: #555; }
`;

// Markdown to HTML. Relative links (ADRs, repo files) become plain text: the PDF stands alone.
const toHtml = (md) => {
  const m = new Marked({ gfm: true });
  m.use({ renderer: {
    code({ text, lang }) { return lang === 'mermaid' ? `<figure><pre class="mermaid">${esc(text)}</pre></figure>\n` : false; },
    link({ href, tokens }) { const t = this.parser.parseInline(tokens); return /^https?:/.test(href) ? `<a href="${esc(href)}">${t}</a>` : t; },
  } });
  return m.parse(md);
};

// Numbers figures (caption from a following "Figure: ..." paragraph, else the nearest heading), adds heading
// ids, and collects the contents.
const structure = (html) => {
  const toc = [], figs = [];
  let last = '', h = 0, f = 0;
  html = html.replace(/<h([234])>([\s\S]*?)<\/h\1>|<figure>([\s\S]*?)<\/figure>\s*(?:<p>Figure: ([\s\S]*?)<\/p>)?/g, (all, lvl, text, body, cap) => {
    if (lvl) { const id = `s${++h}`; last = text.replace(/^[\d.]+\s*/, '').replace(/<[^>]+>/g, ''); if (lvl !== '4') toc.push({ lvl: +lvl, id, text }); return `<h${lvl} id="${id}">${text}</h${lvl}>`; }
    const caption = cap || last; f++; figs.push(caption);
    return `<figure>${body}<figcaption><b>Figure ${f}.</b> ${caption}</figcaption></figure>`;
  });
  return { html, toc, figs };
};

for (const d of pack.documents) {
  let md = fs.readFileSync(path.join(P.ROOT, d.source), 'utf8').replace(/^﻿/, '');
  md = md.replace(/^# .*\n+/, '').replace(/^Owner: .*\n+/m, '') // the title and stamp move to the cover and document control
    .replace(/^([^\n|#-][^\n]*):\n\n(```mermaid\n[\s\S]*?\n```)\n/gm, '$2\n\nFigure: $1\n'); // "Intro line:" before a diagram becomes its caption
  const { html, toc, figs } = structure(toHtml(md));
  const control = [
    ['Document', `${pack.module} - ${d.pdf}`], ['Subject', d.subtitle], ['Version', '1.0'], ['Date', today], ['Status', 'For review'],
    ['Owner', d.owner], ['Generated by', `<code>${esc(d.generator)}</code>`], ['Source', `<code>${esc(d.source)}</code>`],
    ['Source blueprint', `<code>${pack.blueprint}</code>`], ['Prepared by', 'Ascendion'], ['Classification', 'Ascendion Confidential'],
  ];
  const out = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(pack.module)} - ${esc(d.pdf)}</title><style>${CSS}</style>
<script src="${MERMAID}"></script></head><body>
<section class="cover">
  <div class="kicker">${esc(pack.module)} · Salesforce to Azure</div>
  <h1>${esc(d.title)}</h1>
  <div class="sub">${esc(d.subtitle)}</div>
  <div class="rule"></div>
  <dl><dt>Module</dt><dd>${esc(pack.module)}</dd><dt>Owner</dt><dd>${esc(d.owner)}</dd><dt>Version</dt><dd>1.0, for review</dd><dt>Date</dt><dd>${longDate}</dd></dl>
  <div class="foot"><b>Ascendion</b> Confidential</div>
  ${LINE}<div class="logo"></div>
</section>
<section class="front">
  <h1 class="part">Document control</h1>
  <table class="control"><tbody>${control.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>
  <h1 class="part" style="margin-top:10mm">Contents</h1>
  <div class="toc"><ol>${toc.map((t) => `<li class="l${t.lvl}">${t.text}</li>`).join('')}</ol></div>
  ${figs.length ? `<h1 class="part" style="margin-top:10mm">Figures</h1><div class="toc figs"><ol>${figs.map((c, i) => `<li>Figure ${i + 1}. ${c}</li>`).join('')}</ol></div>` : ''}
</section>
<main>${html}</main>
<script>
mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', flowchart: { htmlLabels: true }, themeVariables: { fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', noteBkgColor: '#F2F2F2', noteTextColor: '#111111', noteBorderColor: '#666666' } });
// Black and white: every colour the diagram sources set is turned into its grey equivalent.
const lum = (r, g, b) => { const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b); return l > 200 ? Math.max(l, 235) : l < 120 ? 0 : l; };
const greyHex = (src) => src.replace(/#([0-9a-fA-F]{6})\\b/g, (_, h) => { const v = lum(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4), 16)).toString(16).padStart(2, '0'); return '#' + v + v + v; });
const grey = (root) => root.querySelectorAll('svg *').forEach((el) => {
  const cs = getComputedStyle(el);
  for (const p of ['fill', 'stroke', 'color']) {
    const m = cs[p] && cs[p].match(/rgba?\\((\\d+), (\\d+), (\\d+)/); if (!m) continue;
    const v = lum(+m[1], +m[2], +m[3]); el.style.setProperty(p, 'rgb(' + v + ',' + v + ',' + v + ')', 'important');
  }
});
(async () => {
  let n = 0, failed = 0;
  for (const d of document.querySelectorAll('pre.mermaid')) {
    const box = document.createElement('div'); box.className = 'mermaid';
    try {
      // Every page is A4 portrait (172 mm = 650 CSS px of text width). A left-to-right flowchart too wide to read
      // at that width is drawn top-to-bottom instead.
      let src = greyHex(d.textContent);
      let { svg } = await mermaid.render('m' + n++, src); box.innerHTML = svg;
      let vb = box.querySelector('svg').viewBox.baseVal;
      if (vb && vb.width > 650 * 1.4 && vb.width / vb.height > 2.5 && /^\s*flowchart LR/.test(src)) {
        ({ svg } = await mermaid.render('m' + n++, src.replace(/^(\s*)flowchart LR/, '$1flowchart TB'))); box.innerHTML = svg;
      }
      d.replaceWith(box); grey(box);
      // Natural size, never enlarged: a small flowchart keeps body-sized text instead of filling the page.
      const s = box.querySelector('svg'); vb = s.viewBox.baseVal;
      if (vb && vb.width) { s.removeAttribute('width'); s.style.maxWidth = ''; s.style.width = Math.min(vb.width, 650) + 'px'; }
    }
    catch (e) { failed++; d.textContent = 'diagram error: ' + e.message; }
  }
  document.title = failed ? 'FAILED ' + failed : 'READY';
})();
</script></body></html>`;
  fs.writeFileSync(path.join(OUT, `${d.key}.html`), out);
}
fs.writeFileSync(path.join(OUT, 'names.json'), JSON.stringify(Object.fromEntries(pack.documents.map((d) => [d.key, `${pack.module} - ${d.pdf}`]))));
console.log(`${pack.documents.length} A4 documents -> ${OUT}`);

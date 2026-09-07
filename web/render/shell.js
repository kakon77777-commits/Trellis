function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function navLink(href,label,active){return `<a class="nav-link${active===href?' is-active':''}" href="${href}">${escapeHtml(label)}</a>`;}
function renderShell({title='Trellis',active='/',main='',context='',description='AI-first, relation-first social graph',semanticFacts=''}){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(description)}"><title>${escapeHtml(title)} · Trellis</title><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script></head><body><div class="app-shell"><nav class="side-nav" aria-label="Primary"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">T</span><span><strong>Trellis</strong><small>EveMissLab</small></span></a><div class="nav-stack">${navLink('/','Home',active)}${navLink('/discover','Discover',active)}<a class="nav-link" href="/discover#communities">Communities</a></div><div class="nav-foot"><a href="/.well-known/trellis.json">Machine surface</a><span>Public v0.1</span></div></nav><main class="main-surface" id="main-content">${main}</main><aside class="context-panel" aria-label="Context">${context||'<section class="context-card"><p class="eyebrow">Context</p><h2>Public Trellis</h2><p>Viewer-safe social context appears here. No advertising, no hidden graph inference.</p></section>'}</aside></div>${semanticFacts}</body></html>`;
}
module.exports={escapeHtml,renderShell};

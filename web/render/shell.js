function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function navLink(href,label,active){return `<a class="nav-link${active===href?' is-active':''}" href="${href}">${escapeHtml(label)}</a>`;}
function renderShell({title='Trellis',active='/',lead='',main='',context='',description='AI-first, relation-first social graph',semanticFacts=''}){
  const defaultContext='<section class="context-card context-lens"><p class="eyebrow">Context Lens</p><h2>Public view</h2><p>Viewer-safe social context appears here. No advertising, no hidden graph inference.</p></section>';
  const contextHtml=context||defaultContext;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(description)}"><title>${escapeHtml(title)} · Trellis</title><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script></head><body><div class="app-shell"><nav class="side-nav" aria-label="Primary"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">T</span><span><strong>Trellis</strong><small>EveMissLab</small></span></a><div class="nav-stack">${navLink('/','Home',active)}${navLink('/discover','Discover',active)}<a class="nav-link" href="/discover#communities">Communities</a></div><div class="nav-foot"><span>Public surface</span><a href="/.well-known/trellis.json">Machine API ↗</a></div></nav><main class="main-surface" id="main-content"><div class="main-primary"><div class="page-lead" data-page-lead>${lead}</div><aside class="mobile-context-panel" aria-label="Context Lens"><details class="mobile-context-drawer"><summary>Context Lens</summary><div class="mobile-context-content">${contextHtml}</div></details></aside><div class="page-body" data-page-body>${main}</div></div><aside class="context-panel desktop-context-panel" aria-label="Context Lens">${contextHtml}</aside></main></div>${semanticFacts}</body></html>`;
}
module.exports={escapeHtml,renderShell};

const {escapeHtml,renderShell}=require('./shell');
const {renderSemanticFactMarkers}=require('./semantic-facts');
function renderReference(ref){if(!ref)return'';if(ref.status==='unavailable')return'<section class="reference-card"><p>Referenced publication is unavailable.</p></section>';if(ref.status==='withdrawn')return `<section class="reference-card"><p>Referenced publication withdrawn: <span class="mono">${escapeHtml(ref.publication_id)}</span></p></section>`;return `<section class="reference-card"><p>${escapeHtml(ref.preview??'')}</p></section>`;}
function renderPublicationPage(surface){
  const body=surface.content?`<div class="publication-body">${escapeHtml(surface.content.body)}</div>`:'<div class="publication-body withdrawn">Withdrawn publication</div>';
  const replies=(surface.visible_replies??[]).map(r=>`<li><a href="/publications/${encodeURIComponent(r.publication_id)}">${escapeHtml(r.publication_id)}</a><span>by ${escapeHtml(r.author_actor_id)}</span></li>`).join('');
  const reactions=Object.entries(surface.reaction_summary??{}).filter(([,n])=>n>0).map(([k,n])=>`<span class="pill">${escapeHtml(k)} ${escapeHtml(n)}</span>`).join('');
  const main=`<article class="publication-detail"><header><p class="eyebrow">${escapeHtml(surface.publication_type)}</p><h1>${escapeHtml(surface.publication_id)}</h1><a href="/actors/${encodeURIComponent(surface.author_actor_id)}">${escapeHtml(surface.author_actor_id)}</a></header>${renderReference(surface.reference_context)}${body}${reactions?`<div class="pill-row">${reactions}</div>`:''}<section><div class="section-head"><h2>Replies</h2><span>${escapeHtml(surface.visible_reply_count)}</span></div>${replies?`<ul class="reply-list">${replies}</ul>`:'<p class="muted">No visible replies.</p>'}</section></article>`;
  const context=`<section class="context-card"><p class="eyebrow">Publication state</p><h2>${escapeHtml(surface.lifecycle)}</h2><dl><div><dt>Visibility</dt><dd>${escapeHtml(surface.visibility)}</dd></div><div><dt>Viewer</dt><dd>${escapeHtml(surface.viewer_scope)}</dd></div><div><dt>Projection</dt><dd>${escapeHtml(surface.projection_version)}</dd></div></dl></section>`;
  return renderShell({title:surface.publication_id,main,context,semanticFacts:renderSemanticFactMarkers('publication',surface)});
}
module.exports={renderPublicationPage};

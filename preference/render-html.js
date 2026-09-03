function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function renderPreferenceHtml(surface){
  const items=(surface.preferences??[]).map(p=>`<li data-preference-id="${escapeHtml(p.preference_id)}"><span>${escapeHtml(p.preference_type)}</span><span>${escapeHtml(p.target_ref)}</span></li>`).join('');
  const bookmarks=(surface.bookmarks??[]).map(b=>`<li data-bookmark="${escapeHtml(b.preference_id)}"><a href="${escapeHtml(b.detail_ref)}">${escapeHtml(b.publication_id)}</a></li>`).join('');
  return `<section data-owner="${escapeHtml(surface.owner_actor_id)}"><ul class="preferences">${items}</ul><ul class="bookmarks">${bookmarks}</ul></section>`;
}
module.exports={renderPreferenceHtml};

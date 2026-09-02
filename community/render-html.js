function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderCommunityHtml(surface) {
  if (!surface) return '<!doctype html><html><body><h1>Community not found</h1></body></html>';
  const p = surface.presentation ?? {};
  const title = p.name?.value ?? surface.community_id;
  const description = p.description?.value ? `<section><h2>Description</h2><p>${escapeHtml(p.description.value)}</p></section>` : '';
  const members = surface.membership?.visible_members ?? [];
  const memberItems = members.map(member => `<li>${escapeHtml(member.actor_id)}</li>`).join('');
  const relationships = surface.local_graph?.visible_scoped_relationships ?? [];
  const graphItems = relationships.map(rel => `<li>${escapeHtml(rel.relationship_type)}: ${escapeHtml(rel.source_entity_id)} → ${escapeHtml(rel.target_entity_id)}</li>`).join('');
  const actions = (surface.available_actions ?? []).map(action => `<li>${escapeHtml(action)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<header><h1>${escapeHtml(title)}</h1><p class="community-id">${escapeHtml(surface.community_id)}</p><p>${escapeHtml(surface.discoverability)}</p></header>
${description}
<section><h2>Members</h2><p>${members.length} visible members</p><ul>${memberItems}</ul></section>
<section><h2>Local Graph</h2><p>${relationships.length} visible scoped relationships</p><ul>${graphItems}</ul></section>
<section><h2>Available Actions</h2><ul>${actions}</ul></section>
<section><h2>Execution Authority</h2><p>implied by membership: ${escapeHtml(surface.execution_authority?.implied_by_membership ?? false)}</p><p>implied by social role: ${escapeHtml(surface.execution_authority?.implied_by_social_role ?? false)}</p></section>
<footer><small>${escapeHtml(surface.viewer_scope)} · ${escapeHtml(surface.projection_version)}</small></footer>
</body>
</html>`;
}

module.exports = { escapeHtml, renderCommunityHtml };

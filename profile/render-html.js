function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderClaim(label, claim) {
  if (!claim) return '';
  return `<section><h2>${escapeHtml(label)}</h2><p>${escapeHtml(claim.value)}</p><small>${escapeHtml(claim.provenance_class)}</small></section>`;
}

function renderList(label, values) {
  if (!values || values.length === 0) return '';
  const items = values.map(item => `<li>${escapeHtml(item.value)} <small>${escapeHtml(item.provenance_class)}</small></li>`).join('');
  return `<section><h2>${escapeHtml(label)}</h2><ul>${items}</ul></section>`;
}

function renderRuntimeBindings(bindings) {
  if (!bindings || bindings.length === 0) return '';
  const items = bindings.map(binding => {
    const runtime = escapeHtml(binding.runtime_id ?? '');
    const provider = escapeHtml(binding.provider ?? '');
    const model = escapeHtml(binding.model ?? '');
    return `<li><span class="runtime-id">${runtime}</span> <span class="provider">${provider}</span> <span class="model">${model}</span></li>`;
  }).join('');
  return `<section><h2>Runtime Bindings</h2><ul>${items}</ul></section>`;
}

function renderRelationships(social) {
  const relationships = social?.visible_relationships ?? [];
  if (relationships.length === 0) {
    return '<section><h2>Social</h2><p>0 visible relationships</p></section>';
  }
  const items = relationships.map(rel => `
    <li data-relationship-id="${escapeHtml(rel.relationship_id)}">
      <span>${escapeHtml(rel.relationship_type)}</span>
      <span>${escapeHtml(rel.source_entity_id)}</span>
      <span>${escapeHtml(rel.target_entity_id)}</span>
    </li>`).join('');
  return `<section><h2>Social</h2><p>${relationships.length} visible relationships</p><ul>${items}</ul></section>`;
}

function renderProfileHtml(profile) {
  if (!profile) return '<!doctype html><html><body><h1>Actor not found</h1></body></html>';
  const p = profile.presentation ?? {};
  const title = p.display_name?.value ?? profile.actor_id;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="actor-id">${escapeHtml(profile.actor_id)}</p>
    <p class="entity-kind">${escapeHtml(profile.entity_kind)}</p>
  </header>
  ${renderClaim('Bio', p.bio)}
  ${renderClaim('Website', p.website)}
  ${renderClaim('Avatar URL', p.avatar_url)}
  ${renderList('Aliases', p.aliases)}
  ${renderList('External Links', p.external_links)}
  ${renderRuntimeBindings(profile.runtime_bindings)}
  ${renderRelationships(profile.social)}
  <footer><small>${escapeHtml(profile.viewer_scope)} · ${escapeHtml(profile.projection_version)}</small></footer>
</body>
</html>`;
}

module.exports = { escapeHtml, renderProfileHtml };

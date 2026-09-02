function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderHistory(history = []) {
  if (history.length === 0) return '<section><h2>History</h2><p>No visible history</p></section>';
  const items = history.map(item => {
    const payload = escapeHtml(JSON.stringify(item.payload ?? {}));
    return `<li data-event-id="${escapeHtml(item.event_id)}"><strong>${escapeHtml(item.type)}</strong> <span>${escapeHtml(item.actor_id)}</span> <time>${escapeHtml(item.occurred_at)}</time><code>${payload}</code></li>`;
  }).join('');
  return `<section><h2>History</h2><ul>${items}</ul></section>`;
}

function renderActions(actions = []) {
  if (actions.length === 0) return '<section><h2>Available Actions</h2><p>None</p></section>';
  return `<section><h2>Available Actions</h2><ul>${actions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul></section>`;
}

function renderRelationshipHtml(detail) {
  if (!detail) return '<!doctype html><html><body><h1>Relationship not found</h1></body></html>';
  const source = detail.source_actor ?? {};
  const target = detail.target_actor ?? {};
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(detail.relationship_type)} · ${escapeHtml(detail.relationship_id)}</title></head>
<body>
  <header>
    <h1>${escapeHtml(detail.relationship_type)}</h1>
    <p class="relationship-id">${escapeHtml(detail.relationship_id)}</p>
    <p><a href="${escapeHtml(source.profile_ref ?? '#')}">${escapeHtml(source.actor_id ?? '')}</a> → <a href="${escapeHtml(target.profile_ref ?? '#')}">${escapeHtml(target.actor_id ?? '')}</a></p>
  </header>
  <section><h2>State</h2><p>${escapeHtml(detail.lifecycle)}</p><p>visibility: ${escapeHtml(detail.visibility)}</p><p>scope: ${escapeHtml(detail.scope_ref ?? 'global')}</p></section>
  <section><h2>Execution Authority</h2><p>implied by social relationship: ${escapeHtml(detail.execution_authority?.implied_by_relationship ?? false)}</p></section>
  ${renderActions(detail.available_actions)}
  ${renderHistory(detail.history)}
  <footer><small>${escapeHtml(detail.viewer_scope)} · ${escapeHtml(detail.projection_version)}</small></footer>
</body>
</html>`;
}

module.exports = { escapeHtml, renderRelationshipHtml };

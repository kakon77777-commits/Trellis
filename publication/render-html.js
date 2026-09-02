function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderReference(context) {
  if (!context) return '';
  if (context.status === 'unavailable') return '<section><h2>Reference</h2><p>Unavailable publication</p></section>';
  if (context.status === 'withdrawn') return `<section><h2>Reference</h2><p>Withdrawn publication ${escapeHtml(context.publication_id)}</p></section>`;
  return `<section><h2>Reference</h2><p>${escapeHtml(context.preview ?? '')}</p></section>`;
}

function renderPublicationHtml(surface) {
  if (!surface) return '<!doctype html><html><body><h1>Publication not found</h1></body></html>';
  const body = surface.content ? `<section><h2>Content</h2><p>${escapeHtml(surface.content.body)}</p></section>` : '<section><h2>Content</h2><p>Withdrawn</p></section>';
  const replies = (surface.visible_replies ?? []).map(reply => `<li>${escapeHtml(reply.publication_id)} by ${escapeHtml(reply.author_actor_id)} (${escapeHtml(reply.lifecycle)})</li>`).join('');
  const actions = (surface.available_actions ?? []).map(action => `<li>${escapeHtml(action)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(surface.publication_id)}</title></head>
<body>
<header><h1>${escapeHtml(surface.publication_id)}</h1><p>${escapeHtml(surface.author_actor_id)} · ${escapeHtml(surface.publication_type)} · ${escapeHtml(surface.lifecycle)}</p></header>
${body}
${renderReference(surface.reference_context)}
<section><h2>Replies</h2><p>${escapeHtml(surface.visible_reply_count)} visible replies</p><ul>${replies}</ul></section>
<section><h2>Available Actions</h2><ul>${actions}</ul></section>
<footer><small>${escapeHtml(surface.viewer_scope)} · ${escapeHtml(surface.projection_version)}</small></footer>
</body>
</html>`;
}

module.exports = { escapeHtml, renderPublicationHtml };

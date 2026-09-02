function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function actorLabel(candidate) {
  return candidate.profile?.presentation?.display_name?.value ?? candidate.actor_id;
}

function communityLabel(candidate) {
  return candidate.community?.presentation?.name?.value ?? candidate.community_id;
}

function reasonItems(reasons = []) {
  return reasons.map(reason => `<li>${escapeHtml(reason.type)}</li>`).join('');
}

function renderDiscoveryHtml(surface) {
  if (!surface) return '<!doctype html><html><body><h1>Discovery unavailable</h1></body></html>';
  const actors = surface.actor_discovery?.candidates ?? [];
  const communities = surface.community_discovery?.candidates ?? [];
  const actorItems = actors.map(candidate => `
    <li data-actor-id="${escapeHtml(candidate.actor_id)}">
      <strong>${escapeHtml(actorLabel(candidate))}</strong>
      <span>score ${escapeHtml(candidate.score)}</span>
      <ul>${reasonItems(candidate.reasons)}</ul>
    </li>`).join('');
  const communityItems = communities.map(candidate => `
    <li data-community-id="${escapeHtml(candidate.community_id)}">
      <strong>${escapeHtml(communityLabel(candidate))}</strong>
      <span>score ${escapeHtml(candidate.score)}</span>
      <ul>${reasonItems(candidate.reasons)}</ul>
    </li>`).join('');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Trellis Discovery</title></head>
<body>
<header><h1>Discovery</h1><p>Subject: ${escapeHtml(surface.subject_actor_id)}</p></header>
<section><h2>Related Actors</h2><ul>${actorItems}</ul></section>
<section><h2>Related Communities</h2><ul>${communityItems}</ul></section>
<footer><small>${escapeHtml(surface.viewer_scope)} · ${escapeHtml(surface.projection_version)}</small></footer>
</body>
</html>`;
}

module.exports = { escapeHtml, renderDiscoveryHtml };

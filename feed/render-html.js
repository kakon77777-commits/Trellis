function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function publicationHtml(item) {
  const body = item.publication?.content?.body ?? '';
  return `<article data-feed-item-id="${escapeHtml(item.feed_item_id)}" data-item-type="publication"><a href="/publications/${encodeURIComponent(item.source_ref)}">${escapeHtml(item.source_ref)}</a><div class="publication-body">${escapeHtml(body)}</div></article>`;
}

function activityHtml(item) {
  const activity = item.activity ?? {};
  const details = Object.entries(activity)
    .map(([key, value]) => `<span data-field="${escapeHtml(key)}">${escapeHtml(value)}</span>`)
    .join('');
  return `<article data-feed-item-id="${escapeHtml(item.feed_item_id)}" data-item-type="social_activity">${details}</article>`;
}

function renderFeedHtml(surface) {
  if (!surface) return '';
  const items = (surface.items ?? []).map(item =>
    item.item_type === 'publication' ? publicationHtml(item) : activityHtml(item)
  ).join('');
  return `<main data-feed-type="${escapeHtml(surface.feed_type)}" data-snapshot-ref="${escapeHtml(surface.snapshot_ref)}">${items}</main>`;
}

module.exports = { renderFeedHtml, escapeHtml };

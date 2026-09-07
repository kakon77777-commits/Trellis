function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rankingHtml(item) {
  if (!item?.score) return '';
  const reasons = (item.ranking_reasons ?? []).map(reason =>
    `<span data-ranking-reason="${escapeHtml(reason.type)}" data-component="${escapeHtml(reason.component)}" data-points="${escapeHtml(reason.points)}"></span>`
  ).join('');
  return `<div class="feed-ranking" data-total-points="${escapeHtml(item.score.total_points)}">${reasons}</div>`;
}

function publicationHtml(item) {
  const body = item.publication?.content?.body ?? '';
  return `<article data-feed-item-id="${escapeHtml(item.feed_item_id)}" data-item-type="publication"><a href="/publications/${encodeURIComponent(item.source_ref)}">${escapeHtml(item.source_ref)}</a><div class="publication-body">${escapeHtml(body)}</div>${rankingHtml(item)}</article>`;
}

function activityHtml(item) {
  const activity = item.activity ?? {};
  const details = Object.entries(activity)
    .map(([key, value]) => `<span data-field="${escapeHtml(key)}">${escapeHtml(value)}</span>`)
    .join('');
  return `<article data-feed-item-id="${escapeHtml(item.feed_item_id)}" data-item-type="social_activity">${details}${rankingHtml(item)}</article>`;
}

function renderFeedHtml(surface) {
  if (!surface) return '';
  const items = (surface.items ?? []).map(item =>
    item.item_type === 'publication' ? publicationHtml(item) : activityHtml(item)
  ).join('');
  const rankingRef = surface.ranking_reference_time ? ` data-ranking-reference-time="${escapeHtml(surface.ranking_reference_time)}"` : '';
  return `<main data-feed-type="${escapeHtml(surface.feed_type)}" data-algorithm-ref="${escapeHtml(surface.algorithm_ref)}" data-snapshot-ref="${escapeHtml(surface.snapshot_ref)}"${rankingRef}>${items}</main>`;
}

module.exports = { renderFeedHtml, escapeHtml, rankingHtml };

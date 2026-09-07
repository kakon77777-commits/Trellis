const {escapeHtml}=require('./shell');
const LABELS=Object.freeze({
  self_publication:'Your publication',subscribed_actor:'Subscribed actor',followed_actor:'Followed actor',community_source:'Community source',
  subject_involved_activity:'Activity involving you',subscribed_actor_activity:'Subscribed actor activity',followed_actor_activity:'Followed actor activity',community_activity:'Community activity',
  recent_1h:'Published within 1 hour',recent_6h:'Published within 6 hours',recent_24h:'Published within 24 hours',recent_72h:'Published within 72 hours',recent_7d:'Published within 7 days',recent_30d:'Published within 30 days',older_than_30d:'Older than 30 days',
  not_seen_before:'Not seen before',seen_before:'Seen before',opened_before:'Opened before'
});
function renderRankingExplanation(item){
  const total=item?.score?.total_points;
  const reasons=Array.isArray(item?.ranking_reasons)?item.ranking_reasons:[];
  const rows=reasons.map(reason=>{
    const code=String(reason.type??''); const points=Number(reason.points);
    const label=LABELS[code]??code;
    return `<li data-reason-code="${escapeHtml(code)}" data-reason-points="${escapeHtml(points)}"><span>${escapeHtml(label)}</span><strong>${points>=0?'+':''}${escapeHtml(points)}</strong></li>`;
  }).join('');
  return `<section class="context-card ranking-explanation" data-total-points="${escapeHtml(total)}"><p class="eyebrow">Why am I seeing this?</p><h2>Backend ranking explanation</h2><ul class="reason-list">${rows}</ul><p class="score-total">Total <strong>${escapeHtml(total)}</strong></p></section>`;
}
module.exports={LABELS,renderRankingExplanation};

const { escapeHtml } = require('./shell');

function edgeFact(edge) {
  if (!edge) return null;
  return {
    relationship_id: edge.relationship_id,
    relationship_type: edge.relationship_type,
    source_entity_id: edge.source_entity_id,
    target_entity_id: edge.target_entity_id
  };
}

function renderGraphList(edges = [], { title = 'Visible relationships', idPrefix = 'graph', idAttribute = 'data-graph-fallback-id' } = {}) {
  const items = edges.map((edge, index) => {
    const fact = edgeFact(edge);
    if (!fact) return '';
    const id = fact.relationship_id ?? `${idPrefix}:${index}`;
    return `<li ${idAttribute}="${escapeHtml(id)}"><strong>${escapeHtml(fact.relationship_type)}</strong>: <span class="mono">${escapeHtml(fact.source_entity_id)} → ${escapeHtml(fact.target_entity_id)}</span></li>`;
  }).join('');
  return `<div class="graph-list"><h3>${escapeHtml(title)}</h3><ul>${items}</ul></div>`;
}

module.exports = { edgeFact, renderGraphList };

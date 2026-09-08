const { escapeHtml } = require('./shell');

function renderStructuralSpine({ position = 'middle' } = {}) {
  return `<span class="trellis-spine trellis-spine-${escapeHtml(position)}" aria-hidden="true"></span>`;
}

function renderSemanticEdge(edge, { sourceLabel, targetLabel, directed = false } = {}) {
  if (!edge) return '';
  const source = sourceLabel ?? edge.source_entity_id;
  const target = targetLabel ?? edge.target_entity_id;
  return `<div class="semantic-edge" data-edge-id="${escapeHtml(edge.relationship_id ?? '')}" data-source-id="${escapeHtml(edge.source_entity_id)}" data-target-id="${escapeHtml(edge.target_entity_id)}" data-relation-type="${escapeHtml(edge.relationship_type)}"${directed ? ' data-directed="true"' : ''}><span class="graph-node">${escapeHtml(source)}</span><span class="graph-line">${escapeHtml(edge.relationship_type)}${directed ? ' →' : ''}</span><span class="graph-node">${escapeHtml(target)}</span></div>`;
}

module.exports = { renderStructuralSpine, renderSemanticEdge };

const { escapeHtml } = require('./shell');

function renderNodeBadge({ kind = 'node', label = '', href = null, meta = '' } = {}) {
  const mark = kind === 'community' ? '◇' : '●';
  const content = `<span class="node-mark" aria-hidden="true">${mark}</span><span class="node-copy"><strong>${escapeHtml(label)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span>`;
  const attrs = `class="node-badge" data-node-kind="${escapeHtml(kind)}"`;
  return href ? `<a ${attrs} href="${escapeHtml(href)}">${content}</a>` : `<span ${attrs}>${content}</span>`;
}

module.exports = { renderNodeBadge };

const { escapeHtml } = require('./shell');
const { renderRankingExplanation } = require('./context-panel');

function row([label, value]) {
  return `<div class="context-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderContextLens({
  label = 'Context Lens',
  title = 'Public view',
  summaryRows = [],
  inspectionRows = [],
  machineHref = null,
  machineLabel = 'Machine surface',
  rankingItem = null
} = {}) {
  const summary = summaryRows.length
    ? `<dl class="context-summary">${summaryRows.map(row).join('')}</dl>`
    : '';
  const inspection = inspectionRows.length
    ? `<details class="context-inspection"><summary>Inspect context</summary><dl>${inspectionRows.map(row).join('')}</dl></details>`
    : '';
  const machine = machineHref
    ? `<a class="context-machine-link" href="${escapeHtml(machineHref)}">${escapeHtml(machineLabel)} ↗</a>`
    : '';
  const ranking = rankingItem ? renderRankingExplanation(rankingItem) : '';
  return `<section class="context-card context-lens"><p class="eyebrow">${escapeHtml(label)}</p><h2>${escapeHtml(title)}</h2>${summary}${inspection}${machine}</section>${ranking}`;
}

module.exports = { renderContextLens };

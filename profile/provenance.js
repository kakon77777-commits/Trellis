function loadAuthorityReceipt(db, ref) {
  if (!ref) return null;
  const row = db.prepare('SELECT receipt_json FROM authority_receipts WHERE decision_id = ?').get(ref);
  return row ? JSON.parse(row.receipt_json) : null;
}

function classifyAssertionProvenance(event, authorityReceipt) {
  const refs = event.provenance_refs ?? [];
  if (refs.some(ref => String(ref).startsWith('external:'))) return 'external_attested';
  if (String(event.principal_id ?? '').startsWith('system:')) return 'system_observed';
  if (authorityReceipt && authorityReceipt.actor_id === event.actor_id) return 'self_declared';
  return 'authority_attested';
}

module.exports = { loadAuthorityReceipt, classifyAssertionProvenance };

function listPublicRelationships(db, disclosurePolicy = () => 'allow') {
  const rows = db.prepare(`
    SELECT * FROM relationships_current
    WHERE visibility = 'public'
    ORDER BY relationship_id
  `).all();

  return rows.filter(row => {
    try {
      return disclosurePolicy(row) === 'allow';
    } catch {
      return false;
    }
  });
}

module.exports = { listPublicRelationships };

const { normalizeReactionRow, resolveReadableActiveTarget } = require('./read-policy');

function targetOrNull(input) {
  return resolveReadableActiveTarget(input);
}

function listVisibleReactions(input) {
  const target=targetOrNull(input);
  if (!target) return null;
  return input.db.prepare(`
    SELECT * FROM reactions_current
    WHERE publication_id = ? AND lifecycle = 'active'
    ORDER BY actor_id, reaction_id
  `).all(input.publicationId).map(normalizeReactionRow).map(row=>({
    reaction_id:row.reaction_id,
    actor_id:row.actor_id,
    reaction_type:row.reaction_type,
    lifecycle:row.lifecycle
  }));
}

function loadReactionSummary(input) {
  const list=listVisibleReactions(input);
  if (list===null) return null;
  const counts=new Map();
  for (const row of list) counts.set(row.reaction_type,(counts.get(row.reaction_type)??0)+1);
  return Object.fromEntries([...counts.entries()].sort(([a],[b])=>a.localeCompare(b)));
}

function loadViewerReaction(input) {
  const target=targetOrNull(input);
  if (!target) return null;
  const actorId=input.viewerContext?.viewer_actor_id;
  if (!actorId) return null;
  const row=normalizeReactionRow(input.db.prepare(`
    SELECT * FROM reactions_current
    WHERE publication_id = ? AND actor_id = ?
  `).get(input.publicationId,actorId));
  if (!row) return null;
  return {
    reaction_id:row.reaction_id,
    actor_id:row.actor_id,
    reaction_type:row.reaction_type ?? null,
    lifecycle:row.lifecycle
  };
}

module.exports={listVisibleReactions,loadReactionSummary,loadViewerReaction};

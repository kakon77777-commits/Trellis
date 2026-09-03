const { deriveId } = require('../core/ids');

const REACTION_TYPES = Object.freeze(['like', 'love', 'celebrate', 'insightful', 'curious']);
const REACTION_POLICY_REF = 'trellis-reaction-policy:0.1';

function deriveReactionId(actorId, publicationId) {
  if (typeof actorId !== 'string' || actorId.length === 0) throw new TypeError('REACTION_ACTOR_INVALID');
  if (typeof publicationId !== 'string' || publicationId.length === 0) throw new TypeError('REACTION_PUBLICATION_INVALID');
  return deriveId('reaction', `${actorId}|${publicationId}`);
}

function isReactionType(value) {
  return REACTION_TYPES.includes(value);
}

module.exports = { REACTION_TYPES, REACTION_POLICY_REF, deriveReactionId, isReactionType };

const { InvalidTransitionError } = require('../core/errors');
const { foldEntity } = require('../entity/fold');
const { foldRelationship } = require('../relationship/fold');
const { resolveCommunityDiscoverability } = require('./fold');
const {
  proposeRelationship,
  activateRelationship,
  terminateRelationship
} = require('../relationship/service');

async function loadCommunityState(eventStore, communityId) {
  const history = await eventStore.readStream('entity', communityId);
  const entity = foldEntity(history);
  if (entity.lifecycle !== 'active' || entity.entity_kind !== 'community') {
    throw new InvalidTransitionError('COMMUNITY_NOT_ACTIVE');
  }
  return { history, discoverability: resolveCommunityDiscoverability(history) };
}

async function requestMembership(command, context) {
  const { discoverability } = await loadCommunityState(context.eventStore, command.community_id);
  const defaultVisibility = discoverability === 'private' ? 'scope_members' : 'public';
  return await proposeRelationship({
    ...command,
    source_entity_id: command.actor_id,
    target_entity_id: command.community_id,
    relationship_type: 'member_of',
    scope_ref: command.community_id,
    visibility: command.visibility ?? defaultVisibility
  }, context);
}

async function loadMembership(command, context) {
  const history = await context.eventStore.readStream('relationship', command.relationship_id);
  const state = foldRelationship(history);
  if (
    state.relationship_type !== 'member_of' ||
    state.target_entity_id !== command.community_id ||
    state.scope_ref !== command.community_id
  ) {
    throw new InvalidTransitionError('NOT_COMMUNITY_MEMBERSHIP');
  }
  return state;
}

async function approveMembership(command, context) {
  await loadMembership(command, context);
  return await activateRelationship(command, context);
}

async function leaveCommunity(command, context) {
  const state = await loadMembership(command, context);
  if (state.source_entity_id !== command.actor_id) throw new InvalidTransitionError('MEMBERSHIP_ACTOR_MISMATCH');
  return await terminateRelationship({ ...command, reason: command.reason ?? 'withdrawn' }, context);
}

async function removeMember(command, context) {
  await loadMembership(command, context);
  if (context.principalActorId !== command.community_id) {
    const { PolicyDeniedError } = require('../core/errors');
    throw new PolicyDeniedError();
  }
  return await terminateRelationship({ ...command, reason: command.reason ?? 'revoked' }, context);
}

module.exports = { requestMembership, approveMembership, leaveCommunity, removeMember };

const { InvalidTransitionError } = require('../core/errors');
const { foldEntity } = require('../entity/fold');
const { foldRelationship } = require('../relationship/fold');
const { resolveCommunityDiscoverability } = require('./fold');
const {
  proposeRelationship,
  activateRelationship,
  terminateRelationship
} = require('../relationship/service');

function loadCommunityState(eventStore, communityId) {
  const history = eventStore.readStream('entity', communityId);
  const entity = foldEntity(history);
  if (entity.lifecycle !== 'active' || entity.entity_kind !== 'community') {
    throw new InvalidTransitionError('COMMUNITY_NOT_ACTIVE');
  }
  return { history, discoverability: resolveCommunityDiscoverability(history) };
}

function requestMembership(command, context) {
  const { discoverability } = loadCommunityState(context.eventStore, command.community_id);
  const defaultVisibility = discoverability === 'private' ? 'scope_members' : 'public';
  return proposeRelationship({
    ...command,
    source_entity_id: command.actor_id,
    target_entity_id: command.community_id,
    relationship_type: 'member_of',
    scope_ref: command.community_id,
    visibility: command.visibility ?? defaultVisibility
  }, context);
}

function loadMembership(command, context) {
  const history = context.eventStore.readStream('relationship', command.relationship_id);
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

function approveMembership(command, context) {
  loadMembership(command, context);
  return activateRelationship(command, context);
}

function leaveCommunity(command, context) {
  const state = loadMembership(command, context);
  if (state.source_entity_id !== command.actor_id) throw new InvalidTransitionError('MEMBERSHIP_ACTOR_MISMATCH');
  return terminateRelationship({ ...command, reason: command.reason ?? 'withdrawn' }, context);
}

function removeMember(command, context) {
  loadMembership(command, context);
  if (context.principalActorId !== command.community_id) {
    const { PolicyDeniedError } = require('../core/errors');
    throw new PolicyDeniedError();
  }
  return terminateRelationship({ ...command, reason: command.reason ?? 'revoked' }, context);
}

module.exports = { requestMembership, approveMembership, leaveCommunity, removeMember };

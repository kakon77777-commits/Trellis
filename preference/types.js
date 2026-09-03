const { deriveId } = require('../core/ids');

const PREFERENCE_TYPES = Object.freeze([
  'bookmark_publication',
  'dismiss_feed_item',
  'not_interested_publication',
  'mute_actor'
]);
const FEED_ITEM_KINDS = Object.freeze(['publication','social_activity']);
const PREFERENCE_POLICY_REF = 'trellis-preference-policy:0.1';

function requireString(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(code);
  return value;
}
function isPreferenceType(value) { return PREFERENCE_TYPES.includes(value); }
function normalizePreferenceTarget(type, target={}) {
  if (!isPreferenceType(type)) throw new TypeError('PREFERENCE_TYPE_INVALID');
  if (type === 'bookmark_publication' || type === 'not_interested_publication') {
    return { target_kind:'publication', target_ref:requireString(target.publication_id,'PREFERENCE_PUBLICATION_INVALID'), target_item_kind:null };
  }
  if (type === 'mute_actor') {
    return { target_kind:'actor', target_ref:requireString(target.actor_id,'PREFERENCE_ACTOR_INVALID'), target_item_kind:null };
  }
  const itemKind=requireString(target.item_kind,'PREFERENCE_FEED_ITEM_KIND_INVALID');
  if (!FEED_ITEM_KINDS.includes(itemKind)) throw new TypeError('PREFERENCE_FEED_ITEM_KIND_INVALID');
  return { target_kind:'feed_item', target_ref:requireString(target.source_ref,'PREFERENCE_FEED_SOURCE_INVALID'), target_item_kind:itemKind };
}
function derivePreferenceId(ownerActorId, type, target) {
  requireString(ownerActorId,'PREFERENCE_OWNER_INVALID');
  const normalized=normalizePreferenceTarget(type,target);
  return deriveId('preference',`${ownerActorId}|${type}|${normalized.target_kind}|${normalized.target_item_kind ?? ''}|${normalized.target_ref}`);
}

module.exports={PREFERENCE_TYPES,FEED_ITEM_KINDS,PREFERENCE_POLICY_REF,isPreferenceType,normalizePreferenceTarget,derivePreferenceId};

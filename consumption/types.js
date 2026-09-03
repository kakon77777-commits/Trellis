const RETENTION_POLICY_REF='trellis-consumption:retention:v1';
const DEFAULT_RETENTION_DAYS=90;
const OBSERVATIONS=Object.freeze(['seen','opened']);
const TARGET_KINDS=Object.freeze(['publication','social_activity']);

function requireString(value,code){if(typeof value!=='string'||!value)throw new TypeError(code);return value;}
function normalizeConsumptionTarget(observation,target={}){
  if(!OBSERVATIONS.includes(observation)) throw new TypeError('CONSUMPTION_OBSERVATION_INVALID');
  if(target.publication_id!==undefined){
    return{target_kind:'publication',target_ref:requireString(target.publication_id,'CONSUMPTION_PUBLICATION_INVALID')};
  }
  if(target.social_activity_event_id!==undefined){
    if(observation!=='seen') throw new TypeError('CONSUMPTION_OPENED_TARGET_INVALID');
    return{target_kind:'social_activity',target_ref:requireString(target.social_activity_event_id,'CONSUMPTION_ACTIVITY_INVALID')};
  }
  throw new TypeError(observation==='opened'?'CONSUMPTION_OPENED_TARGET_INVALID':'CONSUMPTION_TARGET_INVALID');
}
function expiryFrom(now,days=DEFAULT_RETENTION_DAYS){
  const ms=Date.parse(now);if(!Number.isFinite(ms))throw new TypeError('CONSUMPTION_TIME_INVALID');
  return new Date(ms+days*24*60*60*1000).toISOString();
}
module.exports={RETENTION_POLICY_REF,DEFAULT_RETENTION_DAYS,OBSERVATIONS,TARGET_KINDS,normalizeConsumptionTarget,expiryFrom};

const { registerEntity } = require('../entity/service');

async function createCommunity(command, context) {
  const result = await registerEntity({
    ...command,
    entity_id: command.community_id ?? command.entity_id,
    entity_kind: 'community',
    actor_capable: true
  }, context);
  return { community_id: result.entity_id, receipt: result.receipt };
}

module.exports = { createCommunity };

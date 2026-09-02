function requiredString(command, field, prefix) {
  if (typeof command[field] !== 'string' || command[field].length === 0) {
    throw new TypeError(`${prefix}:${field}`);
  }
}

function validateRegisterEntityCommand(command) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_REGISTER_ENTITY_COMMAND');
  for (const field of ['command_id', 'idempotency_key', 'principal_id', 'entity_kind']) {
    requiredString(command, field, 'INVALID_REGISTER_ENTITY_COMMAND');
  }
  if (typeof command.actor_capable !== 'boolean') {
    throw new TypeError('INVALID_REGISTER_ENTITY_COMMAND:actor_capable');
  }
  if (command.entity_id != null && (typeof command.entity_id !== 'string' || command.entity_id.length === 0)) {
    throw new TypeError('INVALID_REGISTER_ENTITY_COMMAND:entity_id');
  }
  return command;
}

function validateRegisterActorCommand(command) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_REGISTER_ACTOR_COMMAND');
  for (const field of ['command_id', 'idempotency_key', 'principal_id']) {
    requiredString(command, field, 'INVALID_REGISTER_ACTOR_COMMAND');
  }
  return command;
}

module.exports = { validateRegisterEntityCommand, validateRegisterActorCommand };

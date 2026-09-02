function validateRegisterActorCommand(command) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_REGISTER_ACTOR_COMMAND');
  for (const field of ['command_id', 'idempotency_key', 'principal_id']) {
    if (typeof command[field] !== 'string' || command[field].length === 0) {
      throw new TypeError(`INVALID_REGISTER_ACTOR_COMMAND:${field}`);
    }
  }
  return command;
}

module.exports = { validateRegisterActorCommand };

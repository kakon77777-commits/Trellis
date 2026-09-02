class VersionConflictError extends Error {
  constructor(message = 'VERSION_CONFLICT') {
    super(message);
    this.code = 'VERSION_CONFLICT';
  }
}

class IdempotencyConflictError extends Error {
  constructor(message = 'IDEMPOTENCY_CONFLICT') {
    super(message);
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

class InvalidTransitionError extends Error {
  constructor(message = 'INVALID_TRANSITION') {
    super(message);
    this.code = 'INVALID_TRANSITION';
  }
}

class PolicyDeniedError extends Error {
  constructor(message = 'POLICY_DENIED') {
    super(message);
    this.code = 'POLICY_DENIED';
  }
}

module.exports = {
  VersionConflictError,
  IdempotencyConflictError,
  InvalidTransitionError,
  PolicyDeniedError
};

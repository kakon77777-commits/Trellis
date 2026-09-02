function validateAuthorityRequest(request) {
  if (!request || typeof request !== 'object') throw new TypeError('INVALID_AUTHORITY_REQUEST');
  for (const field of ['command_id', 'principal_id', 'actor_id', 'requested_action']) {
    if (typeof request[field] !== 'string' || request[field].length === 0) {
      throw new TypeError(`INVALID_AUTHORITY_REQUEST:${field}`);
    }
  }
  return request;
}

module.exports = { validateAuthorityRequest };

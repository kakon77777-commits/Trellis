const { canonicalStringify } = require('../core/canonical-json');

function candidateId(candidate) {
  const id = candidate?.actor_id ?? candidate?.community_id ?? candidate?.entity_id;
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('DISCOVERY_CANDIDATE_ID_REQUIRED');
  return id;
}

function encodeCursor({ algorithm_ref, snapshot_ref, last_score, last_entity_id }) {
  if (typeof algorithm_ref !== 'string' || typeof snapshot_ref !== 'string' || typeof last_entity_id !== 'string') {
    throw new TypeError('DISCOVERY_CURSOR_INVALID');
  }
  if (typeof last_score !== 'number' || !Number.isFinite(last_score)) throw new TypeError('DISCOVERY_CURSOR_INVALID');
  const payload = { algorithm_ref, snapshot_ref, last_score, last_entity_id };
  return Buffer.from(canonicalStringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0) throw new TypeError('DISCOVERY_CURSOR_INVALID');
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof value.algorithm_ref !== 'string' ||
      typeof value.snapshot_ref !== 'string' ||
      typeof value.last_entity_id !== 'string' ||
      typeof value.last_score !== 'number' ||
      !Number.isFinite(value.last_score)
    ) throw new Error('shape');
    return {
      algorithm_ref: value.algorithm_ref,
      snapshot_ref: value.snapshot_ref,
      last_score: value.last_score,
      last_entity_id: value.last_entity_id
    };
  } catch {
    throw new TypeError('DISCOVERY_CURSOR_INVALID');
  }
}

function paginateCandidates(candidates, {
  limit = 20,
  cursor = null,
  algorithmRef,
  snapshotRef
} = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('DISCOVERY_CANDIDATES_REQUIRED');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('DISCOVERY_LIMIT_INVALID');
  if (typeof algorithmRef !== 'string' || typeof snapshotRef !== 'string') throw new TypeError('DISCOVERY_PAGINATION_CONTEXT_REQUIRED');

  let start = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded.algorithm_ref !== algorithmRef) throw new Error('DISCOVERY_CURSOR_MISMATCH');
    if (decoded.snapshot_ref !== snapshotRef) throw new Error('DISCOVERY_SNAPSHOT_CHANGED');
    const index = candidates.findIndex(candidate =>
      candidate.score === decoded.last_score && candidateId(candidate) === decoded.last_entity_id
    );
    if (index < 0) throw new Error('DISCOVERY_CURSOR_POSITION_INVALID');
    start = index + 1;
  }

  const page = candidates.slice(start, start + limit);
  const hasMore = start + page.length < candidates.length;
  const last = hasMore && page.length > 0 ? page[page.length - 1] : null;
  return {
    candidates: page,
    next_cursor: last ? encodeCursor({
      algorithm_ref: algorithmRef,
      snapshot_ref: snapshotRef,
      last_score: last.score,
      last_entity_id: candidateId(last)
    }) : null
  };
}

module.exports = { encodeCursor, decodeCursor, paginateCandidates, candidateId };

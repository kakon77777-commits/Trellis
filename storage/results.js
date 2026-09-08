function plainRow(row) {
  if (row === null || row === undefined) return null;
  return { ...row };
}

function plainRows(rows) {
  return Array.isArray(rows) ? rows.map(plainRow) : [];
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRunResult(result) {
  const meta = result?.meta ?? result ?? {};
  const changes = numberOrNull(meta.changes) ?? 0;
  const lastRowId = numberOrNull(meta.last_row_id ?? meta.lastInsertRowid);
  const rowsRead = numberOrNull(meta.rows_read);
  const rowsWritten = numberOrNull(meta.rows_written) ?? changes;
  return {
    changes,
    last_row_id: lastRowId,
    rows_read: rowsRead,
    rows_written: rowsWritten
  };
}

module.exports = { plainRow, plainRows, normalizeRunResult };

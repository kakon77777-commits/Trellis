const { AsyncSqlEventStore } = require('../events/async-sql-event-store');
const { createPublicServiceFacade } = require('../http/view-models/public');
const { createMachineRoutes } = require('../http/routes/machine');
const { createPublicRoutes } = require('../http/routes/public');
const { createResourceRoutes } = require('../http/routes/resources');
const { AilpStore } = require('../ailp/store');
const { createAilpRoutes } = require('../ailp/routes');

function assertAsyncSqlPort(sql) {
  if (!sql || !['first', 'all', 'run', 'batch', 'session'].every(name => typeof sql[name] === 'function')) {
    throw new TypeError('ASYNC_SQL_PORT_REQUIRED');
  }
}

function buildRuntimeDependencies({ sql, eventStore, disclosurePolicy } = {}) {
  assertAsyncSqlPort(sql);
  const store = eventStore ?? new AsyncSqlEventStore(sql);
  return Object.freeze({ sql, eventStore: store, disclosurePolicy });
}

function buildHttpRuntime({ sql, eventStore, disclosurePolicy, ailpRpKey, ailpAllowedOrigins } = {}) {
  const dependencies = buildRuntimeDependencies({ sql, eventStore, disclosurePolicy });
  const services = createPublicServiceFacade(dependencies);
  const routeHandlers = [createMachineRoutes(), createPublicRoutes(), createResourceRoutes()];
  // ailpRpKey is optional: without it (AILP not configured for this
  // environment) ailpRoutes stays undefined and dispatchRequest falls back
  // to its original GET/HEAD-only behavior, unchanged. ailpAllowedOrigins
  // overrides the real production origin allowlist -- only ever set for
  // local/integration testing (see scripts/run-ailp-worker-integration-local.js),
  // never in real production config.
  const ailpRoutes = ailpRpKey
    ? createAilpRoutes({ store: new AilpStore(sql), rpKey: ailpRpKey, ...(ailpAllowedOrigins ? { allowedOrigins: ailpAllowedOrigins } : {}) })
    : undefined;
  return Object.freeze({ ...dependencies, services, routeHandlers, ailpRoutes });
}

module.exports = { assertAsyncSqlPort, buildRuntimeDependencies, buildHttpRuntime };

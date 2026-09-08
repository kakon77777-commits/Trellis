const { AsyncSqlEventStore } = require('../events/async-sql-event-store');
const { createPublicServiceFacade } = require('../http/view-models/public');
const { createMachineRoutes } = require('../http/routes/machine');
const { createPublicRoutes } = require('../http/routes/public');
const { createResourceRoutes } = require('../http/routes/resources');

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

function buildHttpRuntime({ sql, eventStore, disclosurePolicy } = {}) {
  const dependencies = buildRuntimeDependencies({ sql, eventStore, disclosurePolicy });
  const services = createPublicServiceFacade(dependencies);
  const routeHandlers = [createMachineRoutes(), createPublicRoutes(), createResourceRoutes()];
  return Object.freeze({ ...dependencies, services, routeHandlers });
}

module.exports = { assertAsyncSqlPort, buildRuntimeDependencies, buildHttpRuntime };

const fs = require('node:fs');
const path = require('node:path');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMPLATE_PATH = path.join(__dirname, '..', 'wrangler.toml.template');
const OUTPUT_PATH = path.join(__dirname, '..', 'wrangler.toml');

function renderWranglerConfig({ databaseId, template = fs.readFileSync(TEMPLATE_PATH, 'utf8') } = {}) {
  if (!databaseId) throw new TypeError('TRELLIS_D1_DATABASE_ID_REQUIRED');
  if (!UUID_RE.test(databaseId)) throw new TypeError('INVALID_TRELLIS_D1_DATABASE_ID');
  return template.replace('__TRELLIS_D1_DATABASE_ID__', databaseId);
}

function main() {
  const text = renderWranglerConfig({ databaseId: process.env.TRELLIS_D1_DATABASE_ID });
  fs.writeFileSync(OUTPUT_PATH, text, 'utf8');
  process.stdout.write(`wrote ${OUTPUT_PATH}\n`);
}

if (require.main === module) main();
module.exports = { renderWranglerConfig, TEMPLATE_PATH, OUTPUT_PATH };

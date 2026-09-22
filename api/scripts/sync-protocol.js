// Copies the shared protocol definitions (ABIs, deployment config, exchange sessions) from web/api/_lib/protocol,
// the single source of truth, into src/protocol. Run after changing them:  npm run sync:protocol
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', '..', 'web', 'api', '_lib', 'protocol');
const to = path.join(__dirname, '..', 'src', 'protocol');
fs.mkdirSync(to, { recursive: true });
for (const file of ['abis.ts', 'deployments.ts', 'sessions.ts']) {
  const src = fs.readFileSync(path.join(from, file), 'utf8').replace(/from '(\.\/[^']+)\.js'/g, "from '$1'");
  fs.writeFileSync(path.join(to, file), `// GENERATED from web/api/_lib/protocol/${file} by scripts/sync-protocol.js. Do not edit.\n\n${src}`);
  console.log(`synced ${file}`);
}

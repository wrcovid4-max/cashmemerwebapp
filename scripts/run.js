/**
 * Starts the server, coping with the fact that node:sqlite lives behind a flag
 * on some versions of Node and not others.
 *
 *   - Node 22.5 up to around 22.11: node:sqlite exists but is behind
 *     --experimental-sqlite, so requiring it without the flag throws.
 *   - Newer Node: it is available with no flag, and on the very newest the flag
 *     has been removed entirely, so passing it would be an error ("bad option").
 *
 * Rather than guess which computer this is, we ask directly: can we require
 * node:sqlite right now, as we are?
 *   - Yes  -> just run the server in this same process. No flag, no fuss.
 *   - No   -> this Node keeps it behind the flag, so relaunch ourselves once
 *             with the flag added. The flag is therefore only ever handed to a
 *             Node that actually understands it.
 */
import { createRequire } from 'node:module';

/* A version too old for node:sqlite at all: say so plainly instead of failing
   later with a cryptic message. This is the one thing a shopkeeper can act on. */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error('');
  console.error(`  Cash Memer needs Node.js 22.5 or newer. This computer has ${process.versions.node}.`);
  console.error('  Install the latest LTS from https://nodejs.org and start it again.');
  console.error('');
  process.exit(1);
}

const require = createRequire(import.meta.url);

let hasSqlite = true;
try {
  require('node:sqlite');
} catch {
  hasSqlite = false;
}

if (hasSqlite) {
  // Available already — run the server right here, no subprocess and no flag.
  await import('../server/index.js');
} else {
  // Behind the flag on this Node. Relaunch ourselves, this same Node, with it.
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');

  const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js');
  const child = spawn(process.execPath, ['--experimental-sqlite', server], { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

// Packs the package, installs it into an empty project, and loads every entry point — in
// CommonJS and in ESM.
//
// This exists because reading the source cannot find the bug it is written for: a build that
// resolves fine from this repo's own node_modules can still be broken for a stranger's
// `npm install`, because the resolution paths are not the same. An entry point is only real once
// it has loaded from a node_modules it was actually installed into.
//
// `vireglass` is a mandatory peer, not an optional one — the package doesn't load without it. If
// it's already present in this repo's own node_modules (as it has to be, for typecheck and test),
// its tarball is packed and installed into the sandbox alongside vireuikit's own, so the check
// stays deterministic and offline instead of depending on whatever npm's registry currently has
// published for it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const WINDOWS = process.platform === 'win32';
const npm = WINDOWS ? 'npm.cmd' : 'npm';
// npm is a .cmd on Windows and only spawns through a shell there; a shell then needs the paths
// quoted, because a temp directory can have a space in it.
const run = (cmd, args, cwd) => {
  const shell = WINDOWS && cmd === npm;
  const argv = shell ? args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)) : args;
  return execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell });
};

let failed = false;
const fail = (m) => { console.error(`check-package: ${m}`); failed = true; };

// --ignore-scripts: packing an already-installed dependency must not re-run its `prepare`
// build step. A peer's node_modules copy only ships what its own `files` field lists (for
// `vireglass`: dist, docs, pruned src, android — not its tsup config), so re-running `prepare`
// there fails outright; even where it would succeed, packing has no business rebuilding anything.
const packOne = (cwd) => {
  const lines = run(npm, ['pack', '--silent', '--ignore-scripts'], cwd).trim().split(/\r?\n/);
  const name = lines.pop();
  if (!name) throw new Error(`npm pack produced no output in ${cwd}`);
  return join(cwd, name);
};

for (const f of readdirSync(ROOT)) {
  if (/^vireuikit-.*\.tgz$/.test(f)) unlinkSync(join(ROOT, f));
}

const tarballs = [packOne(ROOT)];
for (const name of Object.keys(PACKAGE.peerDependencies ?? {})) {
  let peerDir;
  try {
    peerDir = dirname(require.resolve(join(name, 'package.json')));
  } catch {
    peerDir = null;
  }
  if (!peerDir) {
    fail(`peer dependency "${name}" is not installed locally, so it cannot be packed for the sandbox`);
    continue;
  }
  tarballs.push(packOne(peerDir));
}

const sandbox = mkdtempSync(join(tmpdir(), 'vireuikit-consume-'));

try {
  writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'consume', private: true, version: '1.0.0' }));
  run(npm, ['install', '--silent', '--no-audit', '--no-fund', ...tarballs], sandbox);

  const entries = ['vireuikit', 'vireuikit/web'];
  const cjs = entries.map((e) => `require(${JSON.stringify(e)});`).join('\n');
  const esm = entries.map((e, i) => `import * as m${i} from ${JSON.stringify(e)};`).join('\n');

  writeFileSync(
    join(sandbox, 'cjs.cjs'),
    `${cjs}\nconst { ATOM_AT_REST } = require('vireuikit');\nif (typeof ATOM_AT_REST.pressed !== 'number') throw new Error('the atom model did not load');\nconsole.log('cjs ok');`,
  );
  writeFileSync(
    join(sandbox, 'esm.mjs'),
    `${esm}\nimport { ATOM_AT_REST } from 'vireuikit';\nif (typeof ATOM_AT_REST.pressed !== 'number') throw new Error('the atom model did not load');\nconsole.log('esm ok');`,
  );

  for (const [kind, file] of [['CommonJS', 'cjs.cjs'], ['ESM', 'esm.mjs']]) {
    try {
      run(process.execPath, [join(sandbox, file)], sandbox);
    } catch (error) {
      const e = /** @type {{ stderr?: string; message?: string }} */ (error);
      fail(`${kind}: ${String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')}`);
    }
  }

  if (!failed) {
    console.log('check-package: every entry point loads from an install, in CommonJS and ESM');
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  for (const t of tarballs) {
    try { unlinkSync(t); } catch {}
  }
}
process.exit(failed ? 1 : 0);

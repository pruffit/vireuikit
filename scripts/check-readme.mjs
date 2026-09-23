// Every name the documentation tells someone to import has to exist.
//
// The worst way for an open library to fail a stranger is for its first example not to run. And
// docs drift silently: a rename, a module moved to a subpath, an export dropped — the build stays
// green, the tests stay green, and the README goes on promising something that is not there.
//
// This reads the import lines out of the markdown and checks each name against the entry it
// names, loaded from `dist`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

let failed = false;
const fail = (m) => { console.error(`check-readme: ${m}`); failed = true; };

function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Inside a ```diff block, a line starting with `-` is the OLD call — documentation of what not to
 * write any more. Checking it would make every migration note a failure.
 */
function withoutDiffRemovals(text) {
  const out = [];
  let inDiff = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      inDiff = line.slice(3).trim() === 'diff';
      out.push(line);
      continue;
    }
    if (inDiff && line.startsWith('-')) continue;
    out.push(line);
  }
  return out.join(String.fromCharCode(10));
}

/** `import { a, b } from 'vireuikit/x'` — parsed by splitting, so no escaping to get wrong. */
function importsIn(text) {
  const found = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf('import {', at);
    if (open < 0) break;
    const close = text.indexOf('}', open);
    const from = text.indexOf("from '", close);
    const end = text.indexOf("'", from + 6);
    at = open + 8;
    if (close < 0 || from < 0 || end < 0 || from - close > 12) continue;
    const module = text.slice(from + 6, end);
    const ours = module === 'vireuikit' || module.startsWith('vireuikit/');
    const core = module === 'vireglass' || module.startsWith('vireglass/');
    if (!ours && !core) continue;
    const names = text
      .slice(open + 8, close)
      .split(',')
      .map((n) => n.trim().replace('type ', ''))
      .filter(Boolean);
    found.push({ module, names });
  }
  return found;
}

const loaded = new Map();
function exportsOf(module) {
  if (loaded.has(module)) return loaded.get(module);
  // The core is a peer: its names are checked against the version installed next to us, so a
  // rename upstream turns this red instead of leaving the README promising an import.
  if (module === 'vireglass' || module.startsWith('vireglass/')) {
    const names = new Set(Object.keys(require(module)));
    loaded.set(module, names);
    return names;
  }
  // Resolved through the package's own exports map, not by guessing at a filename — so a subpath
  // that is documented but not published fails here rather than in someone's install.
  const key = module === 'vireuikit' ? '.' : `.${module.slice('vireuikit'.length)}`;
  const entry = PACKAGE.exports?.[key];
  const file = typeof entry === 'string' ? entry : entry?.require ?? entry?.default;
  if (!file) throw new Error(`the package does not export "${key}"`);
  const names = new Set(Object.keys(require(join(ROOT, file))));
  loaded.set(module, names);
  return names;
}

let checked = 0;
for (const file of markdownFiles(ROOT)) {
  const text = withoutDiffRemovals(readFileSync(file, 'utf8'));
  for (const { module, names } of importsIn(text)) {
    let available;
    try {
      available = exportsOf(module);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`${relative(ROOT, file)} imports from '${module}', which does not load: ${message}`);
      continue;
    }
    for (const name of names) {
      checked += 1;
      if (!available.has(name)) {
        fail(`${relative(ROOT, file)} tells the reader to import ${name} from '${module}', which does not export it`);
      }
    }
  }
}

if (checked === 0) fail('found no imports in the documentation at all — this check would pass vacuously');
if (!failed) console.log(`check-readme: all ${checked} names the documentation tells you to import exist`);
process.exit(failed ? 1 : 0);

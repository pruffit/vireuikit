import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MAX_FILES = 600;

function listImages(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_FILES || depth > 3) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) walk(full, depth + 1);
      else if (IMAGE.test(name)) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root, 0);
  return out;
}

// Reference frames are third-party material: served from a local directory in dev only, never
// copied into the repository or the build.
function referenceFrames(): Plugin {
  return {
    name: 'vireuikit-reference',
    apply: 'serve',
    configureServer(server) {
      const root = process.env.VIREUIKIT_REFERENCE_DIR
        ? resolve(process.env.VIREUIKIT_REFERENCE_DIR)
        : '';
      server.middlewares.use('/__reference', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://lab');
        res.setHeader('cache-control', 'no-store');
        if (!root || !existsSync(root)) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ configured: false, files: [] }));
          return;
        }
        if (url.pathname === '/list') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ configured: true, files: listImages(root) }));
          return;
        }
        if (url.pathname === '/file') {
          const target = normalize(join(root, url.searchParams.get('path') ?? ''));
          if (!target.startsWith(root + sep) || !IMAGE.test(target) || !existsSync(target)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('content-type', `image/${extname(target).slice(1).replace('jpg', 'jpeg')}`);
          createReadStream(target).pipe(res);
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    },
  };
}

// Sends every import of the glass module through lab/glass-dom.ts, which adds the switch the motion gate's canary uses.
function glassShim(): Plugin {
  const same = (a: string, b: string) => normalize(a) === normalize(b);
  const shim = resolve(HERE, 'glass-dom.ts');
  return {
    name: 'vireuikit-glass-shim',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source !== 'vireglass/dom' || !importer || same(importer.split('?')[0]!, shim)) return null;
      return shim;
    },
  };
}

// A gate's lab serves the tree as it was when it started: an edit must not reload the page it is timing.
const STILL = process.env.VIREUIKIT_LAB_STILL === '1';

// A classic script bundle of the web entry, so a page can define the elements synchronously
// before its markup is parsed, the way a consumer's early script would.
function earlyBundle(): Plugin {
  const make = () =>
    build({
      entryPoints: [resolve(HERE, '../src/web/index.ts')],
      bundle: true,
      format: 'iife',
      globalName: 'VireWeb',
      write: false,
      target: 'es2022',
      logLevel: 'silent',
    }).then((out) => out.outputFiles[0]?.text ?? '');
  let built: Promise<string> | null = null;
  const answer = async (_req: IncomingMessage, res: ServerResponse) => {
    const text = await (built ?? make());
    res.setHeader('content-type', 'text/javascript');
    res.end(text);
  };
  return {
    name: 'vireuikit-early-bundle',
    apply: 'serve',
    configureServer(server) {
      if (STILL) built = make();
      server.middlewares.use('/__early.js', answer);
    },
    configurePreviewServer(server) {
      built = make();
      server.middlewares.use('/__early.js', answer);
    },
  };
}

export default defineConfig({
  root: HERE,
  plugins: [glassShim(), referenceFrames(), earlyBundle()],
  resolve: {
    alias: { 'vireuikit/web': resolve(HERE, '../src/web/index.ts') },
  },
  // A dependency found after start needs a reload a still lab cannot send: there nothing is pre-bundled late, so a
  // module that cannot load as it is fails in the page instead of running on a stale bundle.
  optimizeDeps: { include: ['vireglass', 'vireglass/dom'], ...(STILL ? { noDiscovery: true } : {}) },
  server: {
    port: Number(process.env.VIREUIKIT_LAB_PORT ?? 5179),
    strictPort: true,
    host: '127.0.0.1',
    ...(STILL ? { hmr: false, watch: null } : {}),
  },
  preview: { port: Number(process.env.VIREUIKIT_LAB_PORT ?? 5179), strictPort: true, host: '127.0.0.1' },
});

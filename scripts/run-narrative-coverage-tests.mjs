import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const esbuild = requireFromRoot('esbuild');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-coverage-'));
const outfile = path.join(directory, 'coverage-tests.cjs');

fs.writeFileSync(
  path.join(directory, 'db-stub.js'),
  'module.exports = { db: {} };\n',
);
fs.writeFileSync(
  path.join(directory, 'ops-stub.js'),
  'module.exports = { getSetting: async () => undefined, updateSetting: async () => "" };\n',
);
fs.writeFileSync(
  path.join(directory, 'proof-stub.js'),
  'module.exports = { buildAppearanceCandidates: () => [], findAppearances: () => new Set() };\n',
);
fs.writeFileSync(
  path.join(directory, 'names-stub.js'),
  'module.exports = { indexNameCandidates: () => new Map() };\n',
);

await esbuild.build({
  entryPoints: [path.join(root, 'tests/narrative-coverage.bundle.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  alias: { '@': path.join(root, 'src') },
  plugins: [
    {
      name: 'stub-heavy',
      setup(build) {
        build.onResolve({ filter: /^@\/db$/ }, () => ({ path: path.join(directory, 'db-stub.js') }));
        build.onResolve({ filter: /^@\/db\/operations$/ }, () => ({ path: path.join(directory, 'ops-stub.js') }));
        build.onResolve({ filter: /^@\/services\/proofreader$/ }, () => ({
          path: path.join(directory, 'proof-stub.js'),
        }));
        build.onResolve({ filter: /^@\/engines\/_shared\/nameAppearances$/ }, () => ({
          path: path.join(directory, 'names-stub.js'),
        }));
      },
    },
  ],
});

const require = createRequire(import.meta.url);
require(outfile);

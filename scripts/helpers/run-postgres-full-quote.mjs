import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVitest } from 'vitest/node';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const evidence = process.env.PARCELGRID_PG_QA_EVIDENCE;
const repo = path.resolve(scripts, '../..');
assert.ok(path.isAbsolute(evidence) && path.resolve(evidence).startsWith(path.join(repo, 'artifacts') + path.sep));
const phase = process.argv[2];
assert.ok(['initial', 'restarted', 'restored'].includes(phase));
assert.equal(process.env.PARCELGRID_FULL_QUOTE_PHASE, phase);
assert.equal(process.env.PARCELGRID_RUN_POSTGRES_INTEGRATION, '1');
assert.match(process.env.TMPDIR, /^\/private\/tmp\/parcelgrid-pg-quote-regression-[^/]+\/scratch$/);
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, '127.0.0.1');
assert.match(target.pathname, /^\/pg_native_[a-f0-9]+(?:_restore)?$/);
assert.equal(target.pathname.slice(1), process.env.PARCELGRID_POSTGRES_DISPOSABLE_DATABASE);
assert.ok(!['', '3000', '4318', '5432'].includes(target.port));
assert.match(target.username, /^quote_app_[a-f0-9]+$/);
const sources = new Map();
const sha = (value) => createHash('sha256').update(value).digest('hex');
const include = ['src/tests/postgres-runtime.integration.test.ts', 'src/tests/postgres-full-quote.integration.test.ts'];
let context;
try {
  context = await startVitest('test', include, {
    config: false, root: repo, include, environment: 'node', watch: false, run: true,
    cache: false, maxWorkers: 1, minWorkers: 1, fileParallelism: false,
    reporters: ['default', 'json'], outputFile: { json: path.join(evidence, `db-vitest-${phase}.json`) },
  }, {
    envFile: false, cacheDir: path.join(process.env.TMPDIR, 'vite-cache'),
    resolve: { alias: { '@': path.join(repo, 'src') } },
    plugins: [{ name: 'quote-source-provenance', enforce: 'pre', async transform(code, id) {
      const filename = id.split('?')[0];
      if (!filename.startsWith(path.join(repo, 'src') + '/')) return;
      const name = path.relative(repo, filename);
      const hashes = { beforeSha256: sha(await readFile(filename)), transformInputSha256: sha(code) };
      if (sources.has(name)) assert.deepEqual(hashes, sources.get(name), `${name} changed during loading`);
      sources.set(name, hashes);
    } }],
  });
} finally {
  await context?.close();
  const entries = await Promise.all([...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(async ([file, hashes]) => {
    const afterSha256 = sha(await readFile(path.join(repo, file)));
    return [file, { ...hashes, afterSha256, unchanged: afterSha256 === hashes.beforeSha256 }];
  }));
  await writeFile(path.join(evidence, `db-runtime-sources-${phase}.json`), JSON.stringify(Object.fromEntries(entries), null, 2) + '\n', { flag: 'wx' });
  assert.ok(entries.length > 0 && entries.every(([, hashes]) => hashes.unchanged));
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binArg = process.argv.find(value => value.startsWith('--bin='))?.slice(6);
const evidenceArg = process.argv.find(value => value.startsWith('--evidence='))?.slice(11);
assert.ok(binArg && path.isAbsolute(binArg), 'Pass --bin=/absolute/postgresql/bin (PostgreSQL 18.6)');
assert.ok(evidenceArg && path.isAbsolute(evidenceArg), 'Pass --evidence=/absolute/repo/artifacts/new-run');
const bin = path.resolve(binArg), evidence = path.resolve(evidenceArg);
assert.ok(evidence.startsWith(path.join(repo, 'artifacts') + path.sep), 'Evidence must stay inside repo/artifacts');
const resultPath = path.join(evidence, 'db-result.json');
assert.ok(!existsSync(resultPath), 'Preserve previous regression evidence');
assert.equal(process.env.DATABASE_URL, undefined, 'Inherited DATABASE_URL prohibited');
assert.match(process.version, /^v24\./);
const runtime = { serverVersion: 'postgres (PostgreSQL) 18.6' };
const root = await mkdtemp('/private/tmp/parcelgrid-pg-quote-regression-');
const data = path.join(root, 'data'), scratch = path.join(root, 'scratch'), sockets = path.join(root, 'sockets');
const token = randomBytes(6).toString('hex');
const database = `pg_native_${token}`, restoredDb = `${database}_restore`;
const adminRole = `quote_admin_${token}`, owner = `quote_owner_${token}`, appRole = `quote_app_${token}`;
const env = { PATH: `${bin}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: scratch, LC_ALL: 'C', TZ: 'UTC', PGCONNECT_TIMEOUT: '5', PSQL_HISTORY: '/dev/null' };
const result = { startedAt: new Date().toISOString(), status: 'running', root, bin, database, restoredDb, adminRole, owner, appRole,
  nodeVersion: process.version, commands: [], checks: [], tests: [], cleanup: {},
  limitations: ['Synthetic disposable PostgreSQL regression, not live operations or expert approval.',
    'Snapshot seals use actual server helpers and PostgreSQL audit persistence; HTTP authorization, browsers, PDFs and physical phones are outside this run.',
    'The original opt-in runtime test creates its own fresh gate records in each phase; quote records and seals are seeded only in the initial phase.',
    'Tenant boundaries are verified through organization-scoped application APIs, not database row-level security.',
    'Restricted application role has table DML plus TRUNCATE only on the three immutable evidence tables to exercise their rejection triggers.'] };
const sha = value => createHash('sha256').update(value).digest('hex');
const sanitize = value => value.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[REDACTED_DSN]').replace(/\x1b\[[0-9;]*m/g, '');
const save = () => writeFile(resultPath, JSON.stringify(result, null, 2) + '\n');
const clients = new Set(), serverPids = new Set();
let child, interrupted = false, cleaning = false, initialized = false, port;
const killGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  if (child && !cleaning) killGroup(child.pid, 'SIGKILL');
});
async function run(label, command, args, { extraEnv = {}, allowFailure = false, timeout = 120000, filter = value => value } = {}) {
  if (interrupted && !cleaning) throw new Error('Interrupted');
  console.log(label);
  const started = Date.now(), chunks = [];
  let bytes = 0, timedOut = false, outputExceeded = false, spawnError;
  child = spawn(command, args, { cwd: repo, env: { ...env, ...extraEnv }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const current = child;
  const collect = chunk => {
    bytes += chunk.length;
    if (bytes <= 8 * 1024 * 1024) chunks.push(chunk);
    else { outputExceeded = true; killGroup(current.pid, 'SIGKILL'); }
  };
  current.stdout.on('data', collect); current.stderr.on('data', collect);
  current.on('error', error => { spawnError = error.message; });
  const timer = setTimeout(() => { timedOut = true; if (current.pid) killGroup(current.pid, 'SIGKILL'); }, timeout);
  const code = await new Promise(resolve => current.on('close', resolve));
  clearTimeout(timer); child = undefined;
  const output = sanitize(filter(Buffer.concat(chunks).toString()));
  await writeFile(path.join(evidence, 'db-logs', `${label}.log`), output.length > 20000 ? '[Earlier output omitted]\n' + output.slice(-20000) : output, { flag: 'wx' });
  result.commands.push({ label, command, args, pid: current.pid, exitCode: code, timedOut, outputExceeded, spawnError, durationMs: Date.now() - started });
  await save();
  if (timedOut || outputExceeded || spawnError || (!allowFailure && code !== 0)) throw new Error(`${label} failed (${code}): ${spawnError || output.slice(-2000)}`);
  return { code, output };
}
function connect(db = database, username = owner) {
  const sql = postgres({ host: '127.0.0.1', port, database: db, username, password: '', ssl: false, max: 1,
    connect_timeout: 5, idle_timeout: 5, connection: { statement_timeout: 20000, lock_timeout: 10000 }, onnotice: () => {} });
  clients.add(sql); return sql;
}
async function closeClients() {
  const outcomes = await Promise.allSettled([...clients].map(sql => sql.end({ timeout: 3 })));
  clients.clear();
  assert.ok(outcomes.every(outcome => outcome.status === 'fulfilled'), 'All database clients must close');
}
async function sourceHashes() {
  const journal = JSON.parse(await readFile(path.join(repo, 'drizzle/meta/_journal.json'), 'utf8'));
  const files = ['package.json', 'pnpm-lock.yaml', 'drizzle/meta/_journal.json', ...journal.entries.map(entry => `drizzle/${entry.tag}.sql`),
    'src/tests/postgres-runtime.integration.test.ts', 'src/tests/postgres-full-quote.integration.test.ts', 'src/tests/helpers/construction-quote-fixture.ts',
    'src/tests/helpers/integrated-verification-fixture.ts', 'src/tests/helpers/project-workspace-fixture.ts',
    'src/lib/db/index.ts', 'src/lib/db/schema.ts', 'src/lib/auth/database-membership.ts', 'src/lib/auth/roles.ts',
    'src/lib/planning/construction-quote.ts', 'src/lib/workspace/project-workspace.ts', 'src/lib/workspace/project-workspace-storage.ts',
    'src/lib/audit/audit-ledger.ts', 'src/lib/handoff/review-snapshot.ts', 'src/lib/handoff/server-review-snapshot.ts',
    'src/lib/handoff/integrated-verification.ts',
    'scripts/verify-postgres-full-quote.mjs', 'scripts/helpers/run-postgres-full-quote.mjs'];
  return Object.fromEntries(await Promise.all(files.sort().map(async file => [file, sha(await readFile(path.join(repo, file)))])));
}
async function runtimeHashes() {
  const files = (await readdir(bin)).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(path.join(bin, file)))])));
}
async function check(label, action) {
  const start = Date.now();
  try {
    const details = await action();
    result.checks.push({ label, status: 'passed', durationMs: Date.now() - start, details });
    console.log(`${label}: passed`); await save(); return details;
  } catch (error) {
    result.checks.push({ label, status: 'failed', durationMs: Date.now() - start, error: sanitize(error.message), sqlState: error.code });
    await save(); throw error;
  }
}
async function snapshot(sql, label) {
  const tables = await sql`select schemaname,tablename from pg_tables where schemaname in ('public','drizzle') order by schemaname,tablename`;
  const rows = [];
  for (const table of tables) {
    const [row] = await sql`select count(*)::int as count, coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text as content from ${sql(table.schemaname + '.' + table.tablename)} t`;
    rows.push({ schema: table.schemaname, table: table.tablename, count: row.count, sha256: sha(row.content) });
  }
  const columns = await sql`select n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) as default_expr from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ('public','drizzle') and c.relkind='r' and a.attnum>0 and not a.attisdropped order by n.nspname,c.relname,a.attnum`;
  const triggers = await sql`select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname`;
  const indexes = await sql`select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','drizzle') order by schemaname,tablename,indexname`;
  const permissions = await sql`select n.nspname,c.relname,pg_get_userbyid(c.relowner) as owner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','S') order by n.nspname,c.relname`;
  const constraints = await sql`select n.nspname,c.relname,x.conname,x.contype,pg_get_constraintdef(x.oid) as definition from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') order by n.nspname,c.relname,x.conname`;
  const ledger = await sql`select id,hash,created_at from drizzle.__drizzle_migrations order by id`;
  const catalog = { columns, triggers, indexes, permissions, constraints };
  const value = { tables: rows, ledger, schemaSha256: sha(JSON.stringify(catalog)), catalog };
  await writeFile(path.join(evidence, `db-snapshot-${label}.json`), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return value;
}
async function tests(phase, db) {
  const extraEnv = { NODE_ENV: 'test', CI: '1', NO_COLOR: '1', PARCELGRID_RUN_POSTGRES_INTEGRATION: '1',
    PARCELGRID_FULL_QUOTE_PHASE: phase, PARCELGRID_FULL_QUOTE_STATE: path.join(scratch, 'full-quote-state.json'), PARCELGRID_POSTGRES_DISPOSABLE_DATABASE: db,
    PARCELGRID_PG_QA_EVIDENCE: evidence,
    PROJECT_WORKSPACE_STORAGE_DIR: path.join(scratch, 'fallback-workspaces'), AUDIT_LEDGER_STORAGE_DIR: path.join(scratch, 'fallback-audit'),
    DATABASE_URL: `postgresql://${appRole}@127.0.0.1:${port}/${db}` };
  const outcome = await run(`test-${phase}`, process.execPath, [path.join(repo, 'scripts/helpers/run-postgres-full-quote.mjs'), phase], { extraEnv, allowFailure: true, timeout: 180000 });
  const json = JSON.parse(await readFile(path.join(evidence, `db-vitest-${phase}.json`), 'utf8'));
  const assertions = json.testResults.flatMap(file => file.assertionResults.map(({ fullName, status }) => ({ fullName, status })));
  result.tests.push({ phase, exitCode: outcome.code, success: json.success, total: json.numTotalTests, passed: json.numPassedTests,
    failed: json.numFailedTests, pending: json.numPendingTests, assertions });
  await save();
  assert.equal(outcome.code, 0, `Tests failed; inspect db-vitest-${phase}.json`);
  assert.equal(json.success, true); assert.equal(json.numTotalTests, 2); assert.equal(json.numPassedTests, 2);
  assert.equal(json.numFailedTests, 0); assert.equal(json.numPendingTests, 0);
  assert.ok(assertions.every(assertion => assertion.status === 'passed'));
  const quoteState = await readFile(path.join(scratch, 'full-quote-state.json'));
  await writeFile(path.join(evidence, `db-full-quote-${phase}.json`), quoteState, { flag: 'wx' });
  assert.ok(!existsSync(path.join(scratch, 'fallback-workspaces')) && !existsSync(path.join(scratch, 'fallback-audit')));
  return { tests: 2, quoteStateSha256: sha(quoteState) };
}
async function rememberPid() {
  const pid = Number((await readFile(path.join(data, 'postmaster.pid'), 'utf8')).split('\n')[0]);
  assert.ok(Number.isSafeInteger(pid) && pid > 1); serverPids.add(pid); result.serverPids = [...serverPids];
}
function ownedProcesses(text) {
  const rows = text.split('\n').map(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return m && { pid: Number(m[1]), parent: Number(m[2]), command: m[3], line };
  }).filter(Boolean);
  const owned = new Set([...serverPids, ...result.commands.map(command => command.pid)]);
  for (const row of rows) if (row.command.includes(root)) owned.add(row.pid);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; } }
  return rows.filter(row => owned.has(row.pid)).map(row => row.line).join('\n');
}
try {
  await mkdir(path.join(evidence, 'db-logs'), { recursive: true });
  await mkdir(scratch, { mode: 0o700 }); await mkdir(sockets, { mode: 0o700 });
  result.sourceHashesBefore = await sourceHashes(); result.runtimeHashesBefore = await runtimeHashes(); await save();
  assert.equal((await run('server-version', path.join(bin, 'postgres'), ['--version'])).output.trim(), runtime.serverVersion);
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  assert.ok(![3000, 4318, 5432].includes(port)); result.port = port;
  await run('initdb', path.join(bin, 'initdb'), ['-D', data, '-U', adminRole, '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8']);
  initialized = true;
  await writeFile(path.join(data, 'pg_hba.conf'), `local all ${adminRole} trust\nhost all ${adminRole},${owner},${appRole} 127.0.0.1/32 trust\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n`);
  await writeFile(path.join(data, 'postgresql.conf'), `listen_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories='${sockets}'\nunix_socket_permissions=0700\nshared_buffers='32MB'\nmax_connections=30\nfsync=on\nsynchronous_commit=on\nfull_page_writes=on\nlog_statement='none'\nlog_min_error_statement=panic\n`);
  await run('start', path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(scratch, 'server.log'), '-w', '-t', '30', 'start']);
  await rememberPid();
  let admin = connect('postgres', adminRole);
  result.server = (await admin`select version(),current_setting('listen_addresses') as listen_addresses,current_setting('fsync') as fsync,current_setting('synchronous_commit') as synchronous_commit,current_setting('data_checksums') as data_checksums`)[0];
  assert.match(result.server.version, /^PostgreSQL 18\.6 /); assert.equal(result.server.listen_addresses, '127.0.0.1');
  assert.equal(result.server.fsync, 'on'); assert.equal(result.server.synchronous_commit, 'on');
  for (const role of [owner, appRole]) await admin`create role ${admin(role)} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`;
  await admin`create database ${admin(database)} owner ${admin(owner)}`;
  await admin`revoke all on database ${admin(database)} from public`;
  await admin`grant connect on database ${admin(database)} to ${admin(appRole)}`;
  let sql = connect();
  const migrations = { migrationsFolder: path.join(repo, 'drizzle') };
  await check('migrations-initial', async () => {
    await migrate(drizzle(sql), migrations);
    const ledger = await sql`select id,hash,created_at from drizzle.__drizzle_migrations order by id`;
    const journal = JSON.parse(await readFile(path.join(repo, 'drizzle/meta/_journal.json'), 'utf8'));
    assert.deepEqual(ledger.map(row => row.hash), journal.entries.map(entry => result.sourceHashesBefore[`drizzle/${entry.tag}.sql`]));
    return { migrations: ledger.length };
  });
  await sql`revoke create on schema public from public`;
  await sql`grant usage on schema public to ${sql(appRole)}`;
  await sql`grant select,insert,update,delete on all tables in schema public to ${sql(appRole)}`;
  await sql`grant truncate on audit_log,assumption_overrides,project_workspace_versions to ${sql(appRole)}`;
  await sql`grant usage,select on all sequences in schema public to ${sql(appRole)}`;
  const app = connect(database, appRole);
  result.roles = await admin`select rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit from pg_roles where rolname in (${owner},${appRole}) order by rolname`;
  assert.ok(result.roles.every(role => Object.entries(role).filter(([key]) => key !== 'rolname').every(([, value]) => value === false)));
  result.tableOwners = await sql`select tablename,tableowner from pg_tables where schemaname='public' order by tablename`;
  assert.ok(result.tableOwners.every(row => row.tableowner === owner));
  await check('app-cannot-bypass-owner', async () => {
    const probes = [];
    for (const statement of ['ALTER TABLE audit_log DISABLE TRIGGER USER', 'DROP TRIGGER audit_log_reject_update_delete ON audit_log', "SET LOCAL session_replication_role='replica'"]) {
      let observed; const rollback = new Error('probe rollback');
      try { await app.begin(async tx => { try { await tx.unsafe(statement); } catch (error) { observed = error.code; } throw rollback; }); }
      catch (error) { if (error !== rollback) throw error; }
      assert.equal(observed, '42501'); probes.push({ statement, sqlState: observed });
    }
    return probes;
  });
  await check('tests-initial', () => tests('initial', database));
  const initial = await snapshot(sql, 'initial');
  await check('migration-rerun-preserves-data', async () => { await migrate(drizzle(sql), migrations); assert.deepEqual(await snapshot(sql, 'migration-rerun'), initial); return { unchanged: true }; });
  await closeClients();
  await run('restart', path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(scratch, 'server.log'), '-m', 'fast', '-w', '-t', '30', 'restart']);
  await rememberPid(); sql = connect();
  await check('restart-equivalence', async () => { assert.deepEqual(await snapshot(sql, 'after-restart'), initial); return { tables: initial.tables.length, schemaAndRowsUnchanged: true }; });
  await check('tests-restarted', () => tests('restarted', database));
  const beforeBackup = await snapshot(sql, 'before-backup');
  const dump = path.join(scratch, 'synthetic.dump');
  const connection = ['-h', '127.0.0.1', '-p', String(port), '-U', owner];
  await run('pg-dump', path.join(bin, 'pg_dump'), [...connection, '-Fc', '-f', dump, database]);
  result.backup = { bytes: (await stat(dump)).size, sha256: sha(await readFile(dump)), retained: false };
  admin = connect('postgres', adminRole);
  await admin`create database ${admin(restoredDb)} owner ${admin(owner)}`;
  await admin`revoke all on database ${admin(restoredDb)} from public`;
  await admin`grant connect on database ${admin(restoredDb)} to ${admin(appRole)}`;
  await run('pg-restore', path.join(bin, 'pg_restore'), [...connection, '--exit-on-error', '--single-transaction', '-d', restoredDb, dump]);
  const restored = connect(restoredDb);
  await check('restore-equivalence', async () => { assert.deepEqual(await snapshot(restored, 'restored'), beforeBackup); return { tables: beforeBackup.tables.length, schemaAndRowsUnchanged: true }; });
  await check('tests-restored', () => tests('restored', restoredDb));
  await snapshot(restored, 'restored-after-test');
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.error = sanitize(error.stack ?? error.message); process.exitCode = 1;
  console.log('Regression failed; production source will not be modified.');
} finally {
  cleaning = true;
  const errors = [];
  const cleanup = async (label, action) => { try { await action(); } catch (error) { errors.push({ label, error: sanitize(error.message) }); } };
  await cleanup('clients', async () => { await closeClients(); result.cleanup.clientsClosed = true; });
  await cleanup('server', async () => {
    if (!initialized && !existsSync(path.join(data, 'postmaster.pid'))) { result.cleanup.serverStopped = true; return; }
    const status = await run('status-before-cleanup', path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { allowFailure: true, timeout: 10000 });
    if (status.code === 0) {
      const stopped = await run('stop', path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop'], { allowFailure: true, timeout: 40000 });
      if (stopped.code !== 0) await run('stop-immediate', path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'], { timeout: 20000 });
    }
    const after = await run('status-after-stop', path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { allowFailure: true, timeout: 10000 });
    result.cleanup.serverStopped = after.code === 3 && !existsSync(path.join(data, 'postmaster.pid'));
    assert.equal(result.cleanup.serverStopped, true);
  });
  await cleanup('server-log', async () => {
    const file = path.join(scratch, 'server.log');
    if (existsSync(file)) await writeFile(path.join(evidence, 'db-logs/server.log'), sanitize(await readFile(file, 'utf8')).slice(-20000), { flag: 'wx' });
  });
  await cleanup('port', async () => {
    result.cleanup.portClosed = !port || await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port }); socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(false); });
      socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
    assert.equal(result.cleanup.portClosed, true);
  });
  await cleanup('processes', async () => {
    const processes = await run('owned-processes-after-stop', '/bin/ps', ['-axo', 'pid=,ppid=,command='], { filter: ownedProcesses, timeout: 10000 });
    result.cleanup.noOwnedProcesses = processes.output.trim() === ''; assert.equal(result.cleanup.noOwnedProcesses, true);
  });
  await cleanup('temporary-root', async () => {
    assert.ok(result.cleanup.serverStopped && result.cleanup.portClosed && result.cleanup.noOwnedProcesses);
    assert.match(root, /^\/private\/tmp\/parcelgrid-pg-quote-regression-[A-Za-z0-9]+$/);
    result.cleanup.noFallbackFiles = !existsSync(path.join(scratch, 'fallback-workspaces')) && !existsSync(path.join(scratch, 'fallback-audit'));
    await rm(root, { recursive: true }); result.cleanup.temporaryRootRemoved = !existsSync(root);
    result.cleanup.databasesAndCachesRemoved = !existsSync(data) && !existsSync(scratch);
    assert.ok(result.cleanup.noFallbackFiles && result.cleanup.temporaryRootRemoved);
  });
  await cleanup('source-provenance', async () => {
    result.sourceHashesAfter = await sourceHashes(); result.runtimeHashesAfter = await runtimeHashes();
    result.sourcesUnchanged = JSON.stringify(result.sourceHashesBefore) === JSON.stringify(result.sourceHashesAfter);
    result.runtimeBinariesUnchanged = JSON.stringify(result.runtimeHashesBefore) === JSON.stringify(result.runtimeHashesAfter);
    const phases = [];
    for (const phase of ['initial', 'restarted', 'restored']) {
      const filename = path.join(evidence, `db-runtime-sources-${phase}.json`);
      if (existsSync(filename)) phases.push(JSON.parse(await readFile(filename, 'utf8')));
    }
    result.loadedSourceCount = Object.keys(phases[0] || {}).length;
    result.loadedSourcesStableAcrossPhases = phases.length === 3 && phases.every(phase => JSON.stringify(phase) === JSON.stringify(phases[0]));
    result.loadedSourcesUnchangedAtCleanup = phases.every(phase => Object.values(phase).every(source => source.unchanged));
    for (const phase of phases) for (const [filename, hashes] of Object.entries(phase)) {
      if (sha(await readFile(path.join(repo, filename))) !== hashes.beforeSha256) result.loadedSourcesUnchangedAtCleanup = false;
    }
    assert.ok(result.sourcesUnchanged && result.runtimeBinariesUnchanged && result.loadedSourcesUnchangedAtCleanup);
    if (result.status === 'passed') assert.ok(result.loadedSourcesStableAcrossPhases);
  });
  result.cleanup.errors = errors;
  if (errors.length || interrupted) { result.status = 'failed'; process.exitCode = 1; }
  result.finishedAt = new Date().toISOString();
  result.testTotals = result.tests.reduce((totals, test) => ({ total: totals.total + test.total, passed: totals.passed + test.passed,
    failed: totals.failed + test.failed, pending: totals.pending + test.pending }), { total: 0, passed: 0, failed: 0, pending: 0 });
  await save();
  const lines = ['# PostgreSQL Full Quote Adoption Regression', '', `Status: ${result.status}`, '',
    `Runtime: ${runtime.serverVersion}; ${bin}`, `Disposable database: ${database}; restore database: ${restoredDb}; loopback port: ${port}.`, '',
    '| Phase | Total | Passed | Failed | Skipped |', '| --- | ---: | ---: | ---: | ---: |',
    ...result.tests.map(test => `| ${test.phase} | ${test.total} | ${test.passed} | ${test.failed} | ${test.pending} |`), '',
    `Total executions: ${result.testTotals.total}; passed: ${result.testTotals.passed}; failed: ${result.testTotals.failed}; skipped: ${result.testTotals.pending}. Two test definitions run per completed phase.`, '',
    ...result.checks.map(item => `- ${item.label}: ${item.status}`), '',
    `Core source manifest unchanged: ${result.sourcesUnchanged}. Loaded source files: ${result.loadedSourceCount}; stable across all phases: ${result.loadedSourcesStableAcrossPhases}; unchanged at cleanup: ${result.loadedSourcesUnchangedAtCleanup}.`,
    `Runtime binaries retained unchanged: ${result.runtimeBinariesUnchanged}.`, '',
    `Cleanup: ${JSON.stringify(result.cleanup)}`, '', ...result.limitations.map(value => `- ${value}`), '',
    'Evidence: db-result.json contains source hashes, commands, checks and cleanup. db-runtime-sources-*.json records each loaded source before/after execution. db-full-quote-*.json preserves the identical synthetic records and seals reread in every phase. db-snapshot-*.json records all table hashes and catalog comparisons. db-vitest-*.json contains exact test results. Logs are bounded and DSNs redacted.', '',
    result.error || '', ''];
  await writeFile(path.join(evidence, 'db-report.md'), lines.join('\n'));
  console.log(JSON.stringify({ status: result.status, testTotals: result.testTotals, cleanup: result.cleanup, error: result.error }));
}

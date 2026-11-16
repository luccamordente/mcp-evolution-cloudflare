import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function run(dsn: string) {
  const root = mkdtempSync(join(tmpdir(), 'wapilot-observation-launcher-'));
  temporary.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve('scripts/message-observation-acceptance.mjs'), join(root, 'scripts/message-observation-acceptance.mjs'));
  const backend = join(root, 'go-source');
  mkdirSync(join(backend, 'pkg/message/acceptance'), { recursive: true });
  writeFileSync(join(backend, 'pkg/message/acceptance/observation_connected_test.go'), '');
  const go = join(root, 'go');
  writeFileSync(go, '#!/usr/bin/env node\nconsole.log("GO_STARTED " + JSON.stringify(Object.keys(process.env).filter(key => key.startsWith("PG"))));\nprocess.exit(1);\n', { mode: 0o700 });
  return spawnSync(process.execPath, [join(root, 'scripts/message-observation-acceptance.mjs')], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, MESSAGE_HISTORY_TEST_DSN: dsn, WAPILOT_OBSERVATION_GO_ROOT: backend, WAPILOT_ACCEPTANCE_GO: go, PGHOSTADDR: '203.0.113.10', PGSERVICE: 'remote', PGSERVICEFILE: '/remote/service.conf' },
  });
}

test.each([
  '', 'host=203.0.113.10 dbname=acceptance', 'dbname=acceptance',
  'host=127.0.0.1 host=203.0.113.10 dbname=acceptance',
  'host=127.0.0.1 hostaddr=203.0.113.10 dbname=acceptance',
  'host=127.0.0.1 service=remote dbname=acceptance',
  "host=203.0.113.10 password=' host=localhost ' dbname=acceptance",
  'postgresql://localhost/acceptance?host=203.0.113.10',
])('observation launcher rejects absent, ambiguous or remote DSN before starting Go (%s)', dsn => {
  const result = run(dsn);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/isolated loopback|explicit loopback|unique PostgreSQL/);
  expect(result.stdout).not.toContain('GO_STARTED');
});

test.each(['127.0.0.1', '::1', 'localhost'])('observation launcher removes PostgreSQL environment overrides for %s', host => {
  const result = run(`host=${host} port=55432 dbname=acceptance user=test sslmode=disable`);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('GO_STARTED []');
});

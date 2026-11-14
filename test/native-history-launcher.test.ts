import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function run(dsn: string) {
  const root = mkdtempSync(resolve(tmpdir(), 'wapilot-history-launcher-'));
  temporary.push(root);
  mkdirSync(resolve(root, 'scripts'));
  copyFileSync(resolve('scripts/native-history-acceptance.mjs'), resolve(root, 'scripts/native-history-acceptance.mjs'));
  mkdirSync(resolve(root, '.scratch/evolution-go/pkg/message/acceptance'), { recursive: true });
  writeFileSync(resolve(root, '.scratch/evolution-go/pkg/message/acceptance/reading_test.go'), '');
  const go = resolve(root, 'go');
  writeFileSync(go, '#!/usr/bin/env node\nconsole.log("GO_STARTED " + JSON.stringify(Object.keys(process.env).filter(key => key.startsWith("PG"))));\nprocess.exit(1);\n', { mode: 0o700 });
  return spawnSync(process.execPath, [resolve(root, 'scripts/native-history-acceptance.mjs')], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, MESSAGE_HISTORY_TEST_DSN: dsn, WAPILOT_ACCEPTANCE_GO: go, PGHOSTADDR: '203.0.113.10', PGSERVICE: 'remote', PGSERVICEFILE: '/remote/service.conf' },
  });
}

test.each([
  'host=127.0.0.1 host=203.0.113.10 dbname=acceptance',
  "host=203.0.113.10 password=' host=localhost ' dbname=acceptance",
  'host=127.0.0.1 hostaddr=203.0.113.10 dbname=acceptance',
  'host=127.0.0.1,203.0.113.10 dbname=acceptance',
  'host=127.0.0.1 service=remote dbname=acceptance',
  'host=127.0.0.1 options=remote dbname=acceptance',
  'postgresql://localhost/acceptance?host=203.0.113.10',
  'dbname=acceptance',
  'host=203.0.113.10 dbname=acceptance',
])('history acceptance refuses ambiguous or remote DSN before starting Go (%s)', dsn => {
  const result = run(dsn);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('History acceptance requires');
  expect(result.stderr).not.toContain('GO_STARTED');
});


test.each(['127.0.0.1', '::1', 'localhost'])('history acceptance starts its fixture with explicit loopback %s and no PostgreSQL environment overrides', host => {
  const result = run(`host=${host} port=5432 dbname=acceptance user=test password=synthetic sslmode=disable connect_timeout=5`);
  expect(result.stderr).toContain('GO_STARTED []');
});

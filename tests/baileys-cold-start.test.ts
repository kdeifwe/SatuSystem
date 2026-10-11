import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  discoverPersistedAuthAgentIds,
  getReconnectDelayMs,
  shouldClearAuthStateOnDisconnect,
  writeCredsWithBackup,
} from '../lib/channels/baileys-cold-start';

test('discovers agent ids from non-empty persisted auth directories', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-cold-start-'));
  const authRoot = path.join(tempRoot, 'baileys-auth');

  await fs.mkdir(path.join(authRoot, 'agent-1'), { recursive: true });
  await fs.writeFile(path.join(authRoot, 'agent-1', 'creds.json'), JSON.stringify({ registered: true }));

  await fs.mkdir(path.join(authRoot, 'agent-2'), { recursive: true });
  await fs.mkdir(path.join(authRoot, 'agent-3'), { recursive: true });

  try {
    const agentIds = await discoverPersistedAuthAgentIds(authRoot);
    assert.deepEqual(agentIds, ['agent-1']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('restores a registered backup creds file when main one is corrupted', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-cold-start-backup-'));
  const authRoot = path.join(tempRoot, 'baileys-auth');
  const agentDir = path.join(authRoot, 'agent-7');
  await fs.mkdir(agentDir, { recursive: true });

  const backupContent = JSON.stringify({ registered: true, noise: 'backup-session' });
  await fs.writeFile(path.join(agentDir, 'creds.json.bak'), backupContent);
  await fs.writeFile(path.join(agentDir, 'creds.json'), '{broken json');

  try {
    const agentIds = await discoverPersistedAuthAgentIds(authRoot);
    assert.deepEqual(agentIds, ['agent-7']);
    const restored = JSON.parse(await fs.readFile(path.join(agentDir, 'creds.json'), 'utf8'));
    assert.equal(restored.registered, true);
    assert.equal(restored.noise, 'backup-session');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('writes creds and backup atomically', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-creds-backup-'));
  const credsPath = path.join(tempRoot, 'creds.json');

  await writeCredsWithBackup(credsPath, JSON.stringify({ registered: true }));

  const current = JSON.parse(await fs.readFile(credsPath, 'utf8'));
  const backup = JSON.parse(await fs.readFile(`${credsPath}.bak`, 'utf8'));

  assert.equal(current.registered, true);
  assert.equal(backup.registered, true);

  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('selects retry delays for replaced and generic disconnects', () => {
  assert.equal(getReconnectDelayMs(1, 'replaced'), 30_000);
  assert.equal(getReconnectDelayMs(2, 'replaced'), 60_000);
  assert.equal(getReconnectDelayMs(4, 'replaced'), 300_000);
  assert.equal(getReconnectDelayMs(1, 'generic'), 5_000);
  assert.equal(getReconnectDelayMs(2, 'generic'), 10_000);
  assert.equal(getReconnectDelayMs(5, 'generic'), 60_000);
  assert.equal(getReconnectDelayMs(8, 'generic'), 300_000);
  assert.equal(getReconnectDelayMs(99, 'generic'), 300_000);
});

test('loggedOut disconnect never clears auth state', () => {
  assert.equal(shouldClearAuthStateOnDisconnect(401), false);
  assert.equal(shouldClearAuthStateOnDisconnect(undefined), true);
});

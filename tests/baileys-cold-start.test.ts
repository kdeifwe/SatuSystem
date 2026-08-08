import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { discoverPersistedAuthAgentIds } from '../lib/channels/baileys-cold-start';

test('discovers agent ids from non-empty persisted auth directories', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-cold-start-'));
  const authRoot = path.join(tempRoot, 'baileys-auth');

  await fs.mkdir(path.join(authRoot, 'agent-1'), { recursive: true });
  await fs.writeFile(path.join(authRoot, 'agent-1', 'creds.json'), '{}');

  await fs.mkdir(path.join(authRoot, 'agent-2'), { recursive: true });
  await fs.mkdir(path.join(authRoot, 'agent-3'), { recursive: true });

  try {
    const agentIds = await discoverPersistedAuthAgentIds(authRoot);
    assert.deepEqual(agentIds, ['agent-1']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

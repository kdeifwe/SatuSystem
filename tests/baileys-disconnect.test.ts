import test from 'node:test';
import assert from 'node:assert/strict';

import { existsSync } from 'node:fs';
import path from 'node:path';

test('disconnect route exists', () => {
  const routePath = path.join(process.cwd(), 'app/api/whatsapp/disconnect/route.ts');
  assert.equal(existsSync(routePath), true);
});

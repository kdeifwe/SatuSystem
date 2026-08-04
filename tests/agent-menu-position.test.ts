import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentMenuPosition } from '../lib/agent-menu-position';

test('positions the menu above the trigger when there is not enough space below', () => {
  const position = getAgentMenuPosition(
    { top: 500, bottom: 560, left: 200, right: 320, width: 120, height: 60 },
    { width: 800, height: 600 },
    { menuWidth: 208, menuHeight: 240 }
  );

  assert.equal(position.placement, 'top');
  assert.equal(position.top, 252);
  assert.equal(position.left, 112);
  assert.equal(position.maxHeight, 240);
});

test('positions the menu below the trigger when there is enough space below', () => {
  const position = getAgentMenuPosition(
    { top: 80, bottom: 140, left: 200, right: 320, width: 120, height: 60 },
    { width: 800, height: 600 },
    { menuWidth: 208, menuHeight: 240 }
  );

  assert.equal(position.placement, 'bottom');
  assert.equal(position.top, 148);
  assert.equal(position.left, 112);
  assert.equal(position.maxHeight, 240);
});

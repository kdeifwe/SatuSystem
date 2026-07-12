const assert = require('assert');
const { shouldBypassStyleValidation, shouldUseFallbackReply } = require('../lib/ai/response-policy');
const { buildSandboxLeadAttributes, isSandboxLeadAttributes } = require('../lib/ai/sandbox-context');

assert.strictEqual(
  shouldBypassStyleValidation({
    nodes: [{ id: 'n1', content: 'Отправь клиенту текст: "Сәлеметсіз бе!" и дождись ответов.' }],
  }),
  true,
  'script-style flow should bypass validator'
);

assert.strictEqual(
  shouldBypassStyleValidation({
    nodes: [{ id: 'n2', content: 'Спроси у клиента: "какой у вас любимый предмет?" и дождись ответа.' }],
  }, 'n2'),
  true,
  'script question node should bypass validator'
);

assert.strictEqual(
  shouldBypassStyleValidation({
    nodes: [{ id: 'n2', content: 'Расскажи клиенту о цене и закрой возражение.' }],
  }),
  false,
  'dynamic flow should keep validator enabled'
);

assert.strictEqual(
  shouldBypassStyleValidation({
    nodes: [{ id: 'n3', content: 'Если клиент просит цену, расскажи клиенту о цене и не отправляй готовый текст.' }],
  }, 'n3'),
  false,
  'instructional dynamic text should not be mistaken for scripted node'
);

assert.strictEqual(
  shouldUseFallbackReply(['Нельзя использовать списки в чате'], 'Сәлеметсіз бе! Привет, я готов помочь.'),
  false,
  'non-empty reply should not fallback for style-only issues'
);

assert.strictEqual(
  shouldUseFallbackReply(['Запрещённая фраза или термин: /\bAI\b/i'], 'Я бот и не могу помочь.'),
  true,
  'unsafe content should still trigger fallback'
);

const sandboxAttributes = buildSandboxLeadAttributes({ current_node_id: 'step-1' });
assert.strictEqual(sandboxAttributes.is_sandbox, true, 'sandbox lead attributes must be marked as sandbox');
assert.strictEqual(sandboxAttributes.current_node_id, 'step-1', 'existing lead attributes must be preserved');
assert.strictEqual(isSandboxLeadAttributes({ is_sandbox: true }), true, 'sandbox flag should be recognized');
assert.strictEqual(isSandboxLeadAttributes({ current_node_id: 'step-1' }), false, 'non-sandbox attributes should not be mistaken for sandbox');

console.log('funnel-engine-phase-a tests passed');

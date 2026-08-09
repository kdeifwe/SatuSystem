import assert from 'node:assert/strict';
import { buildFinalSynthesisContents, buildRetryContents } from '../lib/ai/retry-context.ts';

const baseContents = [{ role: 'user', parts: [{ text: 'курс цена' }] }];
const assistantParts = [{ functionCall: { name: 'searchKnowledgeBase', args: { query: 'курс цена' } } }];
const functionResponseParts = [{ functionResponse: { name: 'searchKnowledgeBase', response: { result: { found: true } } } }];

const retryContents = buildRetryContents(baseContents, assistantParts, functionResponseParts);

assert.equal(retryContents.length, 3);
assert.deepStrictEqual(retryContents[1], { role: 'model', parts: assistantParts });
assert.deepStrictEqual(retryContents[2], { role: 'user', parts: functionResponseParts });

const finalizedContents = buildFinalSynthesisContents(baseContents, assistantParts, [{ name: 'searchKnowledgeBase', result: { found: true, count: 1 } }], 'канша багасы');
assert.equal(finalizedContents.length, 3);
assert.equal(finalizedContents[2].role, 'user');
assert.equal(Array.isArray(finalizedContents[2].parts), true);
assert.ok((finalizedContents[2].parts as Array<Record<string, unknown>>).some((part) => typeof part.text === 'string' && part.text.includes('Сформулируй финальный ответ клиенту')));

import assert from 'node:assert/strict';
import { buildRetryContents } from '../lib/ai/retry-context.ts';

const baseContents = [{ role: 'user', parts: [{ text: 'курс цена' }] }];
const assistantParts = [{ functionCall: { name: 'searchKnowledgeBase', args: { query: 'курс цена' } } }];
const functionResponseParts = [{ functionResponse: { name: 'searchKnowledgeBase', response: { result: { found: true } } } }];

const retryContents = buildRetryContents(baseContents, assistantParts, functionResponseParts);

assert.equal(retryContents.length, 3);
assert.deepStrictEqual(retryContents[1], { role: 'model', parts: assistantParts });
assert.deepStrictEqual(retryContents[2], { role: 'user', parts: functionResponseParts });

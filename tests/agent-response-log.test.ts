import assert from 'node:assert/strict';
import { buildAgentResponseLogMeta } from '../lib/server/ai/orchestrator';

const meta = buildAgentResponseLogMeta({
  activeModel: 'gemini-3.5-flash',
  llmResponse: {
    provider: 'openai',
    usage: { promptTokens: 110, completionTokens: 90, totalTokens: 200 },
    rawResponse: { model: 'gpt-5.4-2026-03-05' },
  },
});

assert.equal(meta.actualProvider, 'openai');
assert.equal(meta.actualModel, 'gpt-5.4-mini');
assert.deepStrictEqual(meta.usageMetadata, {
  promptTokenCount: 110,
  candidatesTokenCount: 90,
  totalTokenCount: 200,
});

const fallbackMeta = buildAgentResponseLogMeta({
  activeModel: 'gemini-3.5-flash',
  llmResponse: {
    provider: 'gemini',
    usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 },
    rawResponse: {},
  },
});

assert.equal(fallbackMeta.actualProvider, 'gemini');
assert.equal(fallbackMeta.actualModel, 'gemini-3.5-flash');
assert.deepStrictEqual(fallbackMeta.usageMetadata, {
  promptTokenCount: 12,
  candidatesTokenCount: 7,
  totalTokenCount: 19,
});

console.log('agent response log meta ok');

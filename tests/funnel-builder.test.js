require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const assert = require('assert');
const { parseGeminiFlowResponse } = require('../lib/funnel/builder');

const rawWithMarkdown = "\n\n```json\n{\n  \"nodes\": [\n    { \"id\": \"start\", \"title\": \"Приветствие\", \"content\": \"Поздоровайся\" }\n  ],\n  \"edges\": [],\n  \"entryNodeId\": \"start\"\n}\n```\n";

const partialJson = "{\n  \"nodes\": [\n    { \"id\": \"start\", \"title\": \"Приветствие\", \"content\": \"Поздоровайся\" }\n  ],\n  \"edges\": [\n    { \"id\": \"e1\", \"from\": \"start\", \"to\": \"next\", \"label\": \"далее\" }\n  ],\n  \"entryNodeId\": \"start\"";

const parsed = parseGeminiFlowResponse(rawWithMarkdown);
assert.strictEqual(parsed.nodes.length, 1);
assert.strictEqual(parsed.entryNodeId, 'start');

const recovered = parseGeminiFlowResponse(partialJson);
assert.strictEqual(recovered.nodes.length, 1);
assert.strictEqual(recovered.edges.length, 1);
assert.strictEqual(recovered.entryNodeId, 'start');

console.log('funnel-builder parser tests passed');

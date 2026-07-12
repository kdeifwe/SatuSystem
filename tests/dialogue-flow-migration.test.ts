import assert from 'node:assert/strict';
import test from 'node:test';
import { convertDialogueFlowForMigration } from '../lib/funnel/dialogue-flow-migration.ts';

test('converts script/dynamic instructions and maps clear edge labels', () => {
  const result = convertDialogueFlowForMigration({
    entryNodeId: 'n1',
    nodes: [
      {
        id: 'n1',
        title: 'Приветствие',
        content: 'Отправь клиенту текст: "Привет!"',
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        title: 'Цена',
        content: 'Расскажи клиенту о цене.',
        position: { x: 100, y: 0 },
      },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', label: 'готов купить' },
      { id: 'e2', from: 'n1', to: 'n2', label: 'продолжить' },
      { id: 'e3', from: 'n2', to: 'n1', label: 'Цена озвучена' },
      { id: 'e4', from: 'n2', to: 'n1', label: 'обработано' },
      { id: 'e5', from: 'n2', to: 'n1', label: 'saw cheaper' },
    ],
  }, 'Тестовый агент');

  assert.equal(result.flow.nodes[0]?.message_type, 'script');
  assert.equal(result.flow.nodes[0]?.script_parts?.[0], 'Привет!');
  assert.equal(result.flow.nodes[1]?.message_type, 'dynamic');
  assert.equal(result.flow.nodes[1]?.instruction, 'Расскажи клиенту о цене.');
  assert.equal(result.flow.nodes[0]?.transitions[0]?.condition, 'purchase_confirmed');
  assert.equal(result.flow.nodes[0]?.transitions[1]?.condition, 'default');
  assert.equal(result.flow.nodes[1]?.transitions[0]?.condition, 'price_presented');
  assert.equal(result.flow.nodes[1]?.transitions[1]?.condition, 'objection_resolved');
  assert.equal(result.flow.nodes[1]?.transitions[2]?.condition, 'objection_raised');
  assert.equal(result.flow.nodes[0]?.fallback_condition, 'no_match');
  assert.equal(result.flow.nodes[0]?.fallback_target, 'n1');
});

test('deduplicates repeated transitions for the same node and target', () => {
  const result = convertDialogueFlowForMigration({
    entryNodeId: 'n1',
    nodes: [
      { id: 'n1', title: 'Шаг 1', content: 'Расскажи клиенту о цене.', position: { x: 0, y: 0 } },
      { id: 'n2', title: 'Шаг 2', content: 'Попроси подтверждение.', position: { x: 100, y: 0 } },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', label: 'обработано' },
      { id: 'e2', from: 'n1', to: 'n2', label: 'обработано' },
      { id: 'e3', from: 'n1', to: 'n2', label: 'обработано' },
    ],
  }, 'Агент');

  assert.equal(result.flow.nodes[0]?.transitions.length, 1);
  assert.equal(result.flow.nodes[0]?.transitions[0]?.condition, 'objection_resolved');
  assert.equal(result.flow.nodes[0]?.transitions[0]?.target, 'n2');
});

test('preserves dynamic node text without truncation', () => {
  const result = convertDialogueFlowForMigration({
    entryNodeId: 'n1',
    nodes: [
      { id: 'n1', title: 'Шаг 1', content: 'Расскажи клиенту о цене.', position: { x: 0, y: 0 } },
    ],
    edges: [],
  }, 'Агент');

  assert.equal(result.flow.nodes[0]?.instruction, 'Расскажи клиенту о цене.');
  assert.equal(result.textLengthSummary[0]?.delta, 0);
});

test('sets fallback defaults and detects extract fields from known prompts', () => {
  const result = convertDialogueFlowForMigration({
    entryNodeId: 'n1',
    nodes: [
      {
        id: 'n1',
        title: 'Приветствие',
        content: 'Отправь клиенту текст: "Сәлеметсіз бе! Есіміңіз? Қай сыныпта оқисыз?"',
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        title: 'Цена',
        content: 'Расскажи клиенту о цене.',
        position: { x: 100, y: 0 },
      },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', label: 'Ответы получены' },
    ],
  }, 'Агент');

  assert.deepEqual(result.flow.nodes[0]?.extract_fields, ['client_name', 'grade']);
  assert.equal(result.flow.nodes[0]?.fallback_condition, 'no_match');
  assert.equal(result.flow.nodes[0]?.fallback_target, 'n1');
  assert.equal(result.flow.nodes[0]?.transitions[0]?.condition, 'answers_received');
});

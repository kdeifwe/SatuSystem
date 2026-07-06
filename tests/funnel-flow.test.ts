import assert from 'node:assert/strict';
import test from 'node:test';
import { compileFlowToPrompt } from '../lib/funnel/compile.ts';
import { buildFunnelStepInstruction } from '../lib/ai/orchestrator.ts';

test('compileFlowToPrompt includes step instructions and transitions', () => {
  const flow = {
    entryNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        title: 'Приветствие',
        content: 'Поприветствуй клиента и спроси о задаче.',
        position: { x: 0, y: 0 },
      },
      {
        id: 'offer',
        title: 'Предложение',
        content: 'Предложи подходящий вариант.',
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: 'e1',
        from: 'greeting',
        to: 'offer',
        label: 'готов купить',
      },
    ],
  };

  const prompt = compileFlowToPrompt(flow as any);

  assert.match(prompt, /\[Шаг: greeting\]/);
  assert.match(prompt, /Поприветствуй клиента/);
  assert.match(prompt, /если "готов купить"/);
  assert.match(prompt, /advanceFunnelStep/);
});

test('buildFunnelStepInstruction includes the current step context', () => {
  const instruction = buildFunnelStepInstruction('step-2');

  assert.match(instruction, /step-2/);
  assert.match(instruction, /advanceFunnelStep/);
});

test('buildFunnelStepInstruction does not hide searchKnowledgeBase for step-9', () => {
  const instruction = buildFunnelStepInstruction('step-9');

  assert.match(instruction, /step-9/);
  assert.doesNotMatch(instruction, /Не ищи ответ через SearchKnowledgeBase/);
});

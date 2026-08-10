import assert from 'node:assert/strict';
import test from 'node:test';
import { compileFlowToPrompt } from '../lib/funnel/compile.ts';
import { buildFunnelStepInstruction } from '../lib/ai/orchestrator.ts';
import { resolveDialogueNodeExecution } from '../lib/server/ai/orchestrator.ts';

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
  assert.match(prompt, /система автоматически вызовет/);
  assert.match(prompt, /НИКОГДА не пишешь клиенту/);
  assert.doesNotMatch(prompt, /вызывать инструмент advanceFunnelStep/);
});

test('compileFlowToPrompt falls back to script_parts and preserves template placeholders', () => {
  const flow = {
    entryNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        title: 'Приветствие',
        content: '',
        message_type: 'script',
        script_parts: ['Здравствуйте, {{lead_name}}! Как я могу помочь?'],
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };

  const prompt = compileFlowToPrompt(flow as any);

  assert.match(prompt, /Здравствуйте, \{\{lead_name\}\}! Как я могу помочь\?/);
  assert.match(prompt, /\[Шаг: greeting\]/);
});

test('resolveDialogueNodeExecution uses node content for script nodes without script_parts', async () => {
  const flow = {
    entryNodeId: 'greeting',
    nodes: [
      {
        id: 'greeting',
        title: 'Приветствие',
        content: 'Сәлеметсізбе, {{lead_name}}! Есіміңіз кім болады?',
        message_type: 'script',
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };

  const result = await resolveDialogueNodeExecution(flow as any, 'greeting', false);

  assert.equal(result.mode, 'script');
  assert.deepEqual(result.messageParts?.map((part) => part.text), ['Сәлеметсізбе, {{lead_name}}! Есіміңіз кім болады?']);
  assert.match(result.finalAnswer ?? '', /Есіміңіз кім болады/);
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

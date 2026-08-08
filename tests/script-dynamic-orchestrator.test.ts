import assert from 'node:assert/strict';
import test from 'node:test';

const flow = {
  entryNodeId: 'node-1',
  nodes: [
    {
      id: 'node-1',
      title: 'Start',
      content: 'Start',
      position: { x: 0, y: 0 },
      message_type: 'script' as const,
      script_parts: ['Hello', 'World'],
    },
    {
      id: 'node-2',
      title: 'Dynamic',
      content: 'Dynamic',
      position: { x: 0, y: 0 },
      message_type: 'dynamic' as const,
    },
  ],
};

test('script node on second turn routes with saved reply instead of resending script', async () => {
  const routeCalls: Array<{ assistantReply: string; currentNodeId: string | null }> = [];
  let sentScriptCount = 0;
  const { handleScriptNodeTurn } = await import('../lib/server/ai/orchestrator.ts');

  const result = await handleScriptNodeTurn({
    admin: {} as any,
    agentId: 'agent-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    flow: flow as any,
    currentFunnelStep: 'node-1',
    pendingScriptNodeId: 'node-1',
    pendingScriptReply: 'saved script reply',
    userMessage: 'lead answer',
    routeExecutor: async (args) => {
      routeCalls.push({ assistantReply: args.assistantReply, currentNodeId: args.currentNodeId });
      return {
        skippedClassifier: true,
        condition: null,
        targetNodeId: null,
        shouldHandoff: false,
        classifierResult: null,
        handoffExecuted: false,
      };
    },
    sendScriptImpl: async () => {
      sentScriptCount += 1;
    },
    persistPendingScriptState: async () => undefined,
  });

  assert.equal(sentScriptCount, 0);
  assert.equal(routeCalls.length, 1);
  assert.equal(routeCalls[0].currentNodeId, 'node-1');
  assert.equal(routeCalls[0].assistantReply, 'saved script reply');
  assert.equal(result.shouldSendScript, false);
  assert.equal(result.shouldRoutePendingReply, true);
});

test('pending script reply for name answer preserves previous agent question and can advance to discovery', async () => {
  const routeCalls: Array<{ assistantReply: string; currentNodeId: string | null }> = [];
  const { handleScriptNodeTurn } = await import('../lib/server/ai/orchestrator.ts');

  const result = await handleScriptNodeTurn({
    admin: {} as any,
    agentId: 'agent-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    flow: flow as any,
    currentFunnelStep: 'node-1',
    pendingScriptNodeId: 'node-1',
    pendingScriptReply: 'Привет! Как вас зовут?',
    userMessage: 'Кыдырали',
    routeExecutor: async (args) => {
      routeCalls.push({ assistantReply: args.assistantReply, currentNodeId: args.currentNodeId });
      return {
        skippedClassifier: false,
        condition: 'answers_received',
        targetNodeId: 'node-2',
        shouldHandoff: false,
        classifierResult: { condition: 'answers_received', confidence: 0.9 },
        handoffExecuted: false,
      };
    },
    sendScriptImpl: async () => undefined,
    persistPendingScriptState: async () => undefined,
  });

  assert.equal(routeCalls.length, 1);
  assert.equal(routeCalls[0].currentNodeId, 'node-1');
  assert.equal(routeCalls[0].assistantReply, 'Привет! Как вас зовут?');
  assert.equal(result.shouldSendScript, false);
  assert.equal(result.shouldRoutePendingReply, true);
  assert.equal(result.currentFunnelStep, 'node-2');
});

test('first script turn should not be treated as a pending-reply routing turn', async () => {
  const { shouldRenderScriptMessage } = await import('../lib/server/ai/orchestrator.ts');

  assert.equal(shouldRenderScriptMessage({
    shouldRoutePendingReply: false,
    nodeExecutionMode: 'script',
    finalAnswer: 'Hello world',
  }), true);

  assert.equal(shouldRenderScriptMessage({
    shouldRoutePendingReply: true,
    nodeExecutionMode: 'script',
    finalAnswer: 'Hello world',
  }), false);
});

test('script node with non-empty script_parts returns a script path without calling Gemini', async () => {
  const calls: number[] = [];
  const { resolveDialogueNodeExecution } = await import('../lib/server/ai/orchestrator.ts');

  const result = await resolveDialogueNodeExecution(flow as any, 'node-1', true, {
    callGemini: async () => {
      calls.push(1);
      return { payload: { parts: [{ text: 'ignored' }] } };
    },
  });

  assert.equal(result.mode, 'script');
  assert.equal(calls.length, 0);
  assert.deepEqual(result.messageParts?.map((part) => part.text), ['Hello', 'World']);
  assert.ok(result.messageParts?.every((part) => typeof part.delayMs === 'number'));
});

test('script node with empty script_parts falls back to dynamic with a warning', async () => {
  const { resolveDialogueNodeExecution } = await import('../lib/server/ai/orchestrator.ts');

  const result = await resolveDialogueNodeExecution({
    ...flow,
    nodes: [
      {
        ...flow.nodes[0],
        script_parts: [],
      },
      flow.nodes[1],
    ],
  } as any, 'node-1', true, {
    callGemini: async () => ({ payload: { parts: [{ text: 'dynamic' }] } }),
  });

  assert.equal(result.mode, 'dynamic');
  assert.match(result.warning ?? '', /empty script_parts/i);
});

test('dynamic node uses the dynamic path and invokes Gemini', async () => {
  let geminiCallCount = 0;
  const { resolveDialogueNodeExecution } = await import('../lib/server/ai/orchestrator.ts');

  const result = await resolveDialogueNodeExecution(flow as any, 'node-2', true, {
    callGemini: async () => {
      geminiCallCount += 1;
      return { payload: { parts: [{ text: 'dynamic' }] } };
    },
  });

  assert.equal(result.mode, 'dynamic');
  assert.equal(geminiCallCount, 1);
});

test('node without message_type falls back to the dynamic path', async () => {
  const { resolveDialogueNodeExecution } = await import('../lib/server/ai/orchestrator.ts');

  const result = await resolveDialogueNodeExecution({
    ...flow,
    nodes: [
      {
        id: 'node-3',
        title: 'Legacy',
        content: 'Legacy',
        position: { x: 0, y: 0 },
      },
    ],
  } as any, 'node-3', true, {
    callGemini: async () => ({ payload: { parts: [{ text: 'legacy' }] } }),
  });

  assert.equal(result.mode, 'dynamic');
});

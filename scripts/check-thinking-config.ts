export {};

const { buildRoutingRequestBody } = await import('../lib/funnel/routing.ts');

(async () => {
  const node = {
    id: 'n1',
    title: 'Test',
    content: 'Test node',
    transitions: [{ condition: 'answers_received', target: 'n2' }],
  } as any;

  const req = buildRoutingRequestBody(node, 'Аня, 10 класс, хочу на ЕНТ', '');
  const thinking = (req as any).generationConfig?.thinkingConfig;
  if (!thinking || typeof thinking.thinkingBudget !== 'number') {
    console.error('FAIL: thinkingConfig missing or invalid', JSON.stringify(req, null, 2));
    process.exit(2);
  }
  if (thinking.thinkingBudget !== 0) {
    console.error('FAIL: thinkingBudget != 0', thinking);
    process.exit(3);
  }
  console.log('PASS: thinkingConfig.thinkingBudget === 0');
  process.exit(0);
})();

import type { FunnelFlow } from './types';

export function compileFlowToPrompt(flow: FunnelFlow | null | undefined): string {
  if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    return `
Воронка продаж пока не задана. Двигайся по шагам последовательно и делай переходы только по явным условиям клиента.
`;
  }

  const lines = flow.nodes.map((node) => {
    const outgoing = (flow.edges ?? []).filter((edge) => edge.from === node.id);
    const transitions = outgoing
      .map((edge) => `  → если "${edge.label}" — переходи на шаг "${edge.to}"`)
      .join('\n');

    return `[Шаг: ${node.id}] ${node.title}\n${node.content}\n${transitions}`;
  });

  return `
Воронка продаж состоит из шагов ниже. Ты ДОЛЖЕН двигаться по этой воронке и вызывать инструмент advanceFunnelStep(stepId, reason) когда переходишь на следующий шаг.
Текущий шаг тебе сообщается в контексте каждого сообщения.

${lines.join('\n\n')}
`;
}

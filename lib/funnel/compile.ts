import type { FunnelFlow } from './types';

export function getNodeInstructionText(node: FunnelFlow['nodes'][number] | null | undefined): string {
  const content = node && typeof node.content === 'string' ? node.content.trim() : '';
  if (content) return content;

  const scriptParts = Array.isArray(node?.script_parts)
    ? node.script_parts.filter((part): part is string => typeof part === 'string').map((part) => part.trim()).filter(Boolean)
    : [];

  if (scriptParts.length > 0) {
    return scriptParts.join('\n');
  }

  return node && typeof node.title === 'string' && node.title.trim() ? node.title.trim() : '';
}

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
    const instructionText = getNodeInstructionText(node);

    return `[Шаг: ${node.id}] ${node.title}\n${instructionText}\n${transitions}`;
  });

  return `
Воронка продаж состоит из шагов ниже. Ты ДОЛЖЕН двигаться по этой воронке и вызывать инструмент advanceFunnelStep(stepId, reason) когда переходишь на следующий шаг.
Текущий шаг тебе сообщается в контексте каждого сообщения.

${lines.join('\n\n')}
`;
}

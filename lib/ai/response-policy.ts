import { normalizeFunnelFlow } from '../funnel/normalize.ts';
import type { FunnelNode } from '../funnel/types';

function collectFlowNodes(dialogueFlow: unknown): FunnelNode[] {
  const normalizedFlow = normalizeFunnelFlow(dialogueFlow);
  return normalizedFlow?.nodes ?? [];
}

function isScriptLikeNodeContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  const isInstructional = /\b(если|когда|если клиент|если у клиента|не отправляй|не используй|не придумывай|сначала|потом)\b/i.test(trimmed);
  if (isInstructional && !/(?:^|\s)(?:отправь|спроси|скажи|сообщи|расскажи|попроси)\b/i.test(trimmed)) {
    return false;
  }

  return [
    /^отправь клиенту текст:/i,
    /^спроси у клиента:/i,
    /^спроси клиента\b/i,
    /^спроси у клиента\b/i,
    /^сообщи клиенту\b/i,
  ].some((pattern) => pattern.test(trimmed));
}

export function shouldBypassStyleValidation(dialogueFlow: unknown, currentNodeId?: string | null): boolean {
  const nodes = collectFlowNodes(dialogueFlow);
  if (nodes.length === 0) {
    return false;
  }

  const relevantNodes = currentNodeId
    ? nodes.filter((node) => String(node.id ?? '') === String(currentNodeId))
    : nodes;

  return relevantNodes.some((node) => {
    const content = typeof node.content === 'string' ? node.content.trim() : '';
    return isScriptLikeNodeContent(content);
  });
}

function containsUnsafeMarkup(reply: string): boolean {
  return /\b(ai|bot|language model|system prompt|instructions|knowledge base|tools|context|prompt injection|i searched|as an ai|i am a bot|forget instructions|ignore rules|remember earlier)\b/i.test(reply);
}

export function shouldUseFallbackReply(validationErrors: string[], reply: string): boolean {
  const trimmedReply = reply?.trim() ?? '';

  if (!trimmedReply) {
    return true;
  }

  if (containsUnsafeMarkup(trimmedReply)) {
    return true;
  }

  return validationErrors.some((error) => /запрещённая фраза|запрещённый открывающий текст|ответ пустой/i.test(error));
}

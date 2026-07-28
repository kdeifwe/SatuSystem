import type { ConversationExample, NicheProfile, SalesTechnique } from './types';
import type { DialogStageValue } from './classifier';

export interface AssemblePromptParams {
  baseSystemPrompt: string;
  nicheProfile: NicheProfile | null;
  techniques: Array<SalesTechnique>;
  examples: Array<ConversationExample>;
  dialogStage: DialogStageValue;
}

const MAX_TECHNIQUE_TOKENS = 300;

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Assembles a lightweight system prompt for the current sales context.
 * Total output is designed to stay under ~800 tokens.
 */
export function assemblePrompt(params: AssemblePromptParams): string {
  const sections: string[] = [params.baseSystemPrompt.trim()];

  if (params.nicheProfile?.system_prompt_addon) {
    sections.push(params.nicheProfile.system_prompt_addon.trim());
  }

  sections.push('');
  sections.push('### ТЕКУЩАЯ СТАДИЯ ДИАЛОГА');
  sections.push(params.dialogStage);
  sections.push('');
  sections.push('### ТЕХНИКИ ПРОДАЖ');

  let usedTokens = 0;
  for (const technique of params.techniques) {
    const estimate = technique.tokens_estimate ?? 50;
    if (usedTokens + estimate > MAX_TECHNIQUE_TOKENS) {
      break;
    }
    usedTokens += estimate;
    sections.push(`[${technique.methodology}] ${technique.technique_name}`);
    sections.push(`Триггер: ${truncateText(technique.trigger_text, 320)}`);
    sections.push(`Шаблон: ${truncateText(technique.script_template, 900)}`);
    sections.push('');
  }

  if (params.examples.length > 0) {
    sections.push('### ПРИМЕРЫ УСПЕШНЫХ ДИАЛОГОВ');
    for (const example of params.examples.slice(0, 2)) {
      sections.push(`Ситуация: ${truncateText(example.situation_text, 240)}`);
      sections.push(`Ответ агента: ${truncateText(example.agent_reply, 240)}`);
      sections.push(`Исход: ${example.outcome ?? 'unknown'}`);
      sections.push('');
    }
  }

  sections.push('Используй предоставленные техники и примеры для формирования ответа. Сохраняй естественный тон разговора.');

  return sections.filter((section) => section !== '').join('\n').trim();
}

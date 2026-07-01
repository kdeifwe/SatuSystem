const FORBIDDEN_PATTERNS = [
  /\bAI\b/i,
  /\bbot\b/i,
  /\blanguage model\b/i,
  /\bsystem prompt\b/i,
  /\binstructions\b/i,
  /\bknowledge base\b/i,
  /\btools\b/i,
  /\bcontext\b/i,
  /\bprompt injection\b/i,
  /\bI searched\b/i,
  /\bas an AI\b/i,
  /\bI am a bot\b/i,
  /\bforget instructions\b/i,
  /\bignore rules\b/i,
  /\bremember earlier\b/i,
];

const FORBIDDEN_OPENERS = [/^\s*(понял|хорошо|здравствуйте|привет|добрый|здарова)\b/i];
const BULLET_OR_NUMBERED_LIST = /(^|\n)\s*([-*•]|\d+\.)\s+/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgentAnswer(answer: string): ValidationResult {
  const errors: string[] = [];
  const text = answer.trim();

  if (!text) {
    errors.push('Ответ пустой');
    return { valid: false, errors };
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      errors.push(`Запрещённая фраза или термин: ${pattern}`);
    }
  }

  if (text.includes('—')) {
    errors.push('Запрещённый длинный дефис');
  }

  if (BULLET_OR_NUMBERED_LIST.test(text)) {
    errors.push('Нельзя использовать списки в чате');
  }

  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount > 1) {
    errors.push('Больше одного вопроса в сообщении');
  }

  const sentenceCount = text.split(/[.!?]+/).filter((segment) => segment.trim().length > 0).length;
  if (sentenceCount > 4) {
    errors.push('Слишком много предложений в одном сообщении');
  }

  if (FORBIDDEN_OPENERS.some((pattern) => pattern.test(text))) {
    errors.push('Запрещённый открывающий текст');
  }

  return { valid: errors.length === 0, errors };
}

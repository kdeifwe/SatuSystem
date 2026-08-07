export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgentAnswer(answer: string): ValidationResult {
  const text = (answer ?? '').trim();

  if (!text) {
    return { valid: false, errors: ['Ответ пустой'] };
  }

  return { valid: true, errors: [] };
}

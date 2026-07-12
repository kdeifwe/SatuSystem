export type SandboxLeadAttributes = Record<string, unknown> & {
  is_sandbox?: boolean;
  sandbox_origin?: string;
};

export function buildSandboxLeadAttributes(existingAttributes?: Record<string, unknown> | null): SandboxLeadAttributes {
  const baseAttributes = existingAttributes && typeof existingAttributes === 'object' ? { ...existingAttributes } : {};

  return {
    ...baseAttributes,
    is_sandbox: true,
    sandbox_origin: 'sandbox',
  };
}

export function buildConversationInsertData(existingData?: Record<string, unknown> | null, isSandbox = false): Record<string, unknown> {
  const baseData = existingData && typeof existingData === 'object' ? { ...existingData } : {};

  return {
    ...baseData,
    ...(isSandbox ? { is_sandbox: true } : {}),
  };
}

export function buildSandboxConversationInsertData(existingData?: Record<string, unknown> | null): Record<string, unknown> {
  return buildConversationInsertData(existingData, true);
}

export function isSandboxLeadAttributes(attributes?: Record<string, unknown> | null): boolean {
  return Boolean(attributes && typeof attributes === 'object' && (attributes.is_sandbox === true || attributes.sandbox_origin === 'sandbox'));
}

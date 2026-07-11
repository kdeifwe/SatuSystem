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

export function isSandboxLeadAttributes(attributes?: Record<string, unknown> | null): boolean {
  return Boolean(attributes && typeof attributes === 'object' && (attributes.is_sandbox === true || attributes.sandbox_origin === 'sandbox'));
}

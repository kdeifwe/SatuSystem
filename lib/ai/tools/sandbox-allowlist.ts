const ALLOWED_IN_SANDBOX = new Set(['searchKnowledgeBase', 'getCurrentDate', 'advanceFunnelStep']);

export function isSandboxToolAllowed(toolName: string): boolean {
  return ALLOWED_IN_SANDBOX.has(toolName);
}

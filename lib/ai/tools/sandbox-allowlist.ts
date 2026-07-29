const ALLOWED_IN_SANDBOX = new Set([
  'searchKnowledgeBase',
  'getCurrentDate',
  'advanceFunnelStep',
  'createKaspiInvoice',
  'redirectToOperator',
]);

export function isSandboxToolAllowed(toolName: string): boolean {
  return ALLOWED_IN_SANDBOX.has(toolName);
}

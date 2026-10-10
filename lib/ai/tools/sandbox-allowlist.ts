function readSandboxCalendarWriteFlag(): boolean {
  const value = String(process.env.SANDBOX_ALLOW_CALENDAR_WRITE ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

const ALLOWED_IN_SANDBOX = new Set([
  'searchKnowledgeBase',
  'getCurrentDate',
  'advanceFunnelStep',
  'createKaspiInvoice',
  'sendKaspiPay',
  'redirectToOperator',
  'checkCalendarAvailability',
]);

export function isSandboxToolAllowed(toolName: string): boolean {
  if (readSandboxCalendarWriteFlag()) {
    if (toolName === 'createCalendarEvent' || toolName === 'cancelCalendarEvent') {
      return true;
    }
  }

  return ALLOWED_IN_SANDBOX.has(toolName);
}

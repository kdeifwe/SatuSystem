export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const m = await import('@/lib/channels/baileys-client');
    await m.startWhatsAppRestore?.();
  }
}

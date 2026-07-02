import process from 'node:process';

async function main() {
  const token = process.env.TELEGRAM_NOTIFICATIONS_BOT_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!token || !appUrl) {
    throw new Error('TELEGRAM_NOTIFICATIONS_BOT_TOKEN and NEXT_PUBLIC_APP_URL must be set');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${appUrl.replace(/\/$/, '')}/api/extensions/telegram-notify/webhook` }),
  });

  const payload = await response.json().catch(() => ({}));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

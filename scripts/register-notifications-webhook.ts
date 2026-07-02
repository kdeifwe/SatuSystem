import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const token = process.env.TELEGRAM_NOTIFICATIONS_BOT_TOKEN!;
const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
const webhookUrl = `${appUrl}/api/extensions/telegram-notify/webhook`;

async function register() {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message'],
    }),
  });

  const data = await res.json();
  console.log('Webhook URL:', webhookUrl);
  console.log('Telegram response:', JSON.stringify(data, null, 2));

  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json());
  console.log('Webhook info:', JSON.stringify(info, null, 2));
}

register().catch((error) => {
  console.error(error);
  process.exit(1);
});

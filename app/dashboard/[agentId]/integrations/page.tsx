'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

type IntegrationType = 'telegram_bot' | 'telegram_userbot' | 'whatsapp' | 'instagram';

type IntegrationStatus = {
  telegram_bot?: { connected: boolean; bot_username?: string | null } | null;
  telegram_userbot?: { connected: boolean; phone?: string | null } | null;
  whatsapp?: { connected: boolean } | null;
  instagram?: { connected: boolean } | null;
};

interface Integration {
  id: IntegrationType;
  name: string;
  description: string;
  icon: string;
  iconBg: string;
  isOfficial: boolean;
  warning?: string;
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'telegram_bot',
    name: 'Telegram (бот)',
    description: 'Подключите вашего ИИ-агента к Telegram для автоматических ответов на сообщения и управления диалогами',
    icon: '✈️',
    iconBg: 'bg-blue-400',
    isOfficial: true,
  },
  {
    id: 'telegram_userbot',
    name: 'Telegram (личный аккаунт)',
    description: 'Подключите настоящий личный аккаунт Telegram, чтобы ИИ-агент отвечал и писал первым от лица человека, а не бота',
    icon: '✈️',
    iconBg: 'bg-blue-500',
    isOfficial: false,
    warning: 'Аккаунт может быть заблокирован. Автоматизация личного аккаунта Telegram нарушает условия использования и может привести к блокировке номера. Используйте на свой страх и риск.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Подключите вашего ИИ-агента к WhatsApp через официальный Meta WhatsApp Cloud API',
    icon: '💬',
    iconBg: 'bg-green-500',
    isOfficial: true,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Интегрируйтесь с Instagram Direct для автоматических ответов на сообщения и взаимодействия с подписчиками',
    icon: '📷',
    iconBg: 'bg-gradient-to-br from-purple-500 to-pink-500',
    isOfficial: false,
    warning: 'Требует бизнес-аккаунт Instagram привязанный к Facebook. Используйте на свой страх и риск.',
  },
];

export default function IntegrationsPage({ params }: { params: { agentId: string } }) {
  const [selected, setSelected] = useState<IntegrationType | null>(null);
  const [connectedChannels, setConnectedChannels] = useState<IntegrationStatus>({});

  const refreshStatus = async () => {
    try {
      const response = await fetch(`/api/integrations/status?agentId=${params.agentId}`);
      const data = await response.json();
      setConnectedChannels(data as IntegrationStatus);
    } catch {
      setConnectedChannels({});
    }
  };

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      if (!isActive) return;
      await refreshStatus();
    };
    load();
    return () => {
      isActive = false;
    };
  }, [params.agentId]);

  if (selected) {
    return (
      <IntegrationDetail
        type={selected}
        agentId={params.agentId}
        connectedStatus={connectedChannels}
        onBack={() => setSelected(null)}
        onStatusChanged={refreshStatus}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-gray-100">
        <h1 className="text-base font-semibold text-gray-900">Интеграции</h1>
        <p className="text-xs text-gray-500">Подключите каналы для общения с клиентами</p>
      </div>

      <div className="px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {INTEGRATIONS.map((integration) => {
            const isConnected = Boolean(
              (integration.id === 'telegram_bot' && connectedChannels.telegram_bot?.connected) ||
              (integration.id === 'telegram_userbot' && connectedChannels.telegram_userbot?.connected) ||
              (integration.id === 'whatsapp' && connectedChannels.whatsapp?.connected) ||
              (integration.id === 'instagram' && connectedChannels.instagram?.connected)
            );

            return (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                onClick={() => setSelected(integration.id)}
                isConnected={isConnected}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({ integration, onClick, isConnected }: {
  integration: Integration;
  onClick: () => void;
  isConnected: boolean;
}) {
  return (
    <div className={`border rounded-xl p-5 transition-all bg-white ${
      isConnected ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-blue-200 hover:shadow-sm'
    }`}>
      <div className="flex items-start gap-4 mb-4">
        <div className={`w-12 h-12 rounded-xl ${integration.iconBg} flex items-center justify-center text-white text-xl flex-shrink-0`}>
          {integration.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900 text-sm">{integration.name}</h3>
            {isConnected && <span className="text-xs text-green-600 font-medium">✓ Подключено</span>}
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{integration.description}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        className={`w-full py-2 rounded-lg text-sm transition-colors ${
          isConnected
            ? 'border border-green-200 text-green-700 hover:bg-green-100'
            : 'border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
        }`}
      >
        {isConnected ? 'Настроить' : 'Подключить'}
      </button>
    </div>
  );
}

function IntegrationDetail({ type, agentId, connectedStatus, onBack, onStatusChanged }: {
  type: IntegrationType;
  agentId: string;
  connectedStatus: IntegrationStatus;
  onBack: () => void;
  onStatusChanged: () => Promise<void>;
}) {
  const integration = INTEGRATIONS.find((item) => item.id === type)!;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-gray-100">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-3">
          ← Назад к интеграциям
        </button>
        <h1 className="text-base font-semibold text-gray-900">{integration.name}</h1>
      </div>

      <div className="px-6 py-6 max-w-2xl">
        {integration.warning && (
          <div className="flex gap-3 p-4 bg-red-50 border border-red-200 rounded-xl mb-6">
            <span className="text-red-500 flex-shrink-0">⚠️</span>
            <p className="text-sm text-red-700">{integration.warning}</p>
          </div>
        )}

        {type === 'telegram_bot' && (
          <TelegramBotForm
            agentId={agentId}
            connectedStatus={connectedStatus}
            onStatusChanged={onStatusChanged}
          />
        )}
        {type === 'telegram_userbot' && <TelegramUserbotForm agentId={agentId} />}
        {type === 'whatsapp' && <WhatsAppForm agentId={agentId} />}
        {type === 'instagram' && <InstagramForm agentId={agentId} />}
      </div>
    </div>
  );
}

function TelegramBotForm({ agentId, connectedStatus, onStatusChanged }: {
  agentId: string;
  connectedStatus: IntegrationStatus;
  onStatusChanged: () => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; botName?: string } | null>(null);
  const [existingBot, setExistingBot] = useState<{ bot_username?: string } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      setChecking(true);
      try {
        const res = await fetch(`/api/integrations/status?agentId=${agentId}`);
        const data = await res.json();
        if (!isActive) return;
        if (data?.telegram_bot?.connected) {
          setExistingBot({ bot_username: data.telegram_bot.bot_username });
          setResult({ success: true, botName: data.telegram_bot.bot_username });
        } else {
          setExistingBot(null);
          setResult(null);
        }
      } catch {
        if (isActive) {
          setExistingBot(null);
          setResult(null);
        }
      } finally {
        if (isActive) setChecking(false);
      }
    };
    load();
    return () => {
      isActive = false;
    };
  }, [agentId, connectedStatus]);

  async function connect() {
    if (!token.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/telegram-bot/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, token }),
      });
      const data = await res.json();
      setResult(data);
      if (data?.success) {
        await onStatusChanged();
        setExistingBot({ bot_username: data.botName });
      }
    } catch {
      setResult({ error: 'Ошибка подключения' });
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/telegram-bot/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      const data = await res.json();
      if (data?.success) {
        setExistingBot(null);
        setResult(null);
        await onStatusChanged();
      } else {
        setResult({ error: data?.error ?? 'Ошибка отключения' });
      }
    } catch {
      setResult({ error: 'Ошибка отключения' });
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return <div className="text-sm text-gray-500">Проверяю текущее состояние…</div>;
  }

  if (existingBot) {
    return (
      <div>
        <h2 className="font-medium text-gray-900 mb-2">Telegram (бот)</h2>
        <p className="text-sm text-gray-500 mb-4">Бот уже подключён и готов принимать сообщения.</p>
        <div className="flex gap-3 p-4 bg-green-50 border border-green-200 rounded-xl mb-4">
          <span>✅</span>
          <div>
            <p className="text-sm font-medium text-green-800">Бот подключён!</p>
            {existingBot.bot_username && <p className="text-xs text-green-600">@{existingBot.bot_username}</p>}
          </div>
        </div>
        <button
          onClick={disconnect}
          disabled={loading}
          className="px-4 py-2.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? '...' : 'Отключить'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-medium text-gray-900 mb-2">Telegram (бот)</h2>
      <p className="text-sm text-gray-500 mb-4">
        Для подключения ИИ-агента к Telegram боту, вам необходимо получить API токен в Telegram.
      </p>

      <div className="bg-gray-50 rounded-xl p-4 mb-4">
        <p className="text-xs font-medium text-gray-700 mb-2">Инструкция:</p>
        <ol className="text-xs text-gray-600 space-y-1">
          <li>1. Откройте Telegram и найдите <span className="text-blue-600 font-medium">@BotFather</span></li>
          <li>2. Отправьте команду /newbot и следуйте инструкциям</li>
          <li>3. BotFather даст вам уникальный API токен</li>
          <li>4. Сохраните токен в безопасном месте</li>
          <li>5. Вставьте скопированный токен сюда</li>
        </ol>
      </div>

      <div className="flex gap-2">
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Введите API токен бота"
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />
        <button
          onClick={connect}
          disabled={loading || !token.trim()}
          className="px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '...' : 'Создать'}
        </button>
      </div>
      {result?.error && <p className="text-red-500 text-xs mt-2">{result.error}</p>}
    </div>
  );
}

function TelegramUserbotForm({ agentId }: { agentId: string }) {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'credentials' | 'phone' | 'code' | 'done'>('credentials');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');

  if (step === 'credentials') {
    return (
      <div>
        <h2 className="font-medium text-gray-900 mb-4">Telegram — личный аккаунт</h2>
        <p className="text-sm text-gray-500 mb-4">
          Подключите настоящий аккаунт Telegram. ИИ-агент будет читать входящие личные сообщения и отвечать от лица человека.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <p className="text-sm font-medium text-blue-800 mb-1">Получите API ID и Hash:</p>
          <ol className="text-xs text-blue-700 space-y-1">
            <li>1. Зайдите на <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className="underline font-medium">my.telegram.org/apps</a></li>
            <li>2. Войдите в свой аккаунт Telegram</li>
            <li>3. Создайте приложение (название любое)</li>
            <li>4. Скопируйте App api_id и App api_hash</li>
          </ol>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">API ID</label>
            <input
              value={apiId}
              onChange={(event) => setApiId(event.target.value)}
              placeholder="12345678"
              type="number"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">API Hash</label>
            <input
              value={apiHash}
              onChange={(event) => setApiHash(event.target.value)}
              placeholder="0123456789abcdef0123456789abcdef"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
          <button
            onClick={() => {
              if (apiId && apiHash) setStep('phone');
            }}
            disabled={!apiId || !apiHash}
            className="px-6 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Далее →
          </button>
        </div>
      </div>
    );
  }

  if (step === 'phone') {
    return (
      <div>
        <p className="text-sm text-gray-600 mb-3">Введите номер телефона аккаунта Telegram</p>
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+77001234567"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 mb-3"
        />
        <button
          onClick={async () => {
            setLoading(true);
            setError('');
            try {
              const res = await fetch('/api/integrations/telegram-userbot/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, phone, apiId, apiHash }),
              });
              const data = await res.json();
              if (data.sessionId) {
                setSessionId(data.sessionId);
                setStep('code');
              } else {
                setError(data.error ?? 'Ошибка');
              }
            } catch {
              setError('Ошибка отправки');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || !phone.trim()}
          className="px-6 py-2.5 bg-gray-800 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {loading ? 'Отправляю...' : 'Получить код'}
        </button>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div>
        <p className="text-sm text-gray-600 mb-3">Код отправлен в Telegram на номер {phone}</p>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="12345"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 mb-3"
        />
        <button
          onClick={async () => {
            setLoading(true);
            setError('');
            try {
              const res = await fetch('/api/integrations/telegram-userbot/verify-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, sessionId, code, phone, apiId, apiHash }),
              });
              const data = await res.json();
              if (data.success) {
                setStep('done');
              } else {
                setError(data.error ?? 'Неверный код');
              }
            } catch {
              setError('Ошибка верификации');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || !code.trim()}
          className="px-6 py-2.5 bg-gray-800 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {loading ? 'Проверяю...' : 'Подтвердить'}
        </button>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
      <span>✅</span>
      <div>
        <p className="text-sm font-medium text-green-800">Аккаунт Telegram подключён!</p>
        <p className="text-xs text-green-600">Агент будет отвечать от вашего имени</p>
      </div>
    </div>
  );
}

function WhatsAppForm({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<'connected' | 'qr' | 'disconnected' | 'error'>('disconnected');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [jid, setJid] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const syncStatus = (data: any) => {
    const nextStatus = data?.status ?? 'disconnected';
    setStatus(nextStatus === 'connected' ? 'connected' : nextStatus === 'qr' ? 'qr' : nextStatus === 'error' ? 'error' : 'disconnected');
    setQrDataUrl(nextStatus === 'qr' ? (data?.qrDataUrl ?? null) : null);
    setJid(data?.jid ?? null);
    setLastError(data?.lastError ?? null);
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/whatsapp/status?agentId=${agentId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Ошибка статуса');
      }

      syncStatus(data);
      return data;
    } catch (error) {
      setStatus('error');
      setLastError(error instanceof Error ? error.message : 'Не удалось получить статус');
      return null;
    }
  };

  const connect = async () => {
    setLoading(true);
    setLastError(null);

    try {
      const response = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? 'Ошибка подключения');
      }

      syncStatus(data);
    } catch (error) {
      setStatus('error');
      setLastError(error instanceof Error ? error.message : 'Ошибка подключения');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    const subscribeToStatus = async () => {
      const initialData = await fetchStatus();
      if (!isMounted || !initialData?.channelId) return;

      realtimeChannel = supabase.channel(`whatsapp-channel-status-${initialData.channelId}`);
      realtimeChannel
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'channels',
            filter: `id=eq.${initialData.channelId}`,
          },
          async (payload) => {
            const nextStatus = payload.new?.connection_status ?? (payload.new?.is_active ? 'connected' : 'disconnected');
            const normalizedStatus = nextStatus === 'qr' ? 'qr' : nextStatus === 'connected' ? 'connected' : nextStatus === 'error' ? 'error' : 'disconnected';
            setStatus(normalizedStatus);
            setLastError(payload.new?.last_error ?? null);

            if (normalizedStatus === 'qr') {
              try {
                const qrResponse = await fetch(`/api/whatsapp/qr?agentId=${agentId}`);
                const qrData = await qrResponse.json();
                setQrDataUrl(qrData.qrDataUrl ?? null);
              } catch {
                setQrDataUrl(null);
              }
            } else {
              setQrDataUrl(null);
            }
          }
        )
        .subscribe();
    };

    void subscribeToStatus();

    return () => {
      isMounted = false;
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, [agentId]);

  return (
    <div>
      <h2 className="font-medium text-gray-900 mb-2">WhatsApp</h2>
      <p className="text-sm text-gray-500 mb-4">
        Подключите WhatsApp через QR-код. Сканируйте код в WhatsApp на телефоне: Настройки → Связанные устройства → Привязать устройство.
      </p>

      {status === 'connected' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 mb-4">
          <p className="text-sm font-medium text-green-800">WhatsApp подключен</p>
          {jid && <p className="text-sm text-green-700">JID: {jid}</p>}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4">
          <p className="text-sm font-medium text-red-800">Ошибка подключения</p>
          <p className="text-sm text-red-700 mb-3">{lastError ?? 'Неизвестная ошибка'}</p>
          <button
            onClick={connect}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Повтор...' : 'Попробовать снова'}
          </button>
        </div>
      )}

      {status === 'qr' && qrDataUrl && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-4">
          <p className="text-sm font-medium text-blue-800 mb-3">Отсканируйте код в приложении WhatsApp</p>
          <img src={qrDataUrl} alt="WhatsApp QR" className="max-w-full rounded-lg mx-auto" />
        </div>
      )}

      {status !== 'connected' && (
        <button
          onClick={connect}
          disabled={loading}
          className="px-6 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Подключаю...' : 'Подключить WhatsApp'}
        </button>
      )}

      {status === 'qr' && !qrDataUrl && (
        <p className="text-sm text-gray-500 mt-3">Ждём QR-кода, подождите...</p>
      )}
    </div>
  );
}

function InstagramForm({ agentId }: { agentId: string }) {
  return (
    <div>
      <h2 className="font-medium text-gray-900 mb-4">Instagram</h2>
      <p className="text-sm text-gray-500 mb-4">
        Instagram интеграция будет доступна в следующей версии. Требует верифицированный бизнес аккаунт Facebook.
      </p>

      <div className="bg-gray-50 rounded-xl p-4 mb-4">
        <p className="text-xs font-medium text-gray-700 mb-2">Что нужно для запуска:</p>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• Верифицированный бизнес-аккаунт Facebook</li>
          <li>• Привязанный к нему аккаунт Instagram</li>
          <li>• Подтверждённые разрешения для сообщений</li>
        </ul>
      </div>

      <button className="px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm rounded-lg hover:opacity-90">
        Войти через Facebook
      </button>
    </div>
  );
}

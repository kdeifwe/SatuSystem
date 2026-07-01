'use client';

import { useRouter } from 'next/navigation';
import { Globe, MessageCircle, Phone, User } from 'lucide-react';
import AvatarInitial from './AvatarInitial';

type DialogListItemProps = {
  agentId: string;
  conversationId: string | null;
  name?: string | null;
  lastMessage?: string | null;
  lastSender?: string | null;
  lastMessageAt?: string | null;
  channelType?: string | null;
  unreadCount?: number | null;
  selected?: boolean;
};

function formatItemTime(timestamp?: string | null) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
}

function getChannelLabel(channelType?: string | null) {
  if (!channelType) return 'Web';
  const normalized = channelType.toLowerCase();
  if (normalized.includes('wa') || normalized.includes('whatsapp')) return 'WA';
  if (normalized.includes('tg') || normalized.includes('telegram')) return 'TG';
  return 'Web';
}

function ChannelIcon({ channelType }: { channelType?: string | null }) {
  const normalized = (channelType || '').toLowerCase();
  if (normalized.includes('wa') || normalized.includes('whatsapp')) {
    return <Phone size={10} />;
  }
  if (normalized.includes('tg') || normalized.includes('telegram')) {
    return <MessageCircle size={10} />;
  }
  return <Globe size={10} />;
}

export default function DialogListItem({
  agentId,
  conversationId,
  name,
  lastMessage,
  lastSender,
  lastMessageAt,
  channelType,
  unreadCount,
  selected,
}: DialogListItemProps) {
  const router = useRouter();

  const handleSelect = () => {
    if (!conversationId) return;
    router.push(`/dashboard/${agentId}/dialogs?conversation=${conversationId}`);
  };

  const preview = lastMessage ? (lastSender === 'operator' ? `Вы: ${lastMessage}` : lastMessage) : 'Нет сообщений';
  const channelLabel = getChannelLabel(channelType);

  return (
    <button
      type="button"
      onClick={handleSelect}
      className={`w-full text-left ${
        selected ? 'bg-[#EEF2FF] border-l-2 border-l-[#1557FF]' : 'hover:bg-gray-50'
      } flex items-start gap-3 px-4 py-3 border-b border-gray-50 transition`}
    >
      <AvatarInitial name={name} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center gap-2">
          <p className="truncate text-sm font-medium text-gray-900">{name || 'Без имени'}</p>
          <span className="flex-shrink-0 text-xs text-gray-400">{formatItemTime(lastMessageAt)}</span>
        </div>
        <div className="mt-0.5 flex justify-between items-start gap-2">
          <p className="truncate text-xs text-gray-500 flex-1">{preview}</p>
          <div className="ml-1 flex flex-shrink-0 items-center gap-1">
            {unreadCount && unreadCount > 0 ? <span className="h-2 w-2 rounded-full bg-[#1557FF]" /> : null}
            <span className="flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium bg-gray-100 text-gray-500">
              <ChannelIcon channelType={channelType} />
              {channelLabel}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal, CalendarDays, Plus, Search, PhoneCall, Globe, MoreHorizontal, X } from 'lucide-react';
import DialogListItem from './DialogListItem';

export type DialogItem = {
  leadId: string;
  conversationId: string | null;
  externalId?: string | null;
  name?: string | null;
  status?: string | null;
  aiEnabled?: boolean | null;
  tags?: string[] | null;
  updatedAt?: string | null;
  unreadCount?: number | null;
  channelType?: string | null;
  lastMessage?: string | null;
  lastSender?: string | null;
  lastMessageAt?: string | null;
};

const GROUPS = ['Сегодня', 'На этой неделе', 'В этом месяце', 'Ранее'] as const;

type DialogListProps = {
  items: DialogItem[];
  agentId: string;
  selectedConversationId?: string;
};

function getGroupLabel(date?: string | null) {
  if (!date) return 'Ранее';

  const target = new Date(date);
  const now = new Date();

  const sameDay =
    target.getDate() === now.getDate() &&
    target.getMonth() === now.getMonth() &&
    target.getFullYear() === now.getFullYear();

  if (sameDay) return 'Сегодня';

  const diffDays = Math.floor((now.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return 'На этой неделе';
  if (target.getMonth() === now.getMonth() && target.getFullYear() === now.getFullYear()) return 'В этом месяце';
  return 'Ранее';
}

function groupItems(items: DialogItem[]) {
  const groups: Record<string, DialogItem[]> = {
    Сегодня: [],
    'На этой неделе': [],
    'В этом месяце': [],
    Ранее: [],
  };

  for (const item of items) {
    const group = getGroupLabel(item.lastMessageAt ?? item.updatedAt);
    groups[group].push(item);
  }

  return GROUPS.map((label) => ({ label, items: groups[label] }));
}

export default function DialogList({ items, agentId, selectedConversationId }: DialogListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const query = search.toLowerCase();
    return items.filter((item) => {
      return (
        item.name?.toLowerCase().includes(query) ||
        item.lastMessage?.toLowerCase().includes(query) ||
        item.externalId?.toLowerCase().includes(query)
      );
    });
  }, [items, search]);

  const grouped = useMemo(() => groupItems(filteredItems), [filteredItems]);
  const hasLeads = items.length > 0;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-12 items-center justify-between border-b border-gray-100 px-4">
        {searchOpen ? (
          <div className="flex-1">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:border-blue-300 focus:outline-none"
            />
          </div>
        ) : (
          <span className="text-sm font-semibold text-gray-900">Диалоги</span>
        )}

        <div className="flex items-center gap-2">
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <SlidersHorizontal size={16} />
          </button>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <CalendarDays size={16} />
          </button>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <Plus size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen((current) => !current)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
          >
            {searchOpen ? <X size={16} /> : <Search size={16} />}
          </button>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <PhoneCall size={16} />
          </button>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <Globe size={16} />
          </button>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!hasLeads ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M21 16V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8m16 0H3m18 0a2 2 0 01-2 2H5a2 2 0 01-2-2" />
              </svg>
            </div>
            <h2 className="mt-4 text-sm font-semibold text-gray-900">Диалогов пока нет</h2>
            <p className="mt-2 text-sm text-gray-400">Сообщения из WhatsApp и Telegram появятся здесь автоматически</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-gray-500">Ничего не найдено</div>
        ) : (
          grouped.map((group) => {
            if (!group.items.length) return null;
            return (
              <div key={group.label}>
                <div className="sticky top-0 z-10 bg-white px-4 py-2 text-xs font-medium text-gray-400">{group.label}</div>
                {group.items.map((item) => (
                  <DialogListItem
                    key={item.conversationId ?? item.leadId}
                    agentId={agentId}
                    conversationId={item.conversationId}
                    name={item.name}
                    lastMessage={item.lastMessage}
                    lastSender={item.lastSender}
                    lastMessageAt={item.lastMessageAt}
                    channelType={item.channelType}
                    unreadCount={item.unreadCount}
                    selected={item.conversationId === selectedConversationId}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

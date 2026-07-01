import { type ReactNode } from 'react';

export type MessageBubbleProps = {
  sender: 'user' | 'ai' | 'operator' | 'system';
  content: string;
  createdAt: string;
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ sender, content, createdAt }: MessageBubbleProps) {
  if (sender === 'system') {
    return (
      <div className="flex justify-center mb-2">
        <div className="rounded-full bg-gray-100 px-3 py-1 text-xs italic text-gray-400">{content}</div>
      </div>
    );
  }

  const isUser = sender === 'user';
  const isOperator = sender === 'operator';
  const bubbleClass = isUser
    ? 'bg-white border border-gray-200 text-gray-900 rounded-2xl rounded-tl-sm'
    : isOperator
    ? 'bg-gray-700 text-white rounded-2xl rounded-tr-sm'
    : 'bg-[#1557FF] text-white rounded-2xl rounded-tr-sm';

  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-3`}> 
      <div className="max-w-[70%]">
        <div className={`${bubbleClass} px-4 py-2.5 text-sm shadow-sm`}>{content}</div>
        <div className={`mt-1 text-[10px] text-gray-400 ${isUser ? 'text-left' : 'text-right'}`}>
          {isOperator ? 'Оператор • ' : ''}
          {formatTime(createdAt)}
        </div>
      </div>
    </div>
  );
}

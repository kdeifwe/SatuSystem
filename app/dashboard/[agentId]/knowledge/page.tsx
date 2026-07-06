'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  FileText,
  Trash2,
  Eye,
  Pencil,
  Plus,
  Search,
  X,
  Download,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  RefreshCw,
  Instagram,
} from 'lucide-react';

type Source = {
  id: string;
  title: string;
  type: string;
  status: string;
  file_size?: number;
  chunks_count: number;
  metadata?: any;
};

type Chunk = {
  id: string;
  content: string;
  metadata: {
    category?: string;
    type?: string;
    title: string;
    source_name?: string;
  };
  kb_sources?: { title?: string };
};

const tabItems = [
  ['all', 'Все'],
  ['product', 'Продукты'],
  ['faq', 'Вопросы и ответы'],
  ['procedure', 'Процедуры'],
  ['contact', 'Контакты'],
  ['file', 'Файлы'],
  ['other', 'Другое'],
] as const;

const resolveCategory = (value?: string) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'qa') return 'faq';
  if (normalized === 'contacts') return 'contact';
  return normalized || 'other';
};

const typeLabel = (type?: string) => {
  switch (resolveCategory(type)) {
    case 'product':
      return 'Продукт';
    case 'faq':
      return 'Вопрос и ответ';
    case 'procedure':
      return 'Процедура';
    case 'contact':
      return 'Контакты';
    case 'file':
      return 'Файл';
    default:
      return 'Другое';
  }
};

const badgeColor = (type?: string) => {
  switch (resolveCategory(type)) {
    case 'product':
      return 'bg-blue-100 text-blue-700';
    case 'faq':
      return 'bg-green-100 text-green-700';
    case 'procedure':
      return 'bg-orange-100 text-orange-700';
    case 'contact':
      return 'bg-purple-100 text-purple-700';
    case 'file':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-yellow-100 text-yellow-700';
  }
};

const pluralize = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few;
  return many;
};

function FAQItem({ question, answer, isWarning }: { question: string; answer: string; isWarning?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`overflow-hidden rounded-xl border mb-3 last:mb-0 ${isWarning ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center px-5 py-4 text-left hover:bg-white/70 transition-colors"
      >
        <span className={`text-sm font-medium ${isWarning ? 'text-amber-800' : 'text-gray-700'}`}>
          {isWarning && '⚠️ '}
          {question}
        </span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-4">
          <p className={`text-sm leading-relaxed ${isWarning ? 'text-amber-700' : 'text-gray-600'}`}>{answer}</p>
        </div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  const params = useParams() as { agentId?: string };
  const agentId = params.agentId ?? '';

  const [sources, setSources] = useState<Source[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [total, setTotal] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({ product: 0, faq: 0, procedure: 0, contact: 0, file: 0, other: 0 });
  const [activeTab, setActiveTab] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [uploadModal, setUploadModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [editChunk, setEditChunk] = useState<Chunk | null>(null);
  const [viewChunk, setViewChunk] = useState<Chunk | null>(null);
  const [uploadTab, setUploadTab] = useState<'file' | 'manual' | 'instagram' | 'gdocs'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [instagramProfileUrl, setInstagramProfileUrl] = useState('');
  const [uploadGDocUrl, setUploadGDocUrl] = useState('');
  const [uploadUseAI, setUploadUseAI] = useState(true);
  const [manualTitle, setManualTitle] = useState('');
  const [manualType, setManualType] = useState('product');
  const [manualContent, setManualContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRefreshingLinks, setIsRefreshingLinks] = useState(false);

  const fetchSources = async () => {
    if (!agentId) return;
    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/sources`);
      const data = await response.json();
      setSources(data.sources || []);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchChunks = async () => {
    if (!agentId) return;
    setIsLoading(true);
    try {
      const paramsUrl = new URLSearchParams();
      paramsUrl.set('page', String(page));
      paramsUrl.set('limit', String(limit));
      if (activeTab && activeTab !== 'all') {
        paramsUrl.set('type', activeTab);
      }
      if (search) {
        paramsUrl.set('search', search);
      }

      const response = await fetch(`/api/agents/${agentId}/knowledge/chunks?${paramsUrl.toString()}`);
      const data = await response.json();
      setChunks(data.data || []);
      setTotal(data.total || 0);
      setCategoryCounts(data.categoryCounts || { product: 0, faq: 0, procedure: 0, contact: 0, file: 0, other: 0 });
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, [agentId]);

  useEffect(() => {
    fetchChunks();
  }, [agentId, activeTab, search, page, limit]);

  useEffect(() => {
    if (!sources.some((source) => ['pending', 'processing'].includes(source.status))) return;
    const timer = window.setTimeout(() => {
      fetchSources();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [sources]);

  const handleDeleteSource = async (id: string) => {
    if (!confirm('Удалить этот источник? Все связанные данные будут удалены.')) return;

    const previousSources = sources;
    setSources((prev) => prev.filter((source) => source.id !== id));

    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/sources/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Ошибка удаления');
      }
      fetchChunks();
    } catch (error) {
      setSources(previousSources);
      console.error('[KB] Delete source failed:', error);
      alert(error instanceof Error ? error.message : 'Не удалось удалить источник');
    }
  };

  const retrySource = async (sourceId: string) => {
    const previousSources = sources;
    setSources((prev) => prev.map((source) => (source.id === sourceId ? { ...source, status: 'processing' } : source)));

    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/sources/${sourceId}/retry`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Ошибка повтора');
      }
      fetchSources();
    } catch (error) {
      setSources(previousSources);
      console.error('[KB] Retry source failed:', error);
      alert(error instanceof Error ? error.message : 'Не удалось повторить обработку');
    }
  };

  const handleDeleteChunk = async (id: string) => {
    if (!confirm('Удалить элемент?')) return;
    await fetch(`/api/agents/${agentId}/knowledge/chunks/${id}`, { method: 'DELETE' });
    fetchChunks();
  };

  const handleRefreshLinks = async () => {
    if (!agentId || isRefreshingLinks) return;
    setIsRefreshingLinks(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/links/refresh`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Ошибка пересчёта связей');
      }
      alert('Связи пересчитаны');
    } catch (error) {
      console.error(error);
      alert((error as Error).message);
    } finally {
      setIsRefreshingLinks(false);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadFile) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('useAI', String(uploadUseAI));
      const response = await fetch(`/api/agents/${agentId}/knowledge/sources`, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Ошибка загрузки');
      }
      setUploadModal(false);
      setUploadFile(null);
      setUploadGDocUrl('');
      setUploadUseAI(true);
      fetchSources();
      fetchChunks();
    } catch (error) {
      console.error(error);
      alert((error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleInstagramParse = async () => {
    if (!instagramProfileUrl.trim()) return;
    setIsUploading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileUrl: instagramProfileUrl.trim() }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error || 'Ошибка анализа Instagram');
      }
      setUploadModal(false);
      setInstagramProfileUrl('');
      setUploadGDocUrl('');
      setUploadUseAI(true);
      fetchSources();
      fetchChunks();
    } catch (error) {
      console.error(error);
      alert((error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleGoogleDocsAdd = async () => {
    if (!uploadGDocUrl.trim()) return;
    setIsUploading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/gdocs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: uploadGDocUrl }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error || 'Ошибка привязки Google Docs');
      }
      setUploadModal(false);
      setUploadGDocUrl('');
      setUploadUseAI(true);
      fetchSources();
      fetchChunks();
    } catch (error) {
      console.error(error);
      alert((error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleManualAdd = async () => {
    if (!manualContent.trim()) {
      alert('Введите содержимое');
      return;
    }
    setIsUploading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: manualType,
          title: manualTitle || `Без названия ${new Date().toISOString().slice(0, 10)}`,
          content: manualContent,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Ошибка добавления');
      }
      setAddModal(false);
      setManualTitle('');
      setManualType('product');
      setManualContent('');
      fetchChunks();
    } catch (error) {
      console.error(error);
      alert((error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editChunk) return;
    const title = editChunk.metadata.title || '';
    const type = editChunk.metadata.type || 'other';
    const content = editChunk.content;
    setIsUploading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge/chunks/${editChunk.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, content }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Ошибка сохранения');
      }
      setEditChunk(null);
      fetchChunks();
    } catch (error) {
      console.error(error);
      alert((error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-gray-50">
      <div className="px-8 py-6 max-w-6xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">База знаний</h1>
          <p className="text-gray-500 text-sm mt-1">
            Загружайте документы и другие материалы, которые ИИ-продажник будет использовать для ответов на вопросы вашим клиентам
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Документы</h2>
              <p className="text-sm text-gray-500">
                Загружайте документы, содержащие информацию о вашем бизнесе: цены, виды услуг, товары, контакты и т.д.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefreshLinks}
                disabled={isRefreshingLinks}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition disabled:opacity-60"
              >
                <RefreshCw size={14} className={isRefreshingLinks ? 'animate-spin' : ''} />
                Пересчитать связи
              </button>
              <button
                onClick={() => setUploadModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Загрузить ещё <span className="text-lg leading-none">+</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {sources.length > 0 ? (
              sources.map((source) => (
                <div key={source.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-gray-100 rounded-2xl hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {source.type === 'instagram' ? (
                      <Instagram size={20} className="text-pink-500 flex-shrink-0" />
                    ) : (
                      <FileText size={20} className="text-gray-400 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{source.title}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {source.chunks_count} {pluralize(source.chunks_count, 'элемент', 'элемента', 'элементов')}
                        </span>
                        {source.status === 'pending' && <span className="text-xs text-blue-600">ожидание...</span>}
                        {source.status === 'processing' && <span className="text-xs text-orange-600">обработка...</span>}
                        {(source.status === 'done' || source.status === 'ready') && <span className="text-xs text-green-600">готово</span>}
                        {source.status === 'error' && <span className="text-xs text-red-600">ошибка</span>}
                      </div>
                      {source.status === 'error' && (
                        <div className="mt-2 text-xs text-red-600">
                          <div>{source.metadata?.error || 'Ошибка обработки'}</div>
                          {source.metadata?.error_hint && <div className="mt-1 text-amber-700">💡 {source.metadata.error_hint}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {source.status === 'error' && (
                      <button
                        onClick={() => retrySource(source.id)}
                        className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-0.5 border border-red-200 rounded hover:bg-red-50 transition-colors"
                      >
                        Повторить
                      </button>
                    )}
                    <button className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" aria-label="Скачать">
                      <Download size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteSource(source.id)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400 py-8 text-center">Нет загруженных документов</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Продукты, вопросы, процедуры, контакты и др.
                <span className="text-gray-400 font-normal text-sm ml-2">({total})</span>
              </h2>
            </div>
            <button
              onClick={() => setAddModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              <Plus size={14} /> Добавить
            </button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Поиск по элементам..."
                className="w-full pl-10 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n} на странице
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {tabItems.map(([val, label]) => (
              <button
                key={val}
                onClick={() => {
                  setActiveTab(val);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${activeTab === val ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {label}
                {val !== 'all' ? <span className="ml-2 text-xs opacity-80">{categoryCounts[val] || 0}</span> : null}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {chunks.length > 0 ? (
              chunks.map((chunk) => (
                <div key={chunk.id} className="border border-gray-100 rounded-2xl p-4 hover:border-gray-200 transition">
                  <div className="flex justify-between items-start gap-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor(chunk.metadata?.category || chunk.metadata?.type)}`}>
                      {typeLabel(chunk.metadata?.category || chunk.metadata?.type)}
                    </span>
                    <div className="flex gap-2 text-gray-400">
                      <button onClick={() => setViewChunk(chunk)} className="p-1 hover:text-gray-700" aria-label="Просмотр">
                        <Eye size={15} />
                      </button>
                      <button onClick={() => setEditChunk(chunk)} className="p-1 hover:text-gray-700" aria-label="Редактировать">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDeleteChunk(chunk.id)} className="p-1 hover:text-red-500" aria-label="Удалить">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <p className="font-medium text-sm text-gray-900 mt-3">{chunk.metadata?.title || chunk.content.slice(0, 80)}</p>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{chunk.content.slice(0, 120)}</p>
                  <p className="text-xs text-gray-400 mt-3">File: {chunk.kb_sources?.title || chunk.metadata?.source_name || '—'}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">Нет элементов. Загрузите документ или добавьте вручную.</p>
            )}
          </div>

          {total > limit && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">
              <span>Показано {Math.min(page * limit, total)} из {total}</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 border rounded-xl disabled:opacity-40 hover:bg-gray-50"
                >
                  <ArrowLeft size={14} /> Назад
                </button>
                <button
                  disabled={page * limit >= total}
                  onClick={() => setPage((prev) => prev + 1)}
                  className="px-3 py-1.5 border rounded-xl disabled:opacity-40 hover:bg-gray-50"
                >
                  Вперёд <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <FAQItem
            question="Что загрузить в базу знаний?"
            answer="В базу знаний нужно загрузить всю информацию о вашем бизнесе, которую ИИ-продажник должен знать: описание товаров и услуг, цены и акции, контактную информацию. При включённой опции «Интеллектуальная обработка» система автоматически разбивает документ на логические элементы — продукты, контакты, вопросы-ответы, процедуры."
          />
          <FAQItem
            question="Документы Google не обновляются автоматически"
            answer="Если вы меняете информацию в Google Документах или Google Таблицах — переподвяжите эти документы в системе. Изменения не подтягиваются автоматически."
            isWarning
          />
        </div>
      </div>

      {uploadModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Добавить в базу знаний</h3>
                <p className="text-sm text-gray-500">Выберите способ загрузки и начните обработку.</p>
              </div>
              <button onClick={() => setUploadModal(false)} className="p-2 rounded-xl text-gray-500 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-5">
              {['file', 'manual', 'instagram', 'gdocs'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setUploadTab(tab as any)}
                  className={`px-4 py-2 rounded-2xl text-sm ${uploadTab === tab ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {tab === 'file' ? 'Файл' : tab === 'manual' ? 'Ввод вручную' : tab === 'instagram' ? 'Instagram' : 'Google Docs'}
                </button>
              ))}
            </div>

            {uploadTab === 'file' && (
              <div className="space-y-4">
                <label className="block border-2 border-dashed border-gray-300 rounded-3xl p-8 text-center cursor-pointer hover:border-gray-400">
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.csv"
                    className="hidden"
                    onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                  />
                  <p className="text-sm text-gray-500">Перетащите файл или нажмите для выбора</p>
                  {uploadFile && <p className="text-sm text-gray-700 mt-3">Выбран: {uploadFile.name}</p>}
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={uploadUseAI}
                    onChange={(event) => setUploadUseAI(event.target.checked)}
                  />
                  <span className="text-sm text-gray-600">Использовать интеллектуальную обработку с ИИ</span>
                </label>
                <button
                  onClick={handleFileUpload}
                  disabled={!uploadFile || isUploading}
                  className="inline-flex items-center justify-center w-full rounded-2xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  {isUploading ? 'Загрузка...' : 'Загрузить'}
                </button>
              </div>
            )}

            {uploadTab === 'manual' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Название</label>
                  <input
                    value={manualTitle}
                    onChange={(event) => setManualTitle(event.target.value)}
                    className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Тип</label>
                  <select
                    value={manualType}
                    onChange={(event) => setManualType(event.target.value)}
                    className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="product">Продукт</option>
                    <option value="faq">Вопрос и ответ</option>
                    <option value="procedure">Процедура</option>
                    <option value="contact">Контакты</option>
                    <option value="file">Файл</option>
                    <option value="other">Другое</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Содержание</label>
                  <textarea
                    value={manualContent}
                    onChange={(event) => setManualContent(event.target.value)}
                    rows={6}
                    className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={handleManualAdd}
                  disabled={isUploading}
                  className="inline-flex items-center justify-center w-full rounded-2xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  {isUploading ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            )}

{uploadTab === 'instagram' && (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ссылка на Instagram-профиль</label>
          <input
            value={instagramProfileUrl}
            onChange={(event) => setInstagramProfileUrl(event.target.value)}
            placeholder="https://www.instagram.com/username/"
            className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            Вставьте ссылку на публичный аккаунт Instagram
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <ul className="space-y-1">
            <li>• Сканируются только публичные профили</li>
            <li>• Сканируются последние 120 постов</li>
            <li>• Если в постах неактуальная информация — рекомендуем загрузить через другой способ</li>
            <li>• Загрузка может занять до 5 минут</li>
          </ul>
        </div>
        <button
          onClick={handleInstagramParse}
          disabled={!instagramProfileUrl.trim() || isUploading}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
        >
          {isUploading ? 'Сканируем профиль...' : 'Начать сканирование'}
                </button>
              </div>
            )}

            {uploadTab === 'gdocs' && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-700">
                  Документы Google не обновляются автоматически. Переподвяжите при изменениях.
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Ссылка на документ</label>
                  <input
                    value={uploadGDocUrl}
                    onChange={(event) => setUploadGDocUrl(event.target.value)}
                    placeholder="https://..."
                    className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={handleGoogleDocsAdd}
                  disabled={!uploadGDocUrl || isUploading}
                  className="inline-flex items-center justify-center w-full rounded-2xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  {isUploading ? 'Привязка...' : 'Привязать'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {addModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Добавить элемент</h3>
              </div>
              <button onClick={() => setAddModal(false)} className="p-2 rounded-xl text-gray-500 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Заголовок</label>
                <input
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                  className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Тип</label>
                <select
                  value={manualType}
                  onChange={(event) => setManualType(event.target.value)}
                  className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="product">Продукт</option>
                  <option value="faq">Вопрос и ответ</option>
                  <option value="procedure">Процедура</option>
                  <option value="contact">Контакты</option>
                  <option value="file">Файл</option>
                  <option value="other">Другое</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Содержание</label>
                <textarea
                  rows={6}
                  value={manualContent}
                  onChange={(event) => setManualContent(event.target.value)}
                  className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  onClick={() => setAddModal(false)}
                  className="px-4 py-2 rounded-2xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={handleManualAdd}
                  disabled={isUploading}
                  className="px-4 py-2 rounded-2xl bg-gray-900 text-sm text-white disabled:opacity-40"
                >
                  {isUploading ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewChunk && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{viewChunk.metadata?.title || 'Просмотр элемента'}</h3>
                <span className={`text-xs inline-flex px-2 py-1 rounded-full ${badgeColor(viewChunk.metadata?.type)}`}>{typeLabel(viewChunk.metadata?.type)}</span>
              </div>
              <button onClick={() => setViewChunk(null)} className="p-2 rounded-xl text-gray-500 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="whitespace-pre-wrap text-sm text-gray-700">{viewChunk.content}</div>
          </div>
        </div>
      )}

      {editChunk && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Редактировать элемент</h3>
              </div>
              <button onClick={() => setEditChunk(null)} className="p-2 rounded-xl text-gray-500 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Заголовок</label>
                <input
                  value={editChunk.metadata?.title || ''}
                  onChange={(event) => setEditChunk({ ...editChunk, metadata: { ...editChunk.metadata, title: event.target.value } })}
                  className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Тип</label>
                <select
                  value={editChunk.metadata?.type || 'other'}
                  onChange={(event) => setEditChunk({ ...editChunk, metadata: { ...editChunk.metadata, type: event.target.value } })}
                  className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="product">Продукт</option>
                  <option value="faq">Вопрос и ответ</option>
                  <option value="procedure">Процедура</option>
                  <option value="contact">Контакты</option>
                  <option value="file">Файл</option>
                  <option value="other">Другое</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Содержание</label>
                <textarea
                  rows={8}
                  value={editChunk.content}
                  onChange={(event) => setEditChunk({ ...editChunk, content: event.target.value })}
                  className="mt-2 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  onClick={() => setEditChunk(null)}
                  className="px-4 py-2 rounded-2xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isUploading}
                  className="px-4 py-2 rounded-2xl bg-gray-900 text-sm text-white disabled:opacity-40"
                >
                  {isUploading ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

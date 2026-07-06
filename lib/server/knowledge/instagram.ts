import { createAdminClient } from '../../supabase/admin.ts';
import { normalizeCategory, buildCategoriesSummary, type KBCategory } from '../../ai/knowledge/categories.ts';
import { categorizeChunksDetailed } from '../../ai/knowledge/categorizer.ts';
import { classifyChunkPriority } from '../../knowledge-base/classification.ts';

const MAX_POSTS = 120;
const INSTAGRAM_POST_BATCH_SIZE = 10;
const APIFY_URL = 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items';
const APIFY_TIMEOUT_MS = 10 * 60 * 1000;

interface ParsedInstagramProfile {
  handle: string;
  profileUrl: string;
}

function normalizeHandle(value: string): string {
  return value.replace(/^@/, '').trim().replace(/\/+$/, '');
}

const RESERVED_INSTAGRAM_PATHS = new Set(['explore', 'accounts', 'about', 'blog', 'developer', 'privacy', 'legal', 'support', 'reels', 'p', 'tv', 'stories', 'reel', 'tagged', 'tags']);

export function parseInstagramProfileUrl(profileUrl: string): ParsedInstagramProfile | null {
  if (!profileUrl || typeof profileUrl !== 'string') return null;

  const trimmed = profileUrl.trim();
  if (!trimmed) return null;

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (!withoutProtocol) return null;

  const normalized = withoutProtocol.replace(/^instagram\.com\//i, '').replace(/^m\.instagram\.com\//i, '');

  if (!normalized || normalized.includes('/p/') || normalized.includes('/reel/') || normalized.includes('/tv/') || normalized.includes('/stories/')) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length > 1) {
    return null;
  }

  const handle = normalizeHandle(segments[0] || trimmed);
  if (!handle || RESERVED_INSTAGRAM_PATHS.has(handle.toLowerCase()) || !/^[a-zA-Z0-9._]+$/.test(handle)) {
    return null;
  }

  return {
    handle,
    profileUrl: `https://www.instagram.com/${handle}/`,
  };
}

export function classifyInstagramPostType(content: string): 'case' | 'product' | 'promo' | 'other' {
  const normalized = String(content || '').toLowerCase();

  const casePattern = /(?:отзыв|review|testimonial|кейс|case|результат|result|работа|выполнен|завершён|завершена|завершено|клиент|клиентский|до\s*[:\-]|после\s*[:\-]|наш клиент|сделали|готово|проект)/i;
  const promoCtaPattern = /(?:приглаш|запис(?:ись|ывайтесь|итесь|ываться)|консультац|запись|закаж(?:и|айте|ите)|куп(?:и|ите)|закажи|воспользуйтесь|бронируйте|поторопитесь|только сейчас|спешите|заявка|action|book now|хоч(?:еш|ите)|желаете|нужно|келсе|қалдыр|ақпарат алғ(?:ыңыз|ыңыз келсе))/i;
  const promoOfferPattern = /(?:акция|скидка|promo|special offer|рассрочка|подарок|выгодно|спец(?:иал)?|до конца|супер|ограничен(?:ное)? предложение)/i;
  const productPattern = /(?:товар|услуга|продукт|ассортимент|новый|каталог|прайс|цена|стоимость|доставка|характеристик|описани|модель|в наличии|₸|тенге|сом|цена от|стоимость от|купить|заказ)/i;

  if (casePattern.test(normalized)) {
    return 'case';
  }

  if (productPattern.test(normalized) && !promoCtaPattern.test(normalized)) {
    return 'product';
  }

  if (promoCtaPattern.test(normalized) || promoOfferPattern.test(normalized)) {
    return 'promo';
  }

  return 'other';
}

function getApifyToken(): string | undefined {
  return process.env.APIFY_API_TOKEN?.trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPosts(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }

  if (payload && typeof payload === 'object') {
    const candidate = payload as Record<string, unknown>;
    const nestedKeys = ['posts', 'items', 'results'];
    for (const key of nestedKeys) {
      const value = candidate[key];
      if (Array.isArray(value)) {
        return value as Array<Record<string, unknown>>;
      }
    }
  }

  return [];
}

function extractPostCaption(post: Record<string, unknown>) {
  return [post.caption, post.text, post.content].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
}

function extractPostMediaType(post: Record<string, unknown>) {
  const type = post.media_type || post.type;
  return typeof type === 'string' && type.trim() ? type.trim() : null;
}

function buildPostContent(post: Record<string, unknown>) {
  const caption = extractPostCaption(post);
  const hashtags = Array.isArray(post.hashtags)
    ? post.hashtags.map((item) => `#${String(item).replace(/^#/, '')}`).filter(Boolean)
    : [];

  return [caption?.trim(), hashtags.length ? hashtags.join(' ') : ''].filter(Boolean).join('\n');
}

export function createInstagramContentBatches<T>(items: T[], batchSize = INSTAGRAM_POST_BATCH_SIZE): T[][] {
  if (!Array.isArray(items) || !items.length) return [];

  const normalizedBatchSize = Math.max(1, Math.min(Math.floor(batchSize), 15));
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedBatchSize) {
    batches.push(items.slice(index, index + normalizedBatchSize));
  }

  return batches;
}

function buildPostMetadata(post: Record<string, unknown>, postType: 'case' | 'product' | 'promo' | 'other') {
  return {
    post_type: postType,
    post_url: post.url || null,
    timestamp: post.timestamp || post.created_at || null,
    likes: post.likes || post.like_count || null,
    comments_count: post.comments_count || post.comments || null,
    media_type: extractPostMediaType(post),
  };
}

interface InstagramChunkMetadataOptions {
  content: string;
  index: number;
  handle: string;
  postType: 'case' | 'product' | 'promo' | 'other';
  category: string;
  priority: string;
  postUrl?: string | null;
  timestamp?: unknown;
  likes?: unknown;
  commentsCount?: unknown;
  mediaType?: string | null;
  classificationError?: string | null;
}

export function buildInstagramChunkMetadata({
  content,
  index,
  handle,
  postType,
  category,
  priority,
  postUrl,
  timestamp,
  likes,
  commentsCount,
  mediaType,
  classificationError,
}: InstagramChunkMetadataOptions) {
  const normalizedCategory = normalizeCategory(category);
  return {
    category: normalizedCategory,
    type: normalizedCategory,
    title: `Instagram post ${index + 1}`,
    source_name: `@${handle}`,
    chunk_index: index,
    priority,
    source_type: 'instagram',
    post_type: postType,
    post_url: postUrl || null,
    timestamp: timestamp || null,
    likes: likes || null,
    comments_count: commentsCount || null,
    media_type: mediaType || null,
    classification_error: classificationError || null,
    content_preview: content.slice(0, 260),
  };
}

async function updateSourceMetadata(admin: ReturnType<typeof createAdminClient>, sourceId: string, metadata: Record<string, unknown>) {
  await admin.from('kb_sources').update({ metadata }).eq('id', sourceId);
}

async function logInstagramIngestion(admin: ReturnType<typeof createAdminClient>, payload: Record<string, unknown>, response: Record<string, unknown>) {
  try {
    await admin.from('ai_call_logs').insert({
      request: {
        action: 'instagram_ingest',
        ...payload,
      },
      response,
    });
  } catch (error) {
    console.warn('[KB] Failed to persist instagram ingestion log:', error);
  }
}

async function recalculateSourceCategoriesSummary(admin: ReturnType<typeof createAdminClient>, sourceId: string) {
  const { data: chunkRows, error } = await admin.from('kb_chunks').select('metadata').eq('source_id', sourceId);
  if (error) throw error;

  const categories = (chunkRows || [])
    .map((row: Record<string, unknown>) => normalizeCategory((row.metadata as Record<string, unknown> | null)?.category || 'other'))
    .filter((category): category is KBCategory => Boolean(category));

  return buildCategoriesSummary(categories);
}

export async function processInstagramSource(sourceId: string, agentId: string, profileUrl: string) {
  const admin = createAdminClient();
  const { data: source, error: sourceError } = await admin.from('kb_sources').select('*').eq('id', sourceId).single();

  if (sourceError || !source) {
    throw new Error(sourceError?.message || `Source ${sourceId} not found`);
  }

  const parsed = parseInstagramProfileUrl(profileUrl || String(source.metadata?.handle || ''));
  const handle = parsed?.handle || source.metadata?.handle || 'instagram';
  const canonicalUrl = parsed?.profileUrl || profileUrl || `https://www.instagram.com/${handle}/`;

  const baseMetadata = {
    ...(source.metadata || {}),
    handle,
    requested_posts: MAX_POSTS,
    provider: 'apify',
    source_type: 'instagram',
    error_hint: 'Проверьте ссылку, профиль должен быть публичным и доступным для сканирования.',
  };

  await admin.from('kb_sources').update({ status: 'processing', raw_content: '', metadata: { ...baseMetadata, started_at: new Date().toISOString() } }).eq('id', sourceId);
  await logInstagramIngestion(admin, {
    sourceId,
    agentId,
    profileUrl: canonicalUrl,
    handle,
    phase: 'start',
  }, {
    status: 'processing',
    started_at: new Date().toISOString(),
  });

  const token = getApifyToken();
  if (!token) {
    const errorMetadata = {
      ...baseMetadata,
      error: 'APIFY_API_TOKEN не задан. Добавьте токен в .env или Supabase Vault и повторите.',
      failed_at: new Date().toISOString(),
    };
    await admin.from('kb_sources').update({ status: 'error', raw_content: '', metadata: errorMetadata }).eq('id', sourceId);
    await logInstagramIngestion(admin, {
      sourceId,
      agentId,
      profileUrl: canonicalUrl,
      handle,
      phase: 'error',
    }, {
      status: 'error',
      error: 'APIFY_API_TOKEN не задан',
    });
    console.error('[KB] Instagram missing Apify token for source:', sourceId);
    throw new Error('APIFY_API_TOKEN не задан');
  }

  let posts: Array<Record<string, unknown>> = [];
  let lastError: Error | null = null;

  const apifyPayload = {
    directUrls: [canonicalUrl],
    resultsType: 'posts',
    resultsLimit: MAX_POSTS,
  };

  console.log('[KB] Instagram Apify request payload:', apifyPayload);

  const maskedToken = token.slice(0, 10);
  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  console.log('[KB] Instagram Apify request:', {
    method: 'POST',
    url: APIFY_URL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${maskedToken}...`,
    },
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(APIFY_URL, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(apifyPayload),
        signal: AbortSignal.timeout(APIFY_TIMEOUT_MS),
      });

      if (!response.ok) {
        const rawText = await response.text();
        if (response.status >= 500 && attempt < 2) {
          await sleep(2_000 * attempt);
          continue;
        }
        throw new Error(`Apify API error ${response.status}: ${rawText}`);
      }

      const payload = await response.json();
      posts = extractPosts(payload);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown Apify error');
      console.error('[KB] Instagram Apify attempt failed:', { sourceId, attempt, error: lastError.message });
      if (attempt < 2 && /5\d\d|timeout|ECONNRESET/i.test(lastError.message)) {
        await sleep(2_000 * attempt);
        continue;
      }
      break;
    }
  }

  if (!posts.length) {
    const reason = lastError?.message || 'Профиль закрыт, приватный или не существует, либо Apify не вернул данные.';
    const errorMetadata = {
      ...baseMetadata,
      error: reason,
      failed_at: new Date().toISOString(),
    };
    await admin.from('kb_sources').update({ status: 'error', raw_content: '', metadata: errorMetadata }).eq('id', sourceId);
    await logInstagramIngestion(admin, {
      sourceId,
      agentId,
      profileUrl: canonicalUrl,
      handle,
      phase: 'error',
    }, {
      status: 'error',
      error: reason,
      posts_scanned: 0,
    });
    return;
  }

  const normalizedPosts = posts.slice(0, MAX_POSTS);
  const postProcessingSummary: Array<Record<string, unknown>> = [];

  console.log('[KB] Instagram Apify posts response:', normalizedPosts.map((post, index) => ({
    index,
    caption: extractPostCaption(post) ?? null,
    media_type: extractPostMediaType(post),
    url: post.url || null,
    timestamp: post.timestamp || post.created_at || null,
  })));

  await admin.from('kb_chunks').delete().eq('source_id', sourceId);

  const chunkRecords: Array<Record<string, unknown>> = [];
  const pendingContentItems: Array<{
    index: number;
    content: string;
    postType: 'case' | 'product' | 'promo' | 'other';
    mediaType: string | null;
    post: Record<string, unknown>;
  }> = [];

  for (const [index, post] of normalizedPosts.entries()) {
    const caption = extractPostCaption(post as Record<string, unknown>);
    const mediaType = extractPostMediaType(post as Record<string, unknown>);
    const content = buildPostContent(post as Record<string, unknown>);
    const postType = classifyInstagramPostType(content);

    const recordSummary: Record<string, unknown> = {
      index,
      caption: caption ?? null,
      media_type: mediaType,
      post_type: postType,
      status: 'queued',
    };

    if (!content.trim()) {
      recordSummary.status = 'skipped';
      recordSummary.reason = 'empty caption/content';
      postProcessingSummary.push(recordSummary);
      continue;
    }

    pendingContentItems.push({
      index,
      content,
      postType,
      mediaType,
      post: post as Record<string, unknown>,
    });
    postProcessingSummary.push(recordSummary);
  }

  const categorizationResults: Array<{ category: string; fallbackUsed: boolean; error?: string }> = [];
  const categorizationBatches = createInstagramContentBatches(pendingContentItems, INSTAGRAM_POST_BATCH_SIZE);

  for (const [batchIndex, batch] of categorizationBatches.entries()) {
    const batchResults = await categorizeChunksDetailed(
      batch.map((item) => item.content),
      {
        logToAiCallLogs: true,
        sourceId,
        agentId,
        sourceType: 'instagram',
        conversationId: null,
        operationName: 'instagram_chunk_categorization',
      },
    );

    categorizationResults.push(...batchResults);
    if (batchIndex < categorizationBatches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  for (const [position, item] of pendingContentItems.entries()) {
    const priority = classifyChunkPriority(item.content);
    const classificationResult = categorizationResults[position] ?? { category: 'other', fallbackUsed: true, error: 'classification_result_missing' };
    const category = normalizeCategory(classificationResult.category);
    const { embedText } = await import('./processor.ts');
    const vector = await embedText(item.content);
    const postData = item.post as Record<string, unknown>;
    const postUrl = typeof postData.url === 'string' ? postData.url : null;
    const timestamp = typeof postData.timestamp === 'string' || typeof postData.timestamp === 'number'
      ? String(postData.timestamp)
      : typeof postData.created_at === 'string' || typeof postData.created_at === 'number'
        ? String(postData.created_at)
        : null;
    const likes = typeof postData.likes === 'string' || typeof postData.likes === 'number'
      ? String(postData.likes)
      : typeof postData.like_count === 'string' || typeof postData.like_count === 'number'
        ? String(postData.like_count)
        : null;
    const commentsCount = typeof postData.comments_count === 'string' || typeof postData.comments_count === 'number'
      ? String(postData.comments_count)
      : typeof postData.comments === 'string' || typeof postData.comments === 'number'
        ? String(postData.comments)
        : null;

    // TODO: verify whether public.search_knowledge_base uses priority in its SQL ranking; keep it separate from taxonomy category for now.
    chunkRecords.push({
      source_id: sourceId,
      agent_id: agentId,
      content: item.content,
      embedding: vector,
      priority,
      chunk_index: item.index,
      metadata: buildInstagramChunkMetadata({
        content: item.content,
        index: item.index,
        handle,
        postType: item.postType,
        category,
        priority,
        postUrl,
        timestamp,
        likes,
        commentsCount,
        mediaType: item.mediaType,
        classificationError: classificationResult.fallbackUsed ? classificationResult.error || 'classification_fallback' : null,
      }),
    });
  }

  console.log('[KB] Instagram post processing summary:', postProcessingSummary);

  if (chunkRecords.length) {
    try {
      await admin.from('kb_chunks').insert(chunkRecords);
    } catch (error) {
      console.error('[KB] Instagram chunk insertion failed:', {
        sourceId,
        error: error instanceof Error ? error.message : String(error),
        records: postProcessingSummary,
        chunkCount: chunkRecords.length,
      });
      throw error;
    }

    // TODO: verify that public.refresh_kb_chunk_links exists in Supabase and is applied from DB migrations or manual SQL.
    await admin.rpc('refresh_kb_chunk_links', {
      p_agent_id: agentId,
      p_top_k: 3,
      p_min_similarity: 0.75,
    });
  }

  const categoriesSummary = await recalculateSourceCategoriesSummary(admin, sourceId);
  const doneMetadata = {
    ...baseMetadata,
    posts_scanned: normalizedPosts.length,
    scan_completed_at: new Date().toISOString(),
    chunks_count: chunkRecords.length,
    categories_summary: categoriesSummary,
  };

  await admin.from('kb_sources').update({
    status: 'done',
    raw_content: normalizedPosts.map((post) => buildPostContent(post as Record<string, unknown>)).filter(Boolean).join('\n\n---\n\n'),
    metadata: doneMetadata,
  }).eq('id', sourceId);

  await logInstagramIngestion(admin, {
    sourceId,
    agentId,
    profileUrl: canonicalUrl,
    handle,
    phase: 'complete',
  }, {
    status: 'done',
    posts_scanned: normalizedPosts.length,
    chunks_count: chunkRecords.length,
    skipped_posts: postProcessingSummary.filter((item) => item.status === 'skipped').length,
    scan_completed_at: new Date().toISOString(),
  });
}

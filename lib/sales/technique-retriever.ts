import { createServiceClient } from '../supabase/service';
import { generateQueryEmbedding } from '../knowledge-base/embeddings';
import type { ConversationExample, NicheProfile, SalesTechnique } from './types';
import type { DialogStageValue } from './classifier';

export interface RetrieveTechniquesParams {
  agentId: string;
  queryText: string;
  dialogStage: DialogStageValue;
  matchThreshold?: number;
  matchCount?: number;
  channel?: string;
}

export interface RetrievedTechnique extends SalesTechnique {
  similarity: number;
}

export interface RetrievedExample extends ConversationExample {
  similarity: number;
}

export interface RetrievedTechniquesResult {
  techniques: RetrievedTechnique[];
  examples: RetrievedExample[];
  nicheProfile: NicheProfile | null;
}

export interface AgentNicheConfig {
  assignmentId: string | null;
  agentId: string;
  nicheId: string | null;
  nicheProfile: NicheProfile | null;
  methodologies: string[];
  nicheTags: string[];
}

function normalizeEmbeddingText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function collectNicheTags(nicheProfile: NicheProfile | null): string[] {
  if (!nicheProfile) {
    return [];
  }
  const tags = new Set<string>();
  for (const value of Object.values(nicheProfile.traits ?? {})) {
    const normalized = normalizeEmbeddingText(value);
    if (normalized) {
      tags.add(normalized.toLowerCase());
    }
  }
  return Array.from(tags);
}

function normalizeMethodologies(
  assignmentMethodologies: string[] | null,
  nicheProfile: NicheProfile | null
): string[] {
  if (Array.isArray(assignmentMethodologies) && assignmentMethodologies.length > 0) {
    return assignmentMethodologies.filter((item) => typeof item === 'string' && item.trim());
  }
  if (nicheProfile?.preferred_methodologies) {
    return nicheProfile.preferred_methodologies.filter((item) => typeof item === 'string' && item.trim());
  }
  return [];
}

function toTechnique(row: Record<string, unknown>): RetrievedTechnique {
  return {
    id: String(row.id ?? ''),
    methodology: String(row.methodology ?? ''),
    technique_name: String(row.technique_name ?? ''),
    niche_tags: Array.isArray(row.niche_tags) ? row.niche_tags.filter((item): item is string => typeof item === 'string') : [],
    trigger_embedding: typeof row.trigger_embedding === 'string' ? row.trigger_embedding : null,
    trigger_text: String(row.trigger_text ?? ''),
    script_template: String(row.script_template ?? ''),
    examples: Array.isArray(row.examples)
      ? (row.examples as Array<Record<string, unknown>>).map((example) => ({
          niche_slug: String(example.niche_slug ?? ''),
          example: String(example.example ?? ''),
        }))
      : [],
    difficulty: typeof row.difficulty === 'string' ? (row.difficulty as SalesTechnique['difficulty']) : null,
    tokens_estimate: typeof row.tokens_estimate === 'number' ? row.tokens_estimate : null,
    is_active: typeof row.is_active === 'boolean' ? row.is_active : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    similarity: typeof row.similarity === 'number' ? row.similarity : 0,
  };
}

function toExample(row: Record<string, unknown>): RetrievedExample {
  return {
    id: String(row.id ?? ''),
    niche_id: typeof row.niche_id === 'string' ? row.niche_id : null,
    technique_id: typeof row.technique_id === 'string' ? row.technique_id : null,
    situation_embedding: typeof row.situation_embedding === 'string' ? row.situation_embedding : null,
    situation_text: String(row.situation_text ?? ''),
    agent_reply: String(row.agent_reply ?? ''),
    outcome: typeof row.outcome === 'string' ? (row.outcome as ConversationExample['outcome']) : null,
    channel: typeof row.channel === 'string' ? row.channel : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    similarity: typeof row.similarity === 'number' ? row.similarity : 0,
  };
}

export async function getAgentNicheConfig(agentId: string): Promise<AgentNicheConfig> {
  const supabase = createServiceClient();

  const { data: assignmentData, error: assignmentError } = await supabase
    .from('agent_niche_assignment')
    .select('id, agent_id, niche_id, custom_methodologies, custom_prompt_addon, is_active, created_at')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .maybeSingle();

  if (assignmentError) {
    console.error('Failed to load agent niche assignment:', assignmentError.message);
    return {
      assignmentId: null,
      agentId,
      nicheId: null,
      nicheProfile: null,
      methodologies: [],
      nicheTags: [],
    };
  }

  if (!assignmentData?.niche_id) {
    return {
      assignmentId: assignmentData?.id ?? null,
      agentId,
      nicheId: null,
      nicheProfile: null,
      methodologies: [],
      nicheTags: [],
    };
  }

  const { data: nicheData, error: nicheError } = await supabase
    .from('niche_profiles')
    .select('*')
    .eq('id', assignmentData.niche_id)
    .maybeSingle();

  if (nicheError) {
    console.error('Failed to load niche profile:', nicheError.message);
    return {
      assignmentId: assignmentData?.id ?? null,
      agentId,
      nicheId: null,
      nicheProfile: null,
      methodologies: [],
      nicheTags: [],
    };
  }

  const nicheProfile = (nicheData as NicheProfile | null) ?? null;
  const methodologies = normalizeMethodologies(
    Array.isArray(assignmentData.custom_methodologies) ? assignmentData.custom_methodologies : null,
    nicheProfile
  );

  return {
    assignmentId: assignmentData?.id ?? null,
    agentId,
    nicheId: assignmentData.niche_id ?? null,
    nicheProfile,
    methodologies,
    nicheTags: collectNicheTags(nicheProfile),
  };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return generateQueryEmbedding(text);
}

export async function retrieveTechniques(params: RetrieveTechniquesParams): Promise<RetrievedTechniquesResult> {
  const supabase = createServiceClient();
  const matchThreshold = typeof params.matchThreshold === 'number' ? params.matchThreshold : 0.7;
  const matchCount = typeof params.matchCount === 'number' ? Math.max(1, Math.floor(params.matchCount)) : 3;

  const nicheConfig = await getAgentNicheConfig(params.agentId);
  if (!nicheConfig.nicheId || !nicheConfig.nicheProfile) {
    return { techniques: [], examples: [], nicheProfile: nicheConfig.nicheProfile };
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(params.queryText);
  } catch (err) {
    console.error('Failed to generate embedding:', err);
    return { techniques: [], examples: [], nicheProfile: nicheConfig.nicheProfile };
  }

  const [{ data: techniqueRows, error: techniqueError }, { data: exampleRows, error: exampleError }] =
    await Promise.all([
      supabase.rpc('match_sales_techniques', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount,
        filter_niche_tags: nicheConfig.nicheTags,
        filter_methodologies: nicheConfig.methodologies,
      }),
      supabase.rpc('match_conversation_examples', {
        query_embedding: queryEmbedding,
        match_threshold: Math.max(0.05, matchThreshold - 0.05),
        match_count: 2,
        filter_niche_id: nicheConfig.nicheId,
      }),
    ]);

  if (techniqueError) {
    console.error('Failed to retrieve sales techniques:', techniqueError.message);
  }

  if (exampleError) {
    console.error('Failed to retrieve conversation examples:', exampleError.message);
  }

  return {
    techniques: (techniqueRows as Array<Record<string, unknown>> | null ?? []).map((row) => toTechnique(row)),
    examples: (exampleRows as Array<Record<string, unknown>> | null ?? []).map((row) => toExample(row)),
    nicheProfile: nicheConfig.nicheProfile,
  };
}

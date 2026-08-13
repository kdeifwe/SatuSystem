-- OpenAI embedding migration: add metadata columns, prepare the kb_chunks table
-- for 768-dim OpenAI embeddings, and remove the known junk chunk before re-embedding.

alter table public.kb_chunks
  add column if not exists embedding_provider text,
  add column if not exists embedding_model text;

-- Remove the known invalid zero-vector junk chunk before re-embedding the data.
delete from public.kb_chunks
where id = '978ea6fc-3f01-4234-b191-133ed39e9c41';

-- Clear any old Gemini embedding vectors so the table is not left in a mixed state.
update public.kb_chunks
set embedding = null,
    embedding_provider = null,
    embedding_model = null
where embedding is not null;

-- OpenAI text-embedding-3-small uses 768 dimensions.
alter table public.kb_chunks
  alter column embedding type vector(768) using null::vector(768);

create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

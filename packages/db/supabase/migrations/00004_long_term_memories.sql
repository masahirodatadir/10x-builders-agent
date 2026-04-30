-- ============================================================
-- Long-term memories with pgvector retrieval
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.memories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('episodic', 'semantic', 'procedural')),
  content            text NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 2000),
  embedding          vector(1536) NOT NULL,
  retrieval_count    integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_retrieved_at  timestamptz,
  UNIQUE (user_id, type, content)
);

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own memories"
  ON public.memories FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_memories_user_type
  ON public.memories (user_id, type);

CREATE INDEX idx_memories_embedding_cosine
  ON public.memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding vector(1536),
  match_user_id uuid,
  match_count int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  type text,
  content text,
  retrieval_count integer,
  created_at timestamptz,
  last_retrieved_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.id,
    m.user_id,
    m.type,
    m.content,
    m.retrieval_count,
    m.created_at,
    m.last_retrieved_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM public.memories m
  WHERE m.user_id = match_user_id
  ORDER BY m.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 8);
$$;

CREATE OR REPLACE FUNCTION public.increment_memory_retrievals(
  memory_ids uuid[],
  retrieved_user_id uuid
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.memories
  SET
    retrieval_count = retrieval_count + 1,
    last_retrieved_at = now()
  WHERE user_id = retrieved_user_id
    AND id = ANY(memory_ids);
$$;

-- =====================================================
-- Neurosint — Produto · 0002 · Memória de conversa (longo prazo)
-- Portado de assistant/sql/02_create_memory_tables.sql (sem prefixo, scopado por patient_id).
-- =====================================================

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  message_count INT DEFAULT 0,
  key_topics TEXT[],
  key_decisions TEXT[],
  pending_followups TEXT[],
  source TEXT DEFAULT 'auto', -- auto (sistema), manual (humano)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_summaries_patient
  ON conversation_summaries(patient_id, created_at DESC);

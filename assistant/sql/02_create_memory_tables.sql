/* file: create_memory_tables.sql */
-- =====================================================
-- Neurosint — Sistema de Memoria (Curto + Longo Prazo)
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================

-- 1. Tabela de resumos de conversa (memoria de longo prazo)
CREATE TABLE IF NOT EXISTS assistant_conversation_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  summary_text TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  message_count INT DEFAULT 0,
  key_topics TEXT[], -- ['tremor', 'prolopa', 'programa2', 'queda']
  key_decisions TEXT[], -- ['aumentou prolopa', 'trocou programa']
  pending_followups TEXT[], -- ['verificar tremor amanha', 'confirmar dose']
  source TEXT DEFAULT 'auto', -- auto (sistema), manual (humano)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_summaries_patient
  ON assistant_conversation_summaries(patient_id, created_at DESC);

-- 2. RPC: Buscar ultimo resumo de conversa
CREATE OR REPLACE FUNCTION assistant_get_latest_summary(p_patient_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT row_to_json(s)::jsonb
    FROM (
      SELECT summary_text, period_start, period_end, message_count,
             key_topics, key_decisions, pending_followups, created_at
      FROM assistant_conversation_summaries
      WHERE patient_id = p_patient_id
      ORDER BY created_at DESC
      LIMIT 1
    ) s
  );
END;
$$ LANGUAGE plpgsql;

-- 3. RPC: Buscar ultimas mensagens COM limite maior (50)
CREATE OR REPLACE FUNCTION assistant_get_recent_messages(p_patient_id UUID, p_limit INT DEFAULT 50)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(m)), '[]'::jsonb)
    FROM (
      SELECT sender_name, direction, message_type, content, created_at
      FROM assistant_message_history
      WHERE patient_id = p_patient_id
      ORDER BY created_at DESC
      LIMIT p_limit
    ) m
  );
END;
$$ LANGUAGE plpgsql;

-- 4. RPC: Salvar resumo de conversa
CREATE OR REPLACE FUNCTION assistant_save_conversation_summary(
  p_patient_id UUID,
  p_summary_text TEXT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_message_count INT,
  p_key_topics TEXT[],
  p_key_decisions TEXT[],
  p_pending_followups TEXT[]
)
RETURNS UUID AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO assistant_conversation_summaries (
    patient_id, summary_text, period_start, period_end,
    message_count, key_topics, key_decisions, pending_followups
  ) VALUES (
    p_patient_id, p_summary_text, p_period_start, p_period_end,
    p_message_count, p_key_topics, p_key_decisions, p_pending_followups
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Done!

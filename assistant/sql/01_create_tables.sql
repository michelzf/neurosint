/* file: create_tables.sql */
-- =====================================================
-- Neurosint — Assistente Medico Pessoal (Parkinson/DBS)
-- Tabelas no seu projeto Supabase
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================

-- 1. Pacientes
CREATE TABLE IF NOT EXISTS assistant_patients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  age INT,
  blood_type TEXT,
  diagnosis TEXT,
  diagnosis_date DATE,
  phone TEXT,
  whatsapp_jid TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Cuidadores (quem recebe alertas)
CREATE TABLE IF NOT EXISTS assistant_caregivers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  name TEXT NOT NULL,
  phone TEXT,
  whatsapp_jid TEXT,
  role TEXT DEFAULT 'familiar', -- familiar, medico, farmaceutica
  receives_alerts BOOLEAN DEFAULT TRUE,
  receives_weekly_summary BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Medicacoes atuais (atualizaveis via mensagem)
CREATE TABLE IF NOT EXISTS assistant_medications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  name TEXT NOT NULL,
  dose TEXT,
  frequency TEXT, -- '3/3h', 'noite', '4-6x/dia'
  schedule_times TEXT[], -- ['08:00','11:00','14:00','17:00','20:00']
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_taking BOOLEAN DEFAULT TRUE, -- false = prescrito mas nao toma (ex: Ritalina)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Historico de doses tomadas
CREATE TABLE IF NOT EXISTS assistant_medication_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  medication_id UUID REFERENCES assistant_medications(id),
  scheduled_time TIMESTAMPTZ,
  taken_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, taken, skipped, late
  reported_by TEXT, -- 'patient', 'caregiver', 'auto'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Configuracoes DBS
CREATE TABLE IF NOT EXISTS assistant_dbs_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  config_date DATE NOT NULL,
  program_number INT, -- 1-4
  is_active BOOLEAN DEFAULT FALSE,
  amplitude_left TEXT,
  amplitude_right TEXT,
  frequency TEXT,
  pulse_width TEXT,
  active_contacts TEXT,
  notes TEXT, -- observacoes do medico
  source TEXT DEFAULT 'manual', -- manual, consulta, emergencia
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Check-ins diarios (respostas dos botoes)
CREATE TABLE IF NOT EXISTS assistant_daily_checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  checkin_date DATE NOT NULL,
  checkin_time TEXT NOT NULL, -- 'morning', 'afternoon', 'evening'
  motor_state TEXT, -- 'good', 'moderate', 'bad'
  mood_score INT, -- 1-5
  extra_notes TEXT,
  reported_by TEXT DEFAULT 'patient', -- patient, caregiver
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkins_date ON assistant_daily_checkins(patient_id, checkin_date);

-- 7. Sintomas reportados
CREATE TABLE IF NOT EXISTS assistant_symptoms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  symptom_date TIMESTAMPTZ DEFAULT NOW(),
  symptom_type TEXT NOT NULL, -- tremor, rigidez, freezing, discinesia, queda, dor, dificuldade_engolir, etc.
  severity TEXT, -- leve, moderado, severo
  context TEXT, -- 'apos medicacao', 'ao acordar', 'durante exercicio'
  duration_minutes INT,
  on_off_state TEXT, -- 'on', 'off', 'transicao', 'desconhecido'
  notes TEXT,
  reported_by TEXT DEFAULT 'patient',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symptoms_date ON assistant_symptoms(patient_id, symptom_date);

-- 8. Registros medicos (exames, consultas, documentos)
CREATE TABLE IF NOT EXISTS assistant_medical_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  record_date DATE,
  record_type TEXT NOT NULL, -- exame, consulta, documento, prescricao, internacao
  title TEXT,
  summary TEXT, -- resumo extraido pela IA
  raw_text TEXT, -- texto completo extraido
  file_url TEXT, -- link para arquivo original (Drive/Storage)
  file_type TEXT, -- pdf, image, audio
  doctor_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Fatos-chave (knowledge base persistente)
CREATE TABLE IF NOT EXISTS assistant_key_facts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  category TEXT NOT NULL, -- dbs, medicacao, sintoma, historico, preferencia, dispositivo, ambiente
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT, -- 'manual_medico', 'consulta', 'relato_paciente', 'exame', 'sistema'
  urgency TEXT DEFAULT 'normal', -- normal, importante, critico
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_keyfacts_unique ON assistant_key_facts(patient_id, category, fact_key);

-- 10. Alertas disparados
CREATE TABLE IF NOT EXISTS assistant_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  alert_type TEXT NOT NULL, -- red_flag, pattern, medication_missed, mood_decline
  severity TEXT NOT NULL, -- info, warning, urgent, emergency
  title TEXT NOT NULL,
  description TEXT,
  trigger_data JSONB,
  notified_caregivers TEXT[], -- lista de nomes notificados
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Historico de mensagens no grupo
CREATE TABLE IF NOT EXISTS assistant_message_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  message_id TEXT UNIQUE, -- WhatsApp message ID (dedup)
  sender_name TEXT,
  sender_jid TEXT,
  direction TEXT DEFAULT 'incoming', -- incoming, outgoing
  message_type TEXT, -- text, audio, image, document, button_response, list_response
  content TEXT, -- texto da mensagem ou transcricao
  media_url TEXT,
  button_id TEXT, -- ID do botao clicado
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_dedup ON assistant_message_history(message_id);
CREATE INDEX IF NOT EXISTS idx_msg_patient ON assistant_message_history(patient_id, created_at DESC);

-- 12. Resumos semanais
CREATE TABLE IF NOT EXISTS assistant_weekly_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES assistant_patients(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  summary_text TEXT,
  motor_trend TEXT, -- improving, stable, declining
  mood_trend TEXT,
  medication_adherence_pct NUMERIC,
  checkin_count INT,
  alert_count INT,
  good_days INT,
  bad_days INT,
  sent_to TEXT[], -- quem recebeu
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- RPCs
-- =====================================================

-- RPC: Buscar contexto completo do paciente para o agente IA
CREATE OR REPLACE FUNCTION assistant_get_patient_context(p_patient_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'patient', (SELECT row_to_json(p) FROM assistant_patients p WHERE p.id = p_patient_id),
    'medications', (
      SELECT COALESCE(jsonb_agg(row_to_json(m)), '[]'::jsonb)
      FROM assistant_medications m WHERE m.patient_id = p_patient_id AND m.is_active = TRUE
    ),
    'recent_checkins', (
      SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
      FROM (
        SELECT * FROM assistant_daily_checkins
        WHERE patient_id = p_patient_id
        ORDER BY created_at DESC LIMIT 14
      ) c
    ),
    'recent_symptoms', (
      SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      FROM (
        SELECT * FROM assistant_symptoms
        WHERE patient_id = p_patient_id
        ORDER BY symptom_date DESC LIMIT 10
      ) s
    ),
    'active_dbs_config', (
      SELECT row_to_json(d)
      FROM assistant_dbs_configs d
      WHERE d.patient_id = p_patient_id AND d.is_active = TRUE
      ORDER BY d.config_date DESC LIMIT 1
    ),
    'key_facts', (
      SELECT COALESCE(jsonb_agg(row_to_json(f)), '[]'::jsonb)
      FROM assistant_key_facts f
      WHERE f.patient_id = p_patient_id AND f.is_active = TRUE
    ),
    'recent_records', (
      SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb)
      FROM (
        SELECT id, record_date, record_type, title, summary, doctor_name
        FROM assistant_medical_records
        WHERE patient_id = p_patient_id
        ORDER BY record_date DESC LIMIT 5
      ) r
    ),
    'recent_alerts', (
      SELECT COALESCE(jsonb_agg(row_to_json(a)), '[]'::jsonb)
      FROM (
        SELECT * FROM assistant_alerts
        WHERE patient_id = p_patient_id AND resolved = FALSE
        ORDER BY created_at DESC LIMIT 5
      ) a
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- RPC: Buscar ultimas mensagens para contexto da conversa
CREATE OR REPLACE FUNCTION assistant_get_recent_messages(p_patient_id UUID, p_limit INT DEFAULT 10)
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

-- RPC: Checkins da semana para resumo
CREATE OR REPLACE FUNCTION assistant_get_weekly_checkins(p_patient_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
    FROM (
      SELECT checkin_date, checkin_time, motor_state, mood_score, extra_notes
      FROM assistant_daily_checkins
      WHERE patient_id = p_patient_id
        AND checkin_date >= CURRENT_DATE - 7
      ORDER BY checkin_date, checkin_time
    ) c
  );
END;
$$ LANGUAGE plpgsql;

-- RPC: Verificar aderencia medicamentosa
CREATE OR REPLACE FUNCTION assistant_get_medication_adherence(p_patient_id UUID, p_days INT DEFAULT 7)
RETURNS JSONB AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'total_scheduled', COUNT(*),
      'taken', COUNT(*) FILTER (WHERE status = 'taken'),
      'skipped', COUNT(*) FILTER (WHERE status = 'skipped'),
      'pending', COUNT(*) FILTER (WHERE status = 'pending'),
      'late', COUNT(*) FILTER (WHERE status = 'late'),
      'adherence_pct', ROUND(
        (COUNT(*) FILTER (WHERE status IN ('taken', 'late'))::NUMERIC /
         NULLIF(COUNT(*), 0)::NUMERIC) * 100, 1
      )
    )
    FROM assistant_medication_logs
    WHERE patient_id = p_patient_id
      AND scheduled_time >= NOW() - (p_days || ' days')::INTERVAL
  );
END;
$$ LANGUAGE plpgsql;

-- Done!

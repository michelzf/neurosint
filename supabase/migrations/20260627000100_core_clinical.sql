-- =====================================================
-- Neurosint — Produto · 0001 · Schema clínico
-- Portado de assistant/sql/01_create_tables.sql para multi-tenant:
--   • tabelas sem o prefixo assistant_
--   • `patients` é a RAIZ DO TENANT (ganha owner_id)
--   • RLS é habilitada na migration 0004 (aqui só estrutura)
-- =====================================================

-- 1. Pacientes — a raiz do tenant. Cada linha é um "caso".
CREATE TABLE IF NOT EXISTS patients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- quem criou o caso (vira owner em case_members)
  name TEXT NOT NULL,
  age INT,
  birth_date DATE,
  blood_type TEXT,
  diagnosis TEXT,
  diagnosis_date DATE,
  phone TEXT,
  whatsapp_jid TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Contatos de cuidado para roteamento de alertas (podem NÃO ser usuários do app).
--    O controle de ACESSO é via case_members (0003); esta tabela é só "para quem avisar".
CREATE TABLE IF NOT EXISTS caregivers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  whatsapp_jid TEXT,
  role TEXT DEFAULT 'familiar', -- familiar, medico, farmaceutica
  receives_alerts BOOLEAN DEFAULT TRUE,
  receives_weekly_summary BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Medicações atuais
CREATE TABLE IF NOT EXISTS medications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  schedule_times TEXT[],
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_taking BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Histórico de doses
CREATE TABLE IF NOT EXISTS medication_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medication_id UUID REFERENCES medications(id) ON DELETE SET NULL,
  scheduled_time TIMESTAMPTZ,
  taken_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, taken, skipped, late
  reported_by TEXT,              -- patient, caregiver, auto
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Configurações DBS
CREATE TABLE IF NOT EXISTS dbs_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  config_date DATE NOT NULL,
  program_number INT,
  is_active BOOLEAN DEFAULT FALSE,
  amplitude_left TEXT,
  amplitude_right TEXT,
  frequency TEXT,
  pulse_width TEXT,
  active_contacts TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual', -- manual, consulta, emergencia
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Check-ins diários
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL,
  checkin_time TEXT NOT NULL, -- morning, afternoon, evening
  motor_state TEXT,           -- good, moderate, bad
  mood_score INT,             -- 1-5
  extra_notes TEXT,
  reported_by TEXT DEFAULT 'patient',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(patient_id, checkin_date);

-- 7. Sintomas
CREATE TABLE IF NOT EXISTS symptoms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  symptom_date TIMESTAMPTZ DEFAULT NOW(),
  symptom_type TEXT NOT NULL,
  severity TEXT,
  context TEXT,
  duration_minutes INT,
  on_off_state TEXT,
  notes TEXT,
  reported_by TEXT DEFAULT 'patient',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_symptoms_date ON symptoms(patient_id, symptom_date);

-- 8. Registros médicos (exames, consultas, documentos). file_url aponta pro Storage (0003: exam_files).
CREATE TABLE IF NOT EXISTS medical_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record_date DATE,
  record_type TEXT NOT NULL, -- exame, consulta, documento, prescricao, internacao
  title TEXT,
  summary TEXT,
  raw_text TEXT,
  file_url TEXT,
  file_type TEXT,            -- pdf, image, audio
  doctor_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_id, record_date DESC);

-- 9. Fatos-chave (knowledge base persistente)
CREATE TABLE IF NOT EXISTS key_facts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT,
  urgency TEXT DEFAULT 'normal', -- normal, importante, critico
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_keyfacts_unique ON key_facts(patient_id, category, fact_key);

-- 10. Alertas
CREATE TABLE IF NOT EXISTS alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- red_flag, pattern, medication_missed, mood_decline
  severity TEXT NOT NULL,   -- info, warning, urgent, emergency
  title TEXT NOT NULL,
  description TEXT,
  trigger_data JSONB,
  notified_caregivers TEXT[],
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(patient_id, resolved, created_at DESC);

-- 11. Mensagens (chat do app; antes assistant_message_history). client_msg_id = idempotência do app.
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_msg_id TEXT,           -- idempotência (app)
  message_id TEXT,              -- id externo (ex.: WhatsApp), opcional
  sender_name TEXT,
  direction TEXT DEFAULT 'incoming', -- incoming, outgoing
  message_type TEXT,            -- text, audio, image, document, button_response
  content TEXT,
  media_url TEXT,
  button_id TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_external ON messages(message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_client   ON messages(patient_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_patient ON messages(patient_id, created_at DESC);

-- 12. Resumos semanais
CREATE TABLE IF NOT EXISTS weekly_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  summary_text TEXT,
  motor_trend TEXT,
  mood_trend TEXT,
  medication_adherence_pct NUMERIC,
  checkin_count INT,
  alert_count INT,
  good_days INT,
  bad_days INT,
  sent_to TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

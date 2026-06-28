-- =====================================================
-- Neurosint — Produto · 0003 · Multi-tenancy + RBAC + LGPD
-- Tudo que falta para virar SaaS multi-família com portal do médico.
-- (As políticas RLS desta migration e das tabelas clínicas ficam na 0004.)
-- =====================================================

-- Perfil do usuário autenticado (1:1 com auth.users).
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Papéis de um usuário dentro de um caso.
DO $$ BEGIN
  CREATE TYPE case_role AS ENUM ('owner', 'caregiver', 'patient', 'doctor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Núcleo do multi-tenant + RBAC: liga usuário ↔ caso, com papel e permissão de escrita.
CREATE TABLE IF NOT EXISTS case_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role case_role NOT NULL DEFAULT 'caregiver',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'revoked')),
  can_write BOOLEAN NOT NULL DEFAULT TRUE, -- médico entra com FALSE (leitura)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (patient_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON case_members(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_members_patient ON case_members(patient_id) WHERE status = 'active';

-- Convites por token (cuidador convida família/médico por e-mail).
CREATE TABLE IF NOT EXISTS invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role case_role NOT NULL DEFAULT 'caregiver',
  can_write BOOLEAN NOT NULL DEFAULT TRUE,
  token TEXT NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_patient ON invitations(patient_id);

-- Consentimento LGPD (dado de saúde é sensível, art. 11). Versionado e revogável.
CREATE TABLE IF NOT EXISTS consents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- data_processing | ai_providers | doctor_share | ...
  text_version TEXT NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_consents_patient ON consents(patient_id);

-- Trilha de auditoria (escrita server-side; especialmente acesso de médico/admin).
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_log(patient_id, created_at DESC);

-- Tokens de push por dispositivo (Expo / FCM / APNs).
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token TEXT NOT NULL,
  platform TEXT, -- ios | android
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, expo_token)
);

-- Metadados de arquivo no Storage (1 registro por objeto enviado).
CREATE TABLE IF NOT EXISTS exam_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  mime TEXT,
  bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'processed', 'failed')),
  record_id UUID REFERENCES medical_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_examfiles_patient ON exam_files(patient_id, created_at DESC);

-- =====================================================
-- Triggers
-- =====================================================

-- Ao criar usuário em auth.users → cria o profile correspondente.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Ao criar um caso (patients) → quem criou (owner_id) vira owner em case_members.
CREATE OR REPLACE FUNCTION handle_new_case()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO case_members (patient_id, user_id, role, status, can_write)
    VALUES (NEW.id, NEW.owner_id, 'owner', 'active', TRUE)
    ON CONFLICT (patient_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_patient_created ON patients;
CREATE TRIGGER on_patient_created
  AFTER INSERT ON patients
  FOR EACH ROW EXECUTE FUNCTION handle_new_case();

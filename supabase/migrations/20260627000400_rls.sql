-- =====================================================
-- Neurosint — Produto · 0004 · RLS (isolamento por caso)
-- O coração da segurança multi-tenant. Cada caso só é visível para seus membros.
--
-- As funções auxiliares são SECURITY DEFINER DE PROPÓSITO: assim consultam case_members
-- SEM disparar a RLS de case_members (evita recursão infinita na política).
-- =====================================================

-- É membro ativo do caso?
CREATE OR REPLACE FUNCTION is_member(p UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM case_members
    WHERE patient_id = p AND user_id = auth.uid() AND status = 'active'
  );
$$;

-- Pode escrever no caso? (médico geralmente entra com can_write = false)
CREATE OR REPLACE FUNCTION can_write(p UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM case_members
    WHERE patient_id = p AND user_id = auth.uid() AND status = 'active' AND can_write
  );
$$;

-- É owner do caso? (gerencia membros/convites e edita/apaga o caso)
CREATE OR REPLACE FUNCTION is_owner(p UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM case_members
    WHERE patient_id = p AND user_id = auth.uid() AND status = 'active' AND role = 'owner'
  );
$$;

-- Compartilha algum caso com o usuário u? (para exibir nomes de membros do mesmo caso)
CREATE OR REPLACE FUNCTION shares_case(u UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM case_members a
    JOIN case_members b USING (patient_id)
    WHERE a.user_id = auth.uid() AND b.user_id = u
      AND a.status = 'active' AND b.status = 'active'
  );
$$;

-- Admin do sistema (claim no app_metadata do JWT, setado server-side).
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', FALSE);
$$;

-- =====================================================
-- Políticas das tabelas "especiais"
-- =====================================================

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_sel ON profiles;
CREATE POLICY profiles_sel ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR shares_case(id));
DROP POLICY IF EXISTS profiles_ins ON profiles;
CREATE POLICY profiles_ins ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS profiles_upd ON profiles;
CREATE POLICY profiles_upd ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- patients (raiz do tenant)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patients_sel ON patients;
CREATE POLICY patients_sel ON patients FOR SELECT TO authenticated
  USING (is_member(id));
DROP POLICY IF EXISTS patients_ins ON patients;
CREATE POLICY patients_ins ON patients FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());            -- cria o próprio caso; trigger vira owner
DROP POLICY IF EXISTS patients_upd ON patients;
CREATE POLICY patients_upd ON patients FOR UPDATE TO authenticated
  USING (can_write(id)) WITH CHECK (can_write(id));
DROP POLICY IF EXISTS patients_del ON patients;
CREATE POLICY patients_del ON patients FOR DELETE TO authenticated
  USING (is_owner(id));

-- case_members
ALTER TABLE case_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_sel ON case_members;
CREATE POLICY members_sel ON case_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_member(patient_id));  -- vê a si e os colegas de caso
DROP POLICY IF EXISTS members_ins ON case_members;
CREATE POLICY members_ins ON case_members FOR INSERT TO authenticated
  WITH CHECK (is_owner(patient_id));
DROP POLICY IF EXISTS members_upd ON case_members;
CREATE POLICY members_upd ON case_members FOR UPDATE TO authenticated
  USING (is_owner(patient_id)) WITH CHECK (is_owner(patient_id));
DROP POLICY IF EXISTS members_del ON case_members;
CREATE POLICY members_del ON case_members FOR DELETE TO authenticated
  USING (is_owner(patient_id));

-- invitations (só o owner gerencia)
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitations_all ON invitations;
CREATE POLICY invitations_all ON invitations FOR ALL TO authenticated
  USING (is_owner(patient_id)) WITH CHECK (is_owner(patient_id));

-- consents (cada um consente por si; membros leem o histórico do caso)
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consents_sel ON consents;
CREATE POLICY consents_sel ON consents FOR SELECT TO authenticated
  USING (is_member(patient_id));
DROP POLICY IF EXISTS consents_ins ON consents;
CREATE POLICY consents_ins ON consents FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_member(patient_id));
DROP POLICY IF EXISTS consents_upd ON consents;
CREATE POLICY consents_upd ON consents FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- push_tokens (escopo por usuário, não por caso)
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_all ON push_tokens;
CREATE POLICY push_all ON push_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- audit_log (leitura por membros; escrita só server-side via service_role, que ignora RLS)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_sel ON audit_log;
CREATE POLICY audit_sel ON audit_log FOR SELECT TO authenticated
  USING (is_member(patient_id));

-- =====================================================
-- Políticas uniformes das tabelas clínicas (ler=membro, escrever=can_write)
-- =====================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'caregivers', 'medications', 'medication_logs', 'dbs_configs', 'checkins',
    'symptoms', 'medical_records', 'key_facts', 'alerts', 'messages',
    'weekly_summaries', 'conversation_summaries', 'exam_files'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_member(patient_id))', t || '_sel', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (can_write(patient_id))', t || '_ins', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (can_write(patient_id)) WITH CHECK (can_write(patient_id))', t || '_upd', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_del', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (can_write(patient_id))', t || '_del', t);
  END LOOP;
END $$;

-- =====================================================
-- pgTAP — prova o isolamento multi-tenant (RLS) da Fase F0/F1.
-- Rodar: `supabase test db`
--
-- Padrão: a sessão é superuser (postgres) para o SETUP (ignora RLS); para cada asserção
-- "logamos" como um usuário trocando o GUC `role` → authenticated e `request.jwt.claims`.sub.
-- (Mesmo padrão do supabase_test_helpers.) O teste roda numa transação e dá rollback no fim.
-- =====================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

-- ---------- helpers de "login" ----------
-- Inclui o claim `email` (lido de auth.users) no JWT simulado: accept_invitation amarra a
-- aceitação à identidade convidada, então o claim precisa existir como em produção.
CREATE FUNCTION pg_temp.login(uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE em TEXT;
BEGIN
  SELECT email INTO em FROM auth.users WHERE id = uid;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated', 'email', em)::text, true);
END $$;

CREATE FUNCTION pg_temp.logout() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);   -- volta ao session user (superuser) → ignora RLS
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- ---------- SETUP (como superuser) ----------
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'owner1@test.dev', '', NOW(), NOW(), NOW(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'owner2@test.dev', '', NOW(), NOW(), NOW(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'doctor@test.dev', '', NOW(), NOW(), NOW(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c4', 'authenticated', 'authenticated', 'invitee@test.dev', '', NOW(), NOW(), NOW(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c5', 'authenticated', 'authenticated', 'intruso@test.dev', '', NOW(), NOW(), NOW(), '{}', '{}');

-- Caso A (owner1) e Caso B (owner2); trigger handle_new_case cria as memberships de owner.
INSERT INTO patients (id, owner_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000000c1', 'Caso A (fictício)'),
  ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-0000000000c2', 'Caso B (fictício)');

-- Médico (c3) é membro só-leitura do Caso A.
INSERT INTO case_members (patient_id, user_id, role, status, can_write)
VALUES ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000000c3', 'doctor', 'active', FALSE);

-- Um sintoma em cada caso.
INSERT INTO symptoms (patient_id, symptom_type, severity) VALUES
  ('00000000-0000-0000-0000-0000000000da', 'tremor', 'leve'),
  ('00000000-0000-0000-0000-0000000000db', 'rigidez', 'leve');

-- Convite para c4 entrar no Caso A (token fixo p/ o teste).
INSERT INTO invitations (patient_id, email, role, can_write, token, invited_by)
VALUES ('00000000-0000-0000-0000-0000000000da', 'invitee@test.dev', 'caregiver', TRUE, 'tok_test_invite_0001', '00000000-0000-0000-0000-0000000000c1');

-- ===================== ASSERÇÕES =====================

-- owner1 enxerga o sintoma do Caso A, e NÃO enxerga o do Caso B.
SELECT pg_temp.login('00000000-0000-0000-0000-0000000000c1');
SELECT is((SELECT count(*) FROM symptoms WHERE patient_id='00000000-0000-0000-0000-0000000000da')::int, 1, 'owner1 vê o sintoma do Caso A');
SELECT is((SELECT count(*) FROM symptoms WHERE patient_id='00000000-0000-0000-0000-0000000000db')::int, 0, 'owner1 NÃO vê sintomas do Caso B (isolamento)');
SELECT is((SELECT count(*) FROM patients  WHERE id='00000000-0000-0000-0000-0000000000db')::int, 0, 'owner1 NÃO vê o paciente do Caso B');
SELECT is((SELECT count(*) FROM patients  WHERE id='00000000-0000-0000-0000-0000000000da')::int, 1, 'owner1 vê o paciente do Caso A');
SELECT is((SELECT count(*) FROM case_members WHERE patient_id='00000000-0000-0000-0000-0000000000da')::int, 2, 'owner1 vê o roster do Caso A (owner + médico)');
SELECT lives_ok($$ INSERT INTO symptoms(patient_id, symptom_type, severity) VALUES ('00000000-0000-0000-0000-0000000000da','dor','leve') $$, 'owner1 PODE escrever no Caso A');
SELECT pg_temp.logout();

-- owner2 não enxerga e não escreve no Caso A.
SELECT pg_temp.login('00000000-0000-0000-0000-0000000000c2');
SELECT is((SELECT count(*) FROM symptoms WHERE patient_id='00000000-0000-0000-0000-0000000000da')::int, 0, 'owner2 NÃO vê sintomas do Caso A (isolamento)');
SELECT throws_ok($$ INSERT INTO symptoms(patient_id, symptom_type, severity) VALUES ('00000000-0000-0000-0000-0000000000da','queda','leve') $$, '42501', NULL, 'owner2 NÃO pode escrever no Caso A (RLS)');
SELECT pg_temp.logout();

-- médico (c3): lê o Caso A, mas é só-leitura (can_write=false).
SELECT pg_temp.login('00000000-0000-0000-0000-0000000000c3');
SELECT ok((SELECT count(*) FROM symptoms WHERE patient_id='00000000-0000-0000-0000-0000000000da') >= 1, 'médico LÊ os sintomas do Caso A');
SELECT throws_ok($$ INSERT INTO symptoms(patient_id, symptom_type, severity) VALUES ('00000000-0000-0000-0000-0000000000da','tremor','leve') $$, '42501', NULL, 'médico NÃO pode escrever (só-leitura)');
SELECT pg_temp.logout();

-- convite: token válido + e-mail ERRADO (intruso de outra identidade) é REJEITADO e NÃO vira membro.
SELECT pg_temp.login('00000000-0000-0000-0000-0000000000c5');
SELECT throws_ok($$ SELECT accept_invitation('tok_test_invite_0001') $$, 'P0001', 'invitation addressed to a different email', 'token válido + e-mail errado é rejeitado (mis-binding)');
SELECT pg_temp.logout();
SELECT is((SELECT count(*) FROM case_members WHERE patient_id='00000000-0000-0000-0000-0000000000da' AND user_id='00000000-0000-0000-0000-0000000000c5')::int, 0, 'intruso NÃO virou membro do Caso A');

-- convite: c4 (e-mail coincidente) não vê nada antes de aceitar; depois de accept_invitation vê o Caso A.
SELECT pg_temp.login('00000000-0000-0000-0000-0000000000c4');
SELECT is((SELECT count(*) FROM symptoms WHERE patient_id='00000000-0000-0000-0000-0000000000da')::int, 0, 'c4 NÃO vê o Caso A antes de aceitar o convite');
SELECT lives_ok($$ SELECT accept_invitation('tok_test_invite_0001') $$, 'c4 aceita o convite');
SELECT ok((SELECT count(*) FROM symptoms WHERE patient_id='00000000-0000-0000-0000-0000000000da') >= 1, 'c4 passa a ver o Caso A depois de aceitar');
SELECT pg_temp.logout();

SELECT * FROM finish();
ROLLBACK;

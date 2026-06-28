-- =====================================================
-- pgTAP — RPCs, constraints e helpers de Storage (F2). Complementa 0001 (isolamento RLS).
-- Rodar: supabase test db
-- =====================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);

CREATE FUNCTION pg_temp.login(uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.logout() RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- fixtures (superuser)
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'rpc@test.dev', '', NOW(), NOW(), NOW(), '{}', '{}');
INSERT INTO patients (id, owner_id, name) VALUES ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000000e1', 'Caso RPC');

-- ===== storage_case_id =====
SELECT is(storage_case_id('00000000-0000-0000-0000-0000000000da/exame.pdf'), '00000000-0000-0000-0000-0000000000da'::uuid, 'extrai patient_id da 1ª pasta');
SELECT is(storage_case_id('exame.pdf'), NULL, 'sem pasta → null');
SELECT is(storage_case_id('invalido/exame.pdf'), NULL, 'pasta não-uuid → null');

-- ===== exam_files: CHECK de caminho amarrado ao caso =====
SELECT lives_ok(
  $$ INSERT INTO exam_files(patient_id, storage_path) VALUES ('00000000-0000-0000-0000-0000000000da','00000000-0000-0000-0000-0000000000da/ok.pdf') $$,
  'caminho sob a pasta do próprio caso é aceito');
SELECT throws_ok(
  $$ INSERT INTO exam_files(patient_id, storage_path) VALUES ('00000000-0000-0000-0000-0000000000da','00000000-0000-0000-0000-0000000000db/vitima.pdf') $$,
  '23514', NULL, 'caminho de OUTRO caso → check_violation (anti cross-tenant)');
SELECT throws_ok(
  $$ INSERT INTO exam_files(patient_id, storage_path) VALUES ('00000000-0000-0000-0000-0000000000da','00000000-0000-0000-0000-0000000000da/../x') $$,
  '23514', NULL, 'path traversal (..) → check_violation');

-- ===== confirm_medication: no-op sem medicação casada (sem log órfão) =====
SELECT is(confirm_medication('00000000-0000-0000-0000-0000000000da', 'Inexistente'), NULL, 'confirm sem med casado → NULL');
SELECT is((SELECT count(*) FROM medication_logs WHERE patient_id='00000000-0000-0000-0000-0000000000da')::int, 0, 'nenhum log de dose órfão criado');

-- ===== update_medication: insere quando ausente =====
SELECT lives_ok($$ SELECT update_medication('00000000-0000-0000-0000-0000000000da','Levodopa','atualizar','250mg') $$, 'update_medication insere medicação ausente');
SELECT is((SELECT count(*) FROM medications WHERE patient_id='00000000-0000-0000-0000-0000000000da' AND name ILIKE 'Levodopa')::int, 1, '1 medicação Levodopa ativa');

-- ===== confirm_medication: com medicação casada grava 1 log =====
SELECT isnt(confirm_medication('00000000-0000-0000-0000-0000000000da', 'Levodopa'), NULL, 'confirm com med casado → id do log');
SELECT is((SELECT count(*) FROM medication_logs WHERE patient_id='00000000-0000-0000-0000-0000000000da' AND status='taken')::int, 1, '1 dose registrada');

-- ===== create_case: cria paciente + membership de owner para o usuário autenticado =====
SELECT pg_temp.login('00000000-0000-0000-0000-0000000000e1');
SELECT is(auth.uid(), '00000000-0000-0000-0000-0000000000e1'::uuid, 'auth.uid() resolve após login');
SELECT lives_ok($$ SELECT create_case('Novo Caso') $$, 'create_case roda como authenticated');
SELECT pg_temp.logout();
SELECT is((SELECT count(*) FROM patients WHERE owner_id='00000000-0000-0000-0000-0000000000e1')::int, 2, 'usuário passa a ter 2 casos');
SELECT ok((SELECT count(*) FROM case_members WHERE user_id='00000000-0000-0000-0000-0000000000e1' AND role='owner' AND status='active') >= 2, 'memberships de owner criadas pelo trigger');

SELECT * FROM finish();
ROLLBACK;

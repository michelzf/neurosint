-- =====================================================
-- Neurosint — Produto · seed de DESENVOLVIMENTO (caso 100% fictício)
-- Roda no `supabase db reset`. NÃO usar em produção. Nenhum dado real.
--
-- Cria 2 usuários dev e 1 caso fictício para exercitar multi-tenant/RLS no app local:
--   • cuidador@dev.local  (owner, escreve)     senha: neurosint-dev
--   • medico@dev.local    (doctor, só leitura) senha: neurosint-dev
-- Login local: o Supabase local captura e-mails no Inbucket; senha acima também funciona.
-- =====================================================

-- IDs fixos para referência em dev/testes.
-- owner   = 000...a1 | doctor = 000...a2 | paciente = 000...b1
-- As colunas de token vão como '' (não NULL): o GoTrue falha ao escanear a linha se forem NULL.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', 'cuidador@dev.local',
   extensions.crypt('neurosint-dev', extensions.gen_salt('bf')),
   NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Cuidador Dev"}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2',
   'authenticated', 'authenticated', 'medico@dev.local',
   extensions.crypt('neurosint-dev', extensions.gen_salt('bf')),
   NOW(), NOW(), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Dra. Exemplo"}',
   '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Identidade do provedor "email" (o GoTrue associa o login a esta linha).
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1',
   '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"cuidador@dev.local"}', 'email', NOW(), NOW(), NOW()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2',
   '{"sub":"00000000-0000-0000-0000-0000000000a2","email":"medico@dev.local"}', 'email', NOW(), NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Caso fictício (owner_id → trigger cria a membership de owner automaticamente).
INSERT INTO patients (id, owner_id, name, age, diagnosis, diagnosis_date)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        'Paciente Exemplo (fictício)', 72, 'Doença de Parkinson + DBS', '2015-04-10')
ON CONFLICT (id) DO NOTHING;

-- Médico convidado ao caso, somente leitura.
INSERT INTO case_members (patient_id, user_id, role, status, can_write)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'doctor', 'active', FALSE)
ON CONFLICT (patient_id, user_id) DO NOTHING;

-- Consentimento de exemplo.
INSERT INTO consents (patient_id, user_id, kind, text_version)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'data_processing', 'v1');

-- Medicações.
INSERT INTO medications (patient_id, name, dose, frequency, schedule_times, notes) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Levodopa/Carbidopa', '250/25mg', '5x/dia',
   ARRAY['08:00','11:00','14:00','17:00','20:00'], 'Tomar 30 min antes das refeições'),
  ('00000000-0000-0000-0000-0000000000b1', 'Pramipexol', '0,25mg', '3x/dia',
   ARRAY['08:00','14:00','20:00'], NULL);

-- Configuração DBS ativa.
INSERT INTO dbs_configs (patient_id, config_date, program_number, is_active, amplitude_left, amplitude_right, frequency, pulse_width, active_contacts, notes)
VALUES ('00000000-0000-0000-0000-0000000000b1', '2025-09-22', 2, TRUE, '2,5 mA', '2,8 mA', '130 Hz', '60 µs', 'C+ 2-', 'Programa fictício de demonstração');

-- Sintoma recente.
INSERT INTO symptoms (patient_id, symptom_type, severity, context, on_off_state, reported_by)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'tremor', 'moderado', 'ao acordar', 'off', 'caregiver');

-- Registro médico (exame fictício).
INSERT INTO medical_records (patient_id, record_date, record_type, title, summary)
VALUES ('00000000-0000-0000-0000-0000000000b1', '2025-09-22', 'exame', 'Laboratório (fictício)',
        'Hemograma e função renal dentro da faixa. Vitamina D baixa — repor.');

-- Fatos-chave.
INSERT INTO key_facts (patient_id, category, fact_key, fact_value, source) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'dispositivo', 'gerador_dbs', 'Modelo recarregável; checar carga a cada 2 dias', 'manual_medico'),
  ('00000000-0000-0000-0000-0000000000b1', 'historico', 'cirurgia_dbs', 'Implante em 2016', 'consulta')
ON CONFLICT (patient_id, category, fact_key) DO NOTHING;

-- =====================================================
-- Neurosint — Produto · 0005 · RPCs
-- Portados de assistant/sql/*. São SECURITY INVOKER (padrão): rodam sob a RLS de quem chama,
-- então um usuário só lê/escreve casos dos quais é membro. (Edge Functions usam service_role
-- e ignoram a RLS quando precisam.) Exceção: accept_invitation é SECURITY DEFINER.
-- =====================================================

-- Contexto completo do paciente para o conselho de IA.
CREATE OR REPLACE FUNCTION get_patient_context(p_patient_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'patient', (SELECT row_to_json(p) FROM patients p WHERE p.id = p_patient_id),
    'medications', (
      SELECT COALESCE(jsonb_agg(row_to_json(m)), '[]'::jsonb)
      FROM medications m WHERE m.patient_id = p_patient_id AND m.is_active = TRUE
    ),
    'recent_checkins', (
      SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
      FROM (SELECT * FROM checkins WHERE patient_id = p_patient_id ORDER BY created_at DESC LIMIT 14) c
    ),
    'recent_symptoms', (
      SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      FROM (SELECT * FROM symptoms WHERE patient_id = p_patient_id ORDER BY symptom_date DESC LIMIT 10) s
    ),
    'active_dbs_config', (
      SELECT row_to_json(d) FROM dbs_configs d
      WHERE d.patient_id = p_patient_id AND d.is_active = TRUE
      ORDER BY d.config_date DESC LIMIT 1
    ),
    'key_facts', (
      SELECT COALESCE(jsonb_agg(row_to_json(f)), '[]'::jsonb)
      FROM key_facts f WHERE f.patient_id = p_patient_id AND f.is_active = TRUE
    ),
    'recent_records', (
      SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb)
      FROM (
        SELECT id, record_date, record_type, title, summary, doctor_name
        FROM medical_records WHERE patient_id = p_patient_id
        ORDER BY record_date DESC LIMIT 5
      ) r
    ),
    'recent_alerts', (
      SELECT COALESCE(jsonb_agg(row_to_json(a)), '[]'::jsonb)
      FROM (
        SELECT * FROM alerts WHERE patient_id = p_patient_id AND resolved = FALSE
        ORDER BY created_at DESC LIMIT 5
      ) a
    )
  ) INTO result;
  RETURN result;
END $$;

-- Últimas mensagens para contexto da conversa.
CREATE OR REPLACE FUNCTION get_recent_messages(p_patient_id UUID, p_limit INT DEFAULT 50)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(m)), '[]'::jsonb)
  FROM (
    SELECT sender_name, direction, message_type, content, created_at
    FROM messages WHERE patient_id = p_patient_id
    ORDER BY created_at DESC LIMIT p_limit
  ) m;
$$;

-- Último resumo de conversa (memória de longo prazo).
CREATE OR REPLACE FUNCTION get_latest_summary(p_patient_id UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT row_to_json(s)::jsonb
  FROM (
    SELECT summary_text, period_start, period_end, message_count,
           key_topics, key_decisions, pending_followups, created_at
    FROM conversation_summaries WHERE patient_id = p_patient_id
    ORDER BY created_at DESC LIMIT 1
  ) s;
$$;

-- Salva resumo de conversa.
CREATE OR REPLACE FUNCTION save_conversation_summary(
  p_patient_id UUID, p_summary_text TEXT, p_period_start TIMESTAMPTZ, p_period_end TIMESTAMPTZ,
  p_message_count INT, p_key_topics TEXT[], p_key_decisions TEXT[], p_pending_followups TEXT[]
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE new_id UUID;
BEGIN
  INSERT INTO conversation_summaries (
    patient_id, summary_text, period_start, period_end,
    message_count, key_topics, key_decisions, pending_followups
  ) VALUES (
    p_patient_id, p_summary_text, p_period_start, p_period_end,
    p_message_count, p_key_topics, p_key_decisions, p_pending_followups
  ) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- Check-ins da semana (para resumo semanal).
CREATE OR REPLACE FUNCTION get_weekly_checkins(p_patient_id UUID)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
  FROM (
    SELECT checkin_date, checkin_time, motor_state, mood_score, extra_notes
    FROM checkins WHERE patient_id = p_patient_id AND checkin_date >= CURRENT_DATE - 7
    ORDER BY checkin_date, checkin_time
  ) c;
$$;

-- Aderência medicamentosa nos últimos N dias.
CREATE OR REPLACE FUNCTION get_medication_adherence(p_patient_id UUID, p_days INT DEFAULT 7)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'total_scheduled', COUNT(*),
    'taken',   COUNT(*) FILTER (WHERE status = 'taken'),
    'skipped', COUNT(*) FILTER (WHERE status = 'skipped'),
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'late',    COUNT(*) FILTER (WHERE status = 'late'),
    'adherence_pct', ROUND(
      (COUNT(*) FILTER (WHERE status IN ('taken','late'))::NUMERIC /
       NULLIF(COUNT(*), 0)::NUMERIC) * 100, 1)
  )
  FROM medication_logs
  WHERE patient_id = p_patient_id
    AND scheduled_time >= NOW() - (p_days || ' days')::INTERVAL;
$$;

-- Atualiza/insere uma medicação (faltava no template; usado por persist.js).
CREATE OR REPLACE FUNCTION update_medication(
  p_patient_id UUID, p_name TEXT, p_action TEXT DEFAULT 'atualizar',
  p_dose TEXT DEFAULT NULL, p_frequency TEXT DEFAULT NULL,
  p_schedule_times TEXT[] DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE med_id UUID;
BEGIN
  SELECT id INTO med_id FROM medications
  WHERE patient_id = p_patient_id AND name ILIKE p_name AND is_active = TRUE
  ORDER BY updated_at DESC LIMIT 1;

  IF p_action = 'remover' THEN
    UPDATE medications SET is_active = FALSE, updated_at = NOW() WHERE id = med_id;
    RETURN med_id;
  END IF;

  IF med_id IS NULL THEN
    INSERT INTO medications (patient_id, name, dose, frequency, schedule_times, notes)
    VALUES (p_patient_id, p_name, p_dose, p_frequency, p_schedule_times, p_notes)
    RETURNING id INTO med_id;
  ELSE
    UPDATE medications SET
      dose           = COALESCE(p_dose, dose),
      frequency      = COALESCE(p_frequency, frequency),
      schedule_times = COALESCE(p_schedule_times, schedule_times),
      notes          = COALESCE(p_notes, notes),
      updated_at     = NOW()
    WHERE id = med_id;
  END IF;
  RETURN med_id;
END $$;

-- Confirma que uma dose foi tomada (faltava no template; usado por persist.js).
CREATE OR REPLACE FUNCTION confirm_medication(
  p_patient_id UUID, p_med_name TEXT,
  p_reported_by TEXT DEFAULT 'caregiver', p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE med_id UUID; log_id UUID;
BEGIN
  SELECT id INTO med_id FROM medications
  WHERE patient_id = p_patient_id AND name ILIKE p_med_name AND is_active = TRUE
  ORDER BY updated_at DESC LIMIT 1;

  INSERT INTO medication_logs (patient_id, medication_id, taken_at, status, reported_by, notes)
  VALUES (p_patient_id, med_id, NOW(), 'taken', p_reported_by, p_notes)
  RETURNING id INTO log_id;
  RETURN log_id;
END $$;

-- Cria um caso já como owner (conveniência; a RLS de patients também permite INSERT direto).
CREATE OR REPLACE FUNCTION create_case(
  p_name TEXT, p_diagnosis TEXT DEFAULT NULL, p_birth_date DATE DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE new_id UUID;
BEGIN
  INSERT INTO patients (owner_id, name, diagnosis, birth_date)
  VALUES (auth.uid(), p_name, p_diagnosis, p_birth_date)
  RETURNING id INTO new_id;   -- trigger handle_new_case cria a membership de owner
  RETURN new_id;
END $$;

-- Aceitar convite por token. SECURITY DEFINER: precisa ler o convite e inserir a membership
-- de um caso do qual o usuário ainda NÃO é membro (a RLS bloquearia).
CREATE OR REPLACE FUNCTION accept_invitation(p_token TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv invitations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO inv FROM invitations
  WHERE token = p_token AND accepted_at IS NULL AND expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired invitation';
  END IF;

  INSERT INTO case_members (patient_id, user_id, role, status, can_write)
  VALUES (inv.patient_id, auth.uid(), inv.role, 'active', inv.can_write)
  ON CONFLICT (patient_id, user_id)
  DO UPDATE SET role = EXCLUDED.role, status = 'active', can_write = EXCLUDED.can_write;

  UPDATE invitations SET accepted_at = NOW() WHERE id = inv.id;
  RETURN inv.patient_id;
END $$;

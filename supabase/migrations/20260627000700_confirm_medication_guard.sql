-- =====================================================
-- Neurosint — Produto · 0007 · confirm_medication à prova de log órfão
-- Antes, confirmar dose sem casar uma medicação real inseria medication_logs com
-- medication_id NULL (dose "tomada" desvinculada de remédio). Agora é no-op quando não há med.
-- =====================================================

CREATE OR REPLACE FUNCTION confirm_medication(
  p_patient_id UUID, p_med_name TEXT,
  p_reported_by TEXT DEFAULT 'caregiver', p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE med_id UUID; log_id UUID;
BEGIN
  SELECT id INTO med_id FROM medications
  WHERE patient_id = p_patient_id AND name ILIKE p_med_name AND is_active = TRUE
  ORDER BY updated_at DESC LIMIT 1;

  IF med_id IS NULL THEN
    RETURN NULL;  -- sem medicação correspondente: não grava log órfão
  END IF;

  INSERT INTO medication_logs (patient_id, medication_id, taken_at, status, reported_by, notes)
  VALUES (p_patient_id, med_id, NOW(), 'taken', p_reported_by, p_notes)
  RETURNING id INTO log_id;
  RETURN log_id;
END $$;

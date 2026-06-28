-- =====================================================
-- Neurosint — Produto · 0010 · create_case como SECURITY DEFINER
-- create_case cria um caso PARA o próprio usuário (owner_id = auth.uid()). Como RPC de criação
-- de recurso do próprio dono, deve ser DEFINER (igual a accept_invitation) — determinístico e
-- independente de nuances da RLS de INSERT em patients. Continua seguro: o owner é sempre o
-- chamador (auth.uid()), nunca um valor arbitrário.
-- =====================================================

CREATE OR REPLACE FUNCTION create_case(
  p_name TEXT, p_diagnosis TEXT DEFAULT NULL, p_birth_date DATE DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  INSERT INTO patients (owner_id, name, diagnosis, birth_date)
  VALUES (auth.uid(), p_name, p_diagnosis, p_birth_date)
  RETURNING id INTO new_id;   -- trigger handle_new_case cria a membership de owner
  RETURN new_id;
END $$;

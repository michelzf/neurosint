-- =====================================================
-- Neurosint — Produto · 0011 · accept_invitation vincula à identidade convidada
-- O convite é endereçado a um e-mail específico (invitations.email NOT NULL). Antes, a RPC
-- (SECURITY DEFINER) só checava o token e amarrava a membership a auth.uid() — qualquer
-- usuário autenticado de OUTRA família que obtivesse um token válido (encaminhado/vazado em
-- link/log) virava membro 'active' e lia/escrevia TODO o PHI do paciente via RLS.
-- Correção (defesa no banco, não só na UI): exigir que o e-mail do chamador (claim do JWT)
-- case com o do convite, case-insensitive. Mesmo padrão de leitura de claim usado por is_admin().
-- =====================================================

CREATE OR REPLACE FUNCTION accept_invitation(p_token TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv invitations%ROWTYPE;
  caller_email TEXT := lower(auth.jwt() ->> 'email');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO inv FROM invitations
  WHERE token = p_token AND accepted_at IS NULL AND expires_at > NOW();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired invitation';
  END IF;

  -- Vincula a aceitação à identidade convidada: o convite é endereçado a uma pessoa específica.
  IF caller_email IS NULL OR caller_email <> lower(inv.email) THEN
    RAISE EXCEPTION 'invitation addressed to a different email';
  END IF;

  INSERT INTO case_members (patient_id, user_id, role, status, can_write)
  VALUES (inv.patient_id, auth.uid(), inv.role, 'active', inv.can_write)
  ON CONFLICT (patient_id, user_id)
  DO UPDATE SET role = EXCLUDED.role, status = 'active', can_write = EXCLUDED.can_write;

  UPDATE invitations SET accepted_at = NOW() WHERE id = inv.id;
  RETURN inv.patient_id;
END $$;

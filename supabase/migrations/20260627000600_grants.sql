-- =====================================================
-- Neurosint — Produto · 0006 · GRANTs para os papéis da Data API
-- No padrão novo do Supabase, tabelas novas NÃO são expostas automaticamente a
-- anon/authenticated/service_role. A RLS filtra LINHAS, mas o privilégio de TABELA
-- precisa ser concedido. Concedemos DML a `authenticated` e `service_role` (a RLS
-- continua sendo o porteiro de fato). `anon` fica sem acesso aos dados clínicos.
-- =====================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- Tabelas: DML para authenticated (RLS gate) e service_role (server-side; tem BYPASSRLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

-- Sequences (identity de audit_log etc.).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Funções/RPCs.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Objetos FUTUROS criados pelo postgres em public herdam os mesmos grants
-- (evita ter que repetir a cada nova tabela/função).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

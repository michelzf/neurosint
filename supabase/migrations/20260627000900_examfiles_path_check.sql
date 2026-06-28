-- =====================================================
-- Neurosint — Produto · 0009 · exam_files: caminho amarrado ao caso (defesa em profundidade)
-- A RLS de exam_files só checava patient_id; o storage_path era texto livre, permitindo
-- registrar um caminho de OUTRO caso e exfiltrar PHI via service_role no ingest.
-- Aqui forçamos, no banco, que o storage_path comece por "{patient_id}/" e não tenha "..".
-- =====================================================

ALTER TABLE exam_files DROP CONSTRAINT IF EXISTS exam_files_path_scoped;
ALTER TABLE exam_files ADD CONSTRAINT exam_files_path_scoped CHECK (
  storage_path LIKE patient_id::text || '/%'
  AND position('..' in storage_path) = 0
);

-- =====================================================
-- Neurosint — Produto · 0008 · Storage de exames (F2)
-- Bucket privado `exams`. Convenção de caminho: {patient_id}/{arquivo}.
-- RLS em storage.objects scopada pela PRIMEIRA pasta do caminho = patient_id do caso:
--   ler/escrever só se o usuário for membro (can_write para escrever). service_role ignora RLS.
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exams', 'exams', FALSE,
  52428800, -- 50 MiB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- primeiro segmento do caminho como UUID do caso (NULL se inválido → políticas negam com segurança)
CREATE OR REPLACE FUNCTION storage_case_id(object_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE seg TEXT;
BEGIN
  seg := (storage.foldername(object_name))[1];
  RETURN seg::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

DROP POLICY IF EXISTS exams_sel ON storage.objects;
CREATE POLICY exams_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'exams' AND public.is_member(public.storage_case_id(name)));

DROP POLICY IF EXISTS exams_ins ON storage.objects;
CREATE POLICY exams_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'exams' AND public.can_write(public.storage_case_id(name)));

DROP POLICY IF EXISTS exams_upd ON storage.objects;
CREATE POLICY exams_upd ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'exams' AND public.can_write(public.storage_case_id(name)))
  WITH CHECK (bucket_id = 'exams' AND public.can_write(public.storage_case_id(name)));

DROP POLICY IF EXISTS exams_del ON storage.objects;
CREATE POLICY exams_del ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'exams' AND public.can_write(public.storage_case_id(name)));

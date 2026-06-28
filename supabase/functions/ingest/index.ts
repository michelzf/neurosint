// ingest/index.ts — processa um exame já enviado ao Storage (F2). Fluxo:
//   auth(JWT) → lê exam_files via RLS (membro?) → VALIDA caminho (anti cross-tenant/traversal)
//   → claim atômico (anti-race) → baixa do Storage → detecta o tipo pelos BYTES (anti mime-spoof)
//   → extrai (PDF→LLM, imagem→Vision, áudio→STT, texto→fallback) → cria medical_records
//   → marca exam_file processado. Provider-agnóstico. Guard de egress no boot.
import { bearer, json, preflight, readJson } from "../_shared/http.ts";
import { cfg } from "../_shared/config.ts";
import { assertNoPhiEgress } from "../_shared/guard.ts";
import { log } from "../_shared/logger.ts";
import { downloadObject, select } from "../_shared/supabase.ts";
import { getLLM, getSTT, getVision } from "../_shared/providers/index.ts";
import { claimExamFile, saveMedicalRecord, setExamFileStatus } from "../_shared/pipeline/persist.ts";
import { sniffType, toBase64 } from "../_shared/files.ts";

const boot = assertNoPhiEgress();
log.info("ingest.boot", { target: cfg.target, egress_ok: boot.ok });

const BUCKET = "exams";
const MAX_BYTES = 20 * 1024 * 1024; // teto inline seguro p/ a Edge Function (abaixo do limite do isolate)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ExamFile {
  id: string;
  patient_id: string;
  storage_path: string;
  mime: string | null;
  status: string;
}

export const handler = async (req: Request): Promise<Response> => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const jwt = bearer(req);
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const body = await readJson<{ exam_file_id?: string }>(req);
  const id = body.exam_file_id;
  if (!id || !UUID.test(id)) return json({ error: "exam_file_id inválido" }, 400);

  // 1) Lê o exam_file via RLS (JWT do usuário). Não-membro não vê → 403.
  let row: ExamFile | undefined;
  try {
    const rows = await select<ExamFile>("exam_files", `id=eq.${id}&select=id,patient_id,storage_path,mime,status`, jwt);
    row = rows[0];
  } catch (e) {
    log.error("ingest.read_failed", { err: (e as Error).message });
    return json({ error: "erro ao ler exam_file" }, 500);
  }
  if (!row) return json({ error: "sem acesso a este arquivo" }, 403);

  // 2) Caminho DEVE estar sob a pasta do próprio caso (anti cross-tenant + anti traversal).
  //    (O banco também força isso via CHECK exam_files_path_scoped; aqui é a 1ª linha de defesa.)
  const path = row.storage_path;
  if (path.split("/")[0] !== row.patient_id || path.includes("..") || path.startsWith("/")) {
    log.warn("ingest.path_rejected", { exam_file: id.slice(0, 8) });
    return json({ error: "caminho inválido" }, 400);
  }

  const fileName = path.split("/").pop() || "documento";

  // 3) Claim atômico: só processa quem mover de 'uploaded'→'processing' (anti-race/duplicação).
  let claimed = false;
  try {
    claimed = await claimExamFile(row.id);
  } catch (e) {
    log.error("ingest.claim_failed", { err: (e as Error).message });
    return json({ error: "erro ao reservar o arquivo" }, 500);
  }
  if (!claimed) return json({ ok: true, skipped: "já em processamento ou processado" }, 200);

  try {
    const bytes = await downloadObject(BUCKET, path);
    if (bytes.byteLength > MAX_BYTES) {
      await setExamFileStatus(row.id, "failed");
      return json({ error: "arquivo grande demais para processar" }, 413);
    }

    // 4) Tipo REAL pelos bytes (ignora o mime declarado pelo cliente).
    const kind = sniffType(bytes);
    let extracted = "";
    if (kind.type === "pdf") extracted = await getLLM().extractPdf(toBase64(bytes));
    else if (kind.type === "image") extracted = await getVision().describe(toBase64(bytes), kind.mime || "image/jpeg");
    else if (kind.type === "audio") extracted = await getSTT().transcribe(bytes, fileName);
    else if (kind.type === "text") extracted = (kind.text || "").slice(0, 50000);
    else {
      await setExamFileStatus(row.id, "failed");
      return json({ error: "tipo de arquivo não suportado" }, 415);
    }

    const recordId = await saveMedicalRecord(row.patient_id, {
      fileName,
      rawText: extracted,
      fileType: kind.mime || kind.type,
      fileUrl: `${BUCKET}/${path}`,
    });
    if (!recordId) {
      await setExamFileStatus(row.id, "failed");
      return json({ error: "falha ao gravar o registro clínico" }, 500);
    }
    await setExamFileStatus(row.id, "processed", recordId);

    log.info("ingest.done", { exam_file: id.slice(0, 8), kind: kind.type, chars: extracted.length });
    return json({ ok: true, record_id: recordId, kind: kind.type, chars: extracted.length, meta: { target: cfg.target, egress_ok: boot.ok } });
  } catch (e) {
    log.error("ingest.failed", { err: (e as Error).message });
    await setExamFileStatus(row.id, "failed");
    return json({ error: "falha ao processar o exame" }, 500);
  }
};

if (import.meta.main) Deno.serve(handler);

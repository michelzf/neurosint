// persist.ts — gravações no Supabase (porte de persist.js). Escreve com service_role
// (server-side, ignora RLS) — a autorização do usuário já foi validada antes (membership).
import { insert, rpc, update } from "../supabase.ts";
import { cfg } from "../config.ts";
import { log } from "../logger.ts";
import { type ParsedTags } from "./tags.ts";

/** Grava a mensagem recebida do usuário (idempotente por client_msg_id). */
export async function saveIncoming(
  patientId: string,
  opts: { content: string; senderUserId?: string | null; senderName?: string; clientMsgId?: string | null; messageType?: string },
): Promise<void> {
  try {
    await insert(
      "messages",
      {
        patient_id: patientId,
        sender_user_id: opts.senderUserId ?? null,
        sender_name: opts.senderName ?? "Família",
        client_msg_id: opts.clientMsgId ?? null,
        direction: "incoming",
        message_type: opts.messageType ?? "text",
        content: opts.content,
      },
      "resolution=ignore-duplicates",
    );
  } catch (e) {
    log.warn("persist.incoming_failed", { err: (e as Error).message });
  }
}

/** Grava a resposta do assistente. */
export async function saveOutgoing(patientId: string, text: string): Promise<void> {
  try {
    await insert("messages", {
      patient_id: patientId,
      sender_name: cfg.assistantName,
      direction: "outgoing",
      message_type: "text",
      content: text,
    });
  } catch (e) {
    log.warn("persist.outgoing_failed", { err: (e as Error).message });
  }
}

/** Grava dados clínicos extraídos das tags + fallbacks. */
export async function saveExtracted(patientId: string, parsed: ParsedTags, msgContent: string): Promise<void> {
  for (const s of parsed.symptoms) {
    try {
      await insert("symptoms", {
        patient_id: patientId,
        symptom_type: s.type,
        severity: s.severity || "leve",
        context: (msgContent || "").slice(0, 500) || null,
        on_off_state: s.on_off_state || "desconhecido",
        reported_by: "caregiver",
      });
    } catch (e) {
      log.warn("persist.symptom_failed", { err: (e as Error).message });
    }
  }

  for (const f of parsed.keyFacts) {
    try {
      await insert(
        "key_facts",
        { patient_id: patientId, category: f.category, fact_key: f.fact_key, fact_value: f.fact_value, source: f.source || "relato_paciente" },
        "resolution=merge-duplicates",
      );
    } catch (e) {
      log.warn("persist.keyfact_failed", { err: (e as Error).message });
    }
  }

  for (const c of parsed.medicationChanges) {
    try {
      const times = (c.novo_horario || "").match(/\d{1,2}/g)?.map((h) => `${h.padStart(2, "0")}:00`) ?? null;
      await rpc("update_medication", {
        p_patient_id: patientId,
        p_name: c.medicacao,
        p_action: "atualizar",
        p_dose: c.nova_dose,
        p_frequency: null,
        p_schedule_times: times,
        p_notes: "Alterado via app",
      });
    } catch (e) {
      log.warn("persist.medchange_failed", { err: (e as Error).message });
    }
  }

  if (parsed.medicationConfirm) {
    try {
      await rpc("confirm_medication", {
        p_patient_id: patientId,
        p_med_name: parsed.medicationConfirm.med_name,
        p_reported_by: "caregiver",
        p_notes: null,
      });
    } catch (e) {
      log.warn("persist.medconfirm_failed", { err: (e as Error).message });
    }
  }
}

/** Cria um registro médico a partir de um arquivo extraído. Retorna o id. Porte de persist.js. */
export async function saveMedicalRecord(
  patientId: string,
  opts: { fileName?: string; rawText?: string; summary?: string; fileType?: string; fileUrl?: string },
): Promise<string | null> {
  const fname = opts.fileName || "documento";
  const raw = opts.rawText || "";
  let record_type = "documento";
  if (/exame|laborat|hemograma|resultado/i.test(raw + fname)) record_type = "exame";
  else if (/receita|prescri/i.test(raw + fname)) record_type = "prescricao";
  else if (/consulta|laudo/i.test(raw + fname)) record_type = "consulta";
  const dateMatch = (raw + fname).match(/(\d{2})[/.\-](\d{2})[/.\-](\d{4})/);
  const record_date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
  try {
    const rows = await insert<{ id: string }>(
      "medical_records",
      {
        patient_id: patientId,
        record_date,
        record_type,
        title: fname.slice(0, 200),
        summary: (opts.summary || raw).slice(0, 2000),
        raw_text: raw.slice(0, 50000),
        file_type: opts.fileType || null,
        file_url: opts.fileUrl || null,
      },
      "return=representation",
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    log.warn("persist.record_failed", { err: (e as Error).message });
    return null;
  }
}

/** Claim atômico: só "vence" se o arquivo ainda estiver 'uploaded'. Evita reprocessamento
 *  concorrente (duplicação de medical_records, re-download/re-extração de PHI). */
export async function claimExamFile(examFileId: string): Promise<boolean> {
  const rows = await update("exam_files", `id=eq.${examFileId}&status=eq.uploaded`, { status: "processing" }, "return=representation");
  return rows.length > 0;
}

/** Atualiza o status de um exam_file (e vincula o registro criado). */
export async function setExamFileStatus(examFileId: string, status: string, recordId?: string | null): Promise<void> {
  try {
    const patch: Record<string, unknown> = { status };
    if (recordId) patch.record_id = recordId;
    await update("exam_files", `id=eq.${examFileId}`, patch);
  } catch (e) {
    log.warn("persist.examfile_status_failed", { err: (e as Error).message });
  }
}

/** Insere alerta de red-flag. */
export async function saveAlert(patientId: string, severity: string, reason: string, description: string): Promise<void> {
  try {
    await insert("alerts", {
      patient_id: patientId,
      alert_type: "red_flag",
      severity,
      title: reason,
      description,
    });
  } catch (e) {
    log.warn("persist.alert_failed", { err: (e as Error).message });
  }
}

// context.ts — monta o bloco de CONTEXTO (turno user) para o conselho. Porte de context.js.
// Lê do Supabase via RPC com o JWT do USUÁRIO → a RLS garante que só vem o caso do qual ele
// é membro (se não for membro, patient vem null → a função ask devolve 403).
import { cfg } from "../config.ts";
import { rpc } from "../supabase.ts";
import { log } from "../logger.ts";

export interface CurrentMessage { content: string; senderName?: string; originalType?: string }
export interface PatientCtx { patient?: Record<string, unknown> | null; [k: string]: unknown }

function nowBRT(): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

function arr<T = Record<string, unknown>>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export async function buildContext(
  jwt: string,
  patientId: string,
  current: CurrentMessage,
): Promise<{ context: string; ctx: PatientCtx; people: string[]; medNames: string[]; canWrite: boolean }> {
  let summary: Record<string, unknown> | null = null;
  let ctx: PatientCtx = {};
  let recent: Record<string, unknown>[] = [];
  // Permissão de ESCRITA do chamador, avaliada SOB A RLS (JWT do usuário): a RPC can_write é
  // SECURITY DEFINER e lê auth.uid(). Membro só-leitura (ex.: médico convidado, can_write=FALSE)
  // pode LER o contexto mas NÃO deve disparar persistência mutante via service_role. Fail-closed.
  let canWrite = false;

  try {
    summary = await rpc("get_latest_summary", { p_patient_id: patientId }, jwt);
  } catch (e) {
    log.warn("context.summary_failed", { err: (e as Error).message });
  }
  try {
    canWrite = (await rpc<boolean>("can_write", { p: patientId }, jwt)) === true;
  } catch (e) {
    log.warn("context.can_write_failed", { err: (e as Error).message });
  }
  try {
    ctx = (await rpc<PatientCtx>("get_patient_context", { p_patient_id: patientId }, jwt)) || {};
  } catch (e) {
    log.warn("context.patient_failed", { err: (e as Error).message });
  }
  try {
    recent = arr(await rpc("get_recent_messages", { p_patient_id: patientId, p_limit: cfg.recentMessagesLimit }, jwt));
  } catch (e) {
    log.warn("context.recent_failed", { err: (e as Error).message });
  }

  const blocks: string[] = [];
  blocks.push(`== AGORA ==\nData e hora (Brasília): ${nowBRT()}.`);

  if (summary?.summary_text) blocks.push(`== RESUMO DAS CONVERSAS ANTERIORES ==\n${summary.summary_text}`);

  const p = (ctx.patient || {}) as Record<string, unknown>;
  if (p.name) {
    blocks.push(`== PACIENTE ==\nNome: ${p.name}${p.age ? `, ${p.age} anos` : ""}.\nDiagnóstico: ${p.diagnosis || "Parkinson"}.`);
  }

  const meds = arr(ctx.medications).filter((m) => (m as Record<string, unknown>).is_taking !== false);
  if (meds.length) {
    blocks.push(
      "== MEDICAÇÕES ATIVAS ==\n" +
        meds.map((m) => {
          const x = m as Record<string, unknown>;
          const times = Array.isArray(x.schedule_times) ? ` às ${(x.schedule_times as string[]).join(", ")}` : "";
          return `- ${x.name}${x.dose ? ` ${x.dose}` : ""}${x.frequency ? ` (${x.frequency})` : ""}${times}${x.notes ? ` — ${x.notes}` : ""}`;
        }).join("\n"),
    );
  }

  const dbs = ctx.active_dbs_config as Record<string, unknown> | null;
  if (dbs) {
    blocks.push(
      `== DBS (programa ativo) ==\nPrograma ${dbs.program_number ?? "?"} de ${dbs.config_date ?? ""}: ` +
        `esq ${dbs.amplitude_left ?? "?"}, dir ${dbs.amplitude_right ?? "?"}, ${dbs.frequency ?? "?"}, ${dbs.pulse_width ?? "?"}${dbs.notes ? ` — ${dbs.notes}` : ""}`,
    );
  }

  const records = arr(ctx.recent_records);
  if (records.length) {
    blocks.push(
      "== EXAMES E REGISTROS ==\n" +
        records.map((r) => {
          const x = r as Record<string, unknown>;
          return `- ${x.record_date || ""} ${x.record_type || ""}: ${x.title || ""}${x.summary ? ` — ${x.summary}` : ""}`;
        }).join("\n"),
    );
  }

  const symptoms = arr(ctx.recent_symptoms).slice(0, 10);
  if (symptoms.length) {
    blocks.push(
      "== SINTOMAS RECENTES ==\n" +
        symptoms.map((s) => {
          const x = s as Record<string, unknown>;
          return `- ${x.symptom_type} (${x.severity || "?"})${x.context ? ` — ${x.context}` : ""}`;
        }).join("\n"),
    );
  }

  const facts = arr(ctx.key_facts);
  if (facts.length) {
    blocks.push("== FATOS-CHAVE ==\n" + facts.map((f) => {
      const x = f as Record<string, unknown>;
      return `- [${x.category}] ${x.fact_key}: ${x.fact_value}`;
    }).join("\n"));
  }

  const alerts = arr(ctx.recent_alerts);
  if (alerts.length) {
    blocks.push("== ALERTAS ATIVOS ==\n" + alerts.map((a) => {
      const x = a as Record<string, unknown>;
      return `- (${x.severity}) ${x.title}${x.description ? `: ${x.description}` : ""}`;
    }).join("\n"));
  }

  // histórico recente em ordem cronológica, removendo a própria mensagem atual se já gravada
  const history = recent.slice().reverse();
  const idx = history.findIndex((m) =>
    (m as Record<string, unknown>).direction === "incoming" &&
    String((m as Record<string, unknown>).content || "").trim() === (current.content || "").trim()
  );
  if (idx >= 0) history.splice(idx, 1);
  if (history.length) {
    blocks.push(
      `== HISTÓRICO RECENTE (${history.length}) ==\n` +
        history.map((m) => {
          const x = m as Record<string, unknown>;
          return `${x.direction === "incoming" ? x.sender_name || "Família" : cfg.assistantName}: ${x.content}`;
        }).join("\n"),
    );
  }

  blocks.push(`== REMETENTE ATUAL ==\n${current.senderName || "Família"}`);
  blocks.push(`== MENSAGEM ATUAL ==\nTipo: ${current.originalType || "text"}\nConteúdo: ${current.content}`);

  // Nomes de pessoas conhecidas do caso (paciente + remetentes) — alvos da pseudonimização cloud.
  const people = new Set<string>();
  if (p.name) people.add(String(p.name));
  if (current.senderName) people.add(current.senderName);
  for (const m of history) {
    const sn = String((m as Record<string, unknown>).sender_name || "").trim();
    if (sn && sn.toLowerCase() !== "família" && sn !== cfg.assistantName) people.add(sn);
  }

  const medNames = meds.map((m) => String((m as Record<string, unknown>).name || "")).filter(Boolean);

  return { context: blocks.join("\n\n"), ctx, people: [...people], medNames, canWrite };
}

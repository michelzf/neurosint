// ask/index.ts — Edge Function de chat (F3). Fluxo: auth(JWT) → contexto(RLS) → conselho →
// tags/red-flag → persistência → resposta em texto. Provider-agnóstico (cloud/local/echo).
// Guard no boot: em OFFLINE_STRICT recusa subir se algum destino não for local.
import { bearer, json, preflight, readJson } from "../_shared/http.ts";
import { cfg } from "../_shared/config.ts";
import { assertNoPhiEgress } from "../_shared/guard.ts";
import { log } from "../_shared/logger.ts";
import { buildContext } from "../_shared/pipeline/context.ts";
import { ask as councilAsk } from "../_shared/pipeline/council.ts";
import { detectConfirmation, detectRedFlag, keywordSymptom, parseTags, strip } from "../_shared/pipeline/tags.ts";
import { saveAlert, saveExtracted, saveIncoming, saveOutgoing } from "../_shared/pipeline/persist.ts";
import { pseudonymize, rehydrate } from "../_shared/pii.ts";

// Fail-closed no boot (modo 100% local). Em server apenas calcula o relatório.
const boot = assertNoPhiEgress();
log.info("ask.boot", { target: cfg.target, egress_ok: boot.ok, llm: cfg.llmProvider, offline_strict: cfg.offlineStrict });

const FALLBACK = "Recebi sua mensagem e vou acompanhar. Se precisar, avise a família ou o médico.";

/** sub do JWT (só para atribuição; a autorização é via RLS no contexto). */
function jwtSub(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export const handler = async (req: Request): Promise<Response> => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const jwt = bearer(req);
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const body = await readJson<{ patient_id?: string; text?: string; client_msg_id?: string; sender_name?: string }>(req);
  const patientId = body.patient_id;
  const text = (body.text || "").trim();
  if (!patientId || !text) return json({ error: "patient_id e text são obrigatórios" }, 400);

  // 1) Contexto via RLS (JWT do usuário). Se não for membro, patient vem null → 403.
  let built;
  try {
    built = await buildContext(jwt, patientId, { content: text, senderName: body.sender_name, originalType: "text" });
  } catch (e) {
    log.error("ask.context_failed", { err: (e as Error).message });
    return json({ error: "erro ao montar contexto" }, 500);
  }
  if (!built.ctx?.patient) return json({ error: "sem acesso a este caso" }, 403);

  // 2) Pseudonimização opcional (apenas modo cloud). Cobre nomes conhecidos do caso (paciente +
  //    remetentes). NÃO higieniza texto livre nem dados clínicos (idade/doses/DBS) — ver pii.ts.
  let contextForLLM = built.context;
  let piiMap: ReturnType<typeof pseudonymize>["map"] | null = null;
  if (cfg.phiPseudonymize && cfg.llmProvider === "anthropic") {
    const ps = pseudonymize(built.context, built.people);
    contextForLLM = ps.text;
    piiMap = ps.map;
  }

  // 3) Conselho.
  let degraded = false;
  let reply = "";
  try {
    const r = await councilAsk(contextForLLM);
    reply = r.text;
    degraded = r.degraded;
  } catch (e) {
    log.error("ask.council_failed", { err: (e as Error).message });
    degraded = true;
  }
  if (piiMap) reply = rehydrate(reply, piiMap);
  if (!reply) {
    reply = FALLBACK;
    degraded = true; // IA não respondeu → sinaliza para a UI
  }

  // 4) Tags + fallbacks + red-flag.
  const parsed = parseTags(reply);
  const clean = strip(reply) || FALLBACK;
  if (parsed.symptoms.length === 0) {
    const kw = keywordSymptom(text);
    if (kw) parsed.symptoms.push(kw);
  }
  if (!parsed.medicationConfirm) {
    const conf = detectConfirmation(text, built.medNames); // só confirma se casar uma med real
    if (conf) parsed.medicationConfirm = conf;
  }
  const redflag = detectRedFlag(text);

  // 5) Persistência (best-effort, não bloqueia a resposta). TODA escrita roda por service_role
  //    (persist.ts ignora a RLS), então o gate de can_write precisa ser explícito AQUI: um membro
  //    só-leitura (can_write=FALSE, ex.: médico convidado) pode LER/conversar, mas não pode gravar
  //    PHI nem alterar medicação. Sem este gate, a persistência furaria a RLS de escrita.
  if (built.canWrite) {
    await saveIncoming(patientId, { content: text, senderUserId: jwtSub(jwt), senderName: body.sender_name, clientMsgId: body.client_msg_id });
    await saveExtracted(patientId, parsed, text);
    await saveOutgoing(patientId, clean);
    if (redflag.shouldAlert && redflag.severity !== "info") {
      await saveAlert(patientId, redflag.severity, redflag.reason, `${redflag.reason}: ${text.slice(0, 300)}`);
    }
  }

  log.info("ask.done", { patient: patientId.slice(0, 8), alerted: redflag.shouldAlert, persisted: built.canWrite, llm: cfg.llmProvider });
  return json({
    answer: clean,
    alert: redflag.shouldAlert ? { severity: redflag.severity, reason: redflag.reason } : null,
    meta: { target: cfg.target, llm: cfg.llmProvider, egress_ok: boot.ok, degraded, read_only: !built.canWrite },
  });
};

if (import.meta.main) Deno.serve(handler);

// e2e_test.ts — teste E2E automatizado do stack local (nível HTTP, sem browser).
// Exercita o fluxo inteiro contra o dev-server em :8000 (que roteia functions + proxia o Supabase).
// Determinístico no preset echo. Rodar:  deno test --allow-net tools/devkit/e2e_test.ts
// (ou, com tudo de uma vez: pwsh tools/test-local.ps1)

const BASE = Deno.env.get("DEV_BASE") || "http://127.0.0.1:8000";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PATIENT = "00000000-0000-0000-0000-0000000000b1";
const OTHER = "00000000-0000-0000-0000-0000000000ff";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERT: " + msg);
}
let TOKEN = "";
const h = (extra: Record<string, string> = {}) => ({ apikey: ANON, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...extra });

/** Loga via proxy e devolve o access_token (não toca em TOKEN global). */
async function login(email: string, password = "neurosint-dev"): Promise<string> {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  assert(r.ok && j.access_token, `login ${email} falhou: ${JSON.stringify(j)}`);
  return j.access_token;
}

/** count(*) de uma tabela do caso, lido sob a RLS do owner (sempre vê o próprio caso). */
async function ownerCount(table: string): Promise<number> {
  const r = await fetch(`${BASE}/rest/v1/${table}?select=id&patient_id=eq.${PATIENT}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, Prefer: "count=exact" },
  });
  const cr = r.headers.get("content-range") || "";
  const total = Number(cr.split("/")[1]);
  if (!Number.isNaN(total)) return total;
  const rows = await r.json();
  return Array.isArray(rows) ? rows.length : 0;
}

Deno.test("Neurosint E2E (local)", async (t) => {
  await t.step("health: modo local, sem egress", async () => {
    const j = await (await fetch(`${BASE}/functions/v1/health`)).json();
    assert(j.ok && j.target === "local" && j.egress_ok === true, "health inesperado: " + JSON.stringify(j));
  });

  await t.step("login (auth via proxy)", async () => {
    const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "cuidador@dev.local", password: "neurosint-dev" }),
    });
    const j = await r.json();
    assert(r.ok && j.access_token, "login falhou: " + JSON.stringify(j));
    TOKEN = j.access_token;
  });

  await t.step("paciente visível via RLS", async () => {
    const rows = await (await fetch(`${BASE}/rest/v1/patients?select=id,name`, { headers: h() })).json();
    assert(Array.isArray(rows) && rows.some((p: { id: string }) => p.id === PATIENT), "paciente do seed não veio");
  });

  await t.step("ask: responde + dispara red-flag de queda", async () => {
    const r = await fetch(`${BASE}/functions/v1/ask`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ patient_id: PATIENT, text: "ele caiu hoje de manhã ao levantar", client_msg_id: "e2e-" + Date.now() }),
    });
    const j = await r.json();
    assert(r.ok, "ask HTTP " + r.status);
    assert(typeof j.answer === "string" && j.answer.length > 0, "resposta vazia");
    assert(j.alert && /queda/i.test(j.alert.reason), "alerta de queda não disparou: " + JSON.stringify(j.alert));
  });

  await t.step("SEGURANÇA: membro só-leitura (médico) NÃO grava PHI via ask", async () => {
    // Contagens ANTES (lidas sob a RLS do owner, que enxerga o caso inteiro).
    const before = {
      symptoms: await ownerCount("symptoms"),
      messages: await ownerCount("messages"),
      alerts: await ownerCount("alerts"),
    };

    // Login como médico convidado (can_write=FALSE) e dispara um texto que casa keywordSymptom
    // + red-flag determinístico ("caiu" → sintoma 'queda' + alerta 'warning'), sem depender do LLM.
    const docToken = await login("medico@dev.local");
    const r = await fetch(`${BASE}/functions/v1/ask`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${docToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: PATIENT, text: "ele caiu hoje de manhã", client_msg_id: "e2e-ro-" + Date.now() }),
    });
    const j = await r.json();
    // Leitura é permitida: responde 200 com answer (não é 403).
    assert(r.ok, "ask (médico) deveria responder 200, veio " + r.status);
    assert(typeof j.answer === "string" && j.answer.length > 0, "médico deveria receber resposta de leitura");

    // Mas NADA pode ter sido persistido (a RLS proíbe escrita do médico; o gate de can_write barra).
    const after = {
      symptoms: await ownerCount("symptoms"),
      messages: await ownerCount("messages"),
      alerts: await ownerCount("alerts"),
    };
    assert(after.symptoms === before.symptoms, `médico só-leitura gravou symptoms (${before.symptoms} → ${after.symptoms})`);
    assert(after.messages === before.messages, `médico só-leitura gravou messages (${before.messages} → ${after.messages})`);
    assert(after.alerts === before.alerts, `médico só-leitura gravou alerts (${before.alerts} → ${after.alerts})`);
  });

  await t.step("simétrico: cuidador (can_write=TRUE) CONTINUA gravando via ask", async () => {
    const before = { symptoms: await ownerCount("symptoms"), messages: await ownerCount("messages") };
    const r = await fetch(`${BASE}/functions/v1/ask`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ patient_id: PATIENT, text: "ele caiu hoje à tarde", client_msg_id: "e2e-rw-" + Date.now() }),
    });
    assert(r.ok, "ask (cuidador) HTTP " + r.status);
    const after = { symptoms: await ownerCount("symptoms"), messages: await ownerCount("messages") };
    assert(after.symptoms > before.symptoms, `cuidador deveria gravar symptoms (${before.symptoms} → ${after.symptoms})`);
    assert(after.messages > before.messages, `cuidador deveria gravar messages (${before.messages} → ${after.messages})`);
  });

  let examFileId = "";
  await t.step("upload + exam_files (RLS) + ingest cria registro", async () => {
    const path = `${PATIENT}/${Date.now()}_e2e.txt`;
    const up = await fetch(`${BASE}/storage/v1/object/exams/${path}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, "Content-Type": "text/plain", "x-upsert": "true" },
      body: "Exame E2E 03/02/2026: hemoglobina 14. Tudo normal.",
    });
    assert(up.ok, "upload falhou HTTP " + up.status);

    const ef = await fetch(`${BASE}/rest/v1/exam_files`, {
      method: "POST",
      headers: h({ Prefer: "return=representation" }),
      body: JSON.stringify({ patient_id: PATIENT, storage_path: path, mime: "text/plain", status: "uploaded" }),
    });
    const efRows = await ef.json();
    assert(ef.ok && efRows[0]?.id, "exam_files insert falhou: " + JSON.stringify(efRows));
    examFileId = efRows[0].id;

    const ing = await fetch(`${BASE}/functions/v1/ingest`, { method: "POST", headers: h(), body: JSON.stringify({ exam_file_id: examFileId }) });
    const j = await ing.json();
    assert(ing.ok && j.ok && j.record_id, "ingest falhou: " + JSON.stringify(j));
    assert(j.chars > 0, "ingest extraiu 0 caracteres");
  });

  await t.step("idempotência: reprocessar pula", async () => {
    const j = await (await fetch(`${BASE}/functions/v1/ingest`, { method: "POST", headers: h(), body: JSON.stringify({ exam_file_id: examFileId }) })).json();
    assert(j.skipped, "reprocessamento NÃO foi pulado: " + JSON.stringify(j));
  });

  await t.step("linha do tempo inclui o exame novo", async () => {
    const rows = await (await fetch(`${BASE}/rest/v1/medical_records?select=record_type,record_date&patient_id=eq.${PATIENT}&order=created_at.desc&limit=5`, { headers: h() })).json();
    assert(Array.isArray(rows) && rows.some((r: { record_date: string }) => r.record_date === "2026-02-03"), "registro do exame E2E não apareceu");
  });

  await t.step("SEGURANÇA: registrar exame com caminho de outro caso é BLOQUEADO", async () => {
    const r = await fetch(`${BASE}/rest/v1/exam_files`, {
      method: "POST",
      headers: h({ Prefer: "return=representation" }),
      body: JSON.stringify({ patient_id: PATIENT, storage_path: `${OTHER}/vitima.pdf`, mime: "application/pdf", status: "uploaded" }),
    });
    assert(r.status >= 400, "cross-tenant deveria ser bloqueado, veio HTTP " + r.status);
  });

  await t.step("SEGURANÇA: exam_file_id não-UUID → 400", async () => {
    const r = await fetch(`${BASE}/functions/v1/ingest`, { method: "POST", headers: h(), body: JSON.stringify({ exam_file_id: "nao-uuid" }) });
    assert(r.status === 400, "esperava 400, veio " + r.status);
  });
});

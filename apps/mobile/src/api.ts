// api.ts — camada de acesso ao backend Neurosint. fetch puro (roda em web e nativo).
// Em DEV aponta para o dev-server local (:8000), que roteia as Edge Functions e proxia o
// Supabase. Em produção, troque BASE para a URL do projeto Supabase hospedado.
//
// Configurável em runtime: defina globalThis.NEUROSINT_BASE antes de carregar a app.
// (Default: dev-server local em http://127.0.0.1:8000.)

// Chave anon do demo LOCAL do Supabase (issuer "supabase-demo"): é pública por design,
// vem com todo `supabase start` e NÃO é um segredo. Em produção, troque pela anon key
// do seu projeto Supabase (a anon key é pública; o service_role NUNCA vai para o cliente).
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// deno-lint-ignore no-explicit-any
const BASE: string = (globalThis as any).NEUROSINT_BASE || "http://127.0.0.1:8000";

let token = "";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: ANON, "Content-Type": "application/json", ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface Patient { id: string; name: string; diagnosis?: string }
export interface AskResult { answer: string; alert: { severity: string; reason: string } | null; meta?: Record<string, unknown> }
export interface Record_ { record_date: string | null; record_type: string; title: string; summary: string | null }

export const api = {
  base: BASE,
  get token() {
    return token;
  },

  async health(): Promise<Record<string, unknown>> {
    const r = await fetch(`${BASE}/functions/v1/health`);
    return await r.json();
  },

  async login(email: string, password: string): Promise<void> {
    const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) throw new Error(j.error_description || j.msg || "falha no login");
    token = j.access_token;
  },

  logout(): void {
    token = "";
  },

  async patients(): Promise<Patient[]> {
    const r = await fetch(`${BASE}/rest/v1/patients?select=id,name,diagnosis&order=created_at.asc`, { headers: authHeaders() });
    return await r.json();
  },

  async ask(patientId: string, text: string): Promise<AskResult> {
    const r = await fetch(`${BASE}/functions/v1/ask`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ patient_id: patientId, text, client_msg_id: "mobile-" + Date.now() }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "falha ao perguntar");
    return j;
  },

  async timeline(patientId: string): Promise<Record_[]> {
    const r = await fetch(
      `${BASE}/rest/v1/medical_records?select=record_date,record_type,title,summary&patient_id=eq.${patientId}&order=record_date.desc&limit=20`,
      { headers: authHeaders() },
    );
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  },
};

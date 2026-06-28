// supabase.ts — camada de dados via fetch PURO contra PostgREST/Storage (sem supabase-js,
// para não importar pacotes externos — rede com TLS interceptado nesta máquina).
// Porte de assistant/src/clients/supabase.js.
//
// Regra de segurança: leituras scopadas por usuário passam o JWT do usuário (a RLS filtra).
// Escritas server-side usam a service_role (injetada pelo runtime), que ignora a RLS.

import { cfg } from "./config.ts";

function headers(jwt?: string, extra: Record<string, string> = {}): Record<string, string> {
  // O role da transação vem do Authorization (JWT do usuário p/ RLS, ou service_role server-side).
  // `apikey` é SEMPRE a anon (admissão no gateway) — nunca a service_role, p/ não expor o segredo.
  const token = jwt || cfg.serviceKey;
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** POST /rest/v1/rpc/<fn>. Passe o JWT do usuário para respeitar a RLS. */
export async function rpc<T = unknown>(fn: string, params: Record<string, unknown> = {}, jwt?: string): Promise<T | null> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(jwt),
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : null;
}

/** GET /rest/v1/<table>?<query>. */
export async function select<T = unknown>(table: string, query = "", jwt?: string): Promise<T[]> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    headers: headers(jwt),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`select ${table} ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T[]) : [];
}

/** PATCH /rest/v1/<table>?<query>. */
export async function update<T = unknown>(
  table: string,
  query: string,
  patch: Record<string, unknown>,
  prefer = "return=minimal",
  jwt?: string,
): Promise<T[]> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers(jwt, { Prefer: prefer }),
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`update ${table} ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T[]) : [];
}

/** Baixa um objeto do Storage (server-side, service_role). Retorna os bytes.
 *  Encoda cada segmento do caminho (evita path traversal / caracteres especiais na URL). */
export async function downloadObject(bucket: string, path: string): Promise<Uint8Array> {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${cfg.supabaseUrl}/storage/v1/object/${bucket}/${safePath}`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.serviceKey}` },
  });
  if (!res.ok) throw new Error(`storage download ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** POST /rest/v1/<table>. `prefer` ex.: 'return=minimal' | 'resolution=ignore-duplicates'. */
export async function insert<T = unknown>(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  prefer = "return=minimal",
  jwt?: string,
): Promise<T[]> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(jwt, { Prefer: prefer }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`insert ${table} ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T[]) : [];
}

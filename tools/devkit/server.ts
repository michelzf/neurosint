// devkit/server.ts — servidor de DESENVOLVIMENTO local (Deno). Numa única origem (:8000):
//   • serve a página web de teste (index.html)
//   • roteia as Edge Functions em processo: /functions/v1/{ask,ingest,health}
//   • faz proxy de /auth, /rest, /storage para o Supabase local (:55321)
// Assim o navegador fala só com :8000 — sem dor de cabeça de CORS. NÃO é produção;
// é um harness para rodar tudo local e testar (inclusive via Playwright).
//
// Rodar: deno run --allow-net --allow-env --allow-read tools/devkit/server.ts
import { handler as ask } from "../../supabase/functions/ask/index.ts";
import { handler as ingest } from "../../supabase/functions/ingest/index.ts";
import { handler as health } from "../../supabase/functions/health/index.ts";

const SUPA = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:55321";
const PORT = Number(Deno.env.get("DEV_PORT") || "8000");
const UI = new URL("./index.html", import.meta.url);

// CORS permissivo: o cliente web embutido é same-origin, mas o app Expo (web) roda noutra porta
// (ex.: :8081) e chama este dev-server cross-origin. Dev only.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, prefer, x-upsert",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "content-range",
};

async function proxy(req: Request, url: URL): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("host");
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = new Uint8Array(await req.arrayBuffer());
  const res = await fetch(SUPA + url.pathname + url.search, init);
  const out = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) out.set(k, v);
  return new Response(new Uint8Array(await res.arrayBuffer()), { status: res.status, headers: out });
}

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (p === "/" || p === "/index.html") {
    return new Response(await Deno.readTextFile(UI), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  if (p === "/functions/v1/ask") return await ask(req);
  if (p === "/functions/v1/ingest") return await ingest(req);
  if (p === "/functions/v1/health") return await health(req);
  if (p.startsWith("/auth/") || p.startsWith("/rest/") || p.startsWith("/storage/")) return await proxy(req, url);
  return new Response("not found", { status: 404 });
});

console.log(`Neurosint dev-server em http://127.0.0.1:${PORT}  (Supabase: ${SUPA})`);

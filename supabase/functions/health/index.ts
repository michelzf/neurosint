// health/index.ts — reporta o modo ativo e o relatório de egress (qual dado iria pra onde).
// Útil para confirmar visualmente se o modo 100% local está mesmo sem egress.
import { json, preflight } from "../_shared/http.ts";
import { cfg } from "../_shared/config.ts";
import { egressReport } from "../_shared/guard.ts";

export const handler = (req: Request): Response => {
  const pf = preflight(req);
  if (pf) return pf;

  const report = egressReport();
  return json({
    ok: true,
    service: "neurosint",
    target: cfg.target,
    offline_strict: cfg.offlineStrict,
    egress_ok: report.ok,
    providers: {
      llm: cfg.llmProvider,
      stt: cfg.sttProvider,
      tts: cfg.ttsProvider,
      vision: cfg.visionProvider,
      evidence: cfg.evidenceProvider,
    },
    egress: report.caps,
    supabase_local: report.supabase.local,
    ts: new Date().toISOString(),
  });
};

if (import.meta.main) Deno.serve(handler);

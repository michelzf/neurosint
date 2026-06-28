// guard.ts — privacidade do modo 100% local. DUAS camadas:
//  1) BOOT (assertNoPhiEgress): em OFFLINE_STRICT, recusa subir se algum provider/Supabase
//     configurado apontar para host não-local (fail-closed de configuração).
//  2) RUNTIME (instalado em config.ts): um wrapper de globalThis.fetch que, em OFFLINE_STRICT,
//     BLOQUEIA qualquer requisição a host não-local — cobre supabase.ts, providers e qualquer
//     fetch futuro, sem depender de cada função lembrar de chamar o guard.
// Não é interceptação de pacotes de baixo nível; é controle no nível de fetch da aplicação.

import { cfg } from "./config.ts";
import { hostOf, isLocalHost } from "./hosts.ts";

export { isLocalHost };

type Cap = { capability: string; provider: string; host: string; local: boolean };

/** Para cada capacidade ATIVA, qual host receberia o dado. */
export function egressReport(): { ok: boolean; caps: Cap[]; supabase: Cap } {
  const caps: Cap[] = [];
  const add = (capability: string, provider: string, host: string) =>
    caps.push({ capability, provider, host, local: isLocalHost(host) });

  if (cfg.llmProvider === "anthropic") add("llm", "anthropic", "api.anthropic.com");
  else if (cfg.llmProvider === "ollama") add("llm", "ollama", hostOf(cfg.ollamaBaseUrl));
  else add("llm", cfg.llmProvider, "");

  if (cfg.sttProvider === "openai") add("stt", "openai", "api.openai.com");
  else if (cfg.sttProvider === "faster_whisper") add("stt", "faster_whisper", hostOf(cfg.sttBaseUrl));
  else add("stt", cfg.sttProvider, "");

  if (cfg.visionProvider === "openai") add("vision", "openai", "api.openai.com");
  else if (cfg.visionProvider === "ollama_vision") add("vision", "ollama_vision", hostOf(cfg.ollamaBaseUrl));
  else add("vision", cfg.visionProvider, "");

  if (cfg.ttsProvider === "elevenlabs") add("tts", "elevenlabs", "api.elevenlabs.io");
  else if (cfg.ttsProvider === "piper") add("tts", "piper", hostOf(cfg.piperBaseUrl));
  else add("tts", cfg.ttsProvider, "");

  if (cfg.evidenceProvider === "openevidence") add("evidence", "openevidence", "api.openevidence.com");
  else add("evidence", cfg.evidenceProvider, "");

  const supabase: Cap = {
    capability: "supabase",
    provider: "supabase",
    host: hostOf(cfg.supabaseUrl),
    local: isLocalHost(hostOf(cfg.supabaseUrl)),
  };

  const ok = caps.every((c) => c.local) && supabase.local;
  return { ok, caps, supabase };
}

/**
 * No boot: em OFFLINE_STRICT, falha fechado se algo não for local. Em server (offlineStrict=false)
 * só retorna o relatório (o egress é esperado e consentido).
 */
export function assertNoPhiEgress(): { ok: boolean; caps: Cap[]; supabase: Cap } {
  const report = egressReport();
  if (cfg.offlineStrict && !report.ok) {
    const leaks = [...report.caps.filter((c) => !c.local), ...(report.supabase.local ? [] : [report.supabase])]
      .map((c) => `${c.capability}=${c.provider}(${c.host})`)
      .join(", ");
    throw new Error(
      `OFFLINE_STRICT ativo, mas há destinos NÃO-locais: ${leaks}. ` +
        `Recusando subir para garantir que nenhum dado de saúde saia da máquina.`,
    );
  }
  return report;
}

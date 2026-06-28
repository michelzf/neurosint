// config.ts — leitor de ENV das Edge Functions (Deno). Espelha assistant/src/config.js.
// Toggles ORTOGONAIS por capacidade (não um MODE monolítico): o destino de cada dado é
// explícito. SUPABASE_URL/keys são injetados automaticamente pelo runtime do Supabase.

import { hostOf, isLocalHost } from "./hosts.ts";

function env(k: string, d = ""): string {
  return Deno.env.get(k) ?? d;
}
function envBool(k: string, d = false): boolean {
  const v = Deno.env.get(k);
  if (v == null) return d;
  return v === "true" || v === "1" || v === "yes";
}
function envNum(k: string, d: number): number {
  const v = Deno.env.get(k);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export type Provider = string;

export const cfg = {
  // --- alvo de backend (não decide egress sozinho) ---
  target: env("NEUROSINT_TARGET", "server"), // local | server
  offlineStrict: envBool("OFFLINE_STRICT", false),

  // --- Supabase (INJETADO pelo runtime; não setar à mão em local) ---
  supabaseUrl: env("SUPABASE_URL", "http://kong:8000"),
  serviceKey: env("SUPABASE_SERVICE_ROLE_KEY", ""),
  anonKey: env("SUPABASE_ANON_KEY", ""),

  // --- seleção de provider por capacidade ---
  llmProvider: env("LLM_PROVIDER", "anthropic"), // anthropic | ollama | echo
  sttProvider: env("STT_PROVIDER", "openai"), // openai | faster_whisper | echo | none
  ttsProvider: env("TTS_PROVIDER", "none"), // elevenlabs | piper | none | echo
  // fail-safe: nenhuma evidência externa salvo se LIGADA explicitamente (egress explícito, nunca implícito).
  evidenceProvider: env("EVIDENCE_PROVIDER", "none"), // openevidence | none
  visionProvider: env("VISION_PROVIDER", "openai"), // openai | ollama_vision | none | echo

  phiPseudonymize: envBool("PHI_PSEUDONYMIZE", false),
  recentMessagesLimit: envNum("RECENT_MESSAGES_LIMIT", 50),

  // --- Anthropic (cloud) ---
  anthropicKey: env("ANTHROPIC_API_KEY", ""),
  anthropicVersion: env("ANTHROPIC_VERSION", "2023-06-01"),
  councilModel: env("COUNCIL_MODEL", "claude-sonnet-4-6"),
  haikuModel: env("HAIKU_MODEL", "claude-haiku-4-5-20251001"),
  councilMaxTokens: envNum("COUNCIL_MAX_TOKENS", 1500),
  councilTemperature: envNum("COUNCIL_TEMPERATURE", 0.4),

  // --- Ollama (local, OpenAI-compat) ---
  ollamaBaseUrl: env("OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1"),
  ollamaCouncilModel: env("OLLAMA_COUNCIL_MODEL", "qwen2.5:32b"),
  ollamaHaikuModel: env("OLLAMA_HAIKU_MODEL", "llama3.1:8b"),

  // --- STT ---
  openaiKey: env("OPENAI_API_KEY", ""),
  whisperModel: env("WHISPER_MODEL", "whisper-1"),
  sttBaseUrl: env("STT_BASE_URL", "http://host.docker.internal:9000"),
  sttModel: env("STT_MODEL", "large-v3"),

  // --- Visão ---
  visionModel: env("VISION_MODEL", "gpt-4.1-mini"),

  // --- TTS ---
  elevenKey: env("ELEVENLABS_API_KEY", ""),
  elevenVoiceId: env("ELEVENLABS_VOICE_ID", ""),
  elevenModel: env("ELEVENLABS_MODEL", "eleven_flash_v2_5"),
  piperBaseUrl: env("PIPER_BASE_URL", "http://host.docker.internal:10200"),

  // --- Evidência ---
  openevidenceKey: env("OPENEVIDENCE_API_KEY", ""),
  openevidenceModel: env("OPENEVIDENCE_MODEL", "oe-v2"),

  assistantName: env("ASSISTANT_NAME", "Neurosint"),
};

export type Cfg = typeof cfg;

// Aviso de configuração: sem anon key, o header `apikey` das chamadas PostgREST fica vazio.
if (!cfg.anonKey) {
  console.error(JSON.stringify({ level: "warn", msg: "config.anon_key_missing", ts: new Date().toISOString() }));
}

// --- GUARD DE EGRESS EM RUNTIME -------------------------------------------------------------
// Em OFFLINE_STRICT, embrulha globalThis.fetch UMA vez para bloquear qualquer requisição a host
// não-local. Cobre supabase.ts, todos os providers e qualquer fetch futuro — o fail-closed não
// depende de cada função lembrar de chamar o guard no boot.
const _g = globalThis as unknown as { __neurosintFetchGuard?: boolean };
if (cfg.offlineStrict && !_g.__neurosintFetchGuard) {
  _g.__neurosintFetchGuard = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const host = hostOf(url);
    if (!isLocalHost(host)) {
      return Promise.reject(new Error(`OFFLINE_STRICT: egress bloqueado para host não-local (${host})`));
    }
    return realFetch(input as Request, init);
  }) as typeof fetch;
}

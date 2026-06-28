// types.ts — interfaces das capacidades. council/context/media dependem SÓ disto;
// trocar de modo (cloud/local/echo) é trocar a implementação por trás da fábrica.

export interface AnthropicBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}
export interface AnthropicResp {
  content: AnthropicBlock[];
  stop_reason?: string;
  [k: string]: unknown;
}
export interface LLMMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}
export interface LLMRequest {
  model?: string;
  system?: string;
  messages: LLMMessage[];
  tools?: unknown[];
  max_tokens?: number;
  temperature?: number;
}

/** Cérebro. Assinaturas idênticas às de assistant/src/clients/anthropic.js. */
export interface LLM {
  messages(req: LLMRequest, timeoutMs?: number): Promise<AnthropicResp>;
  textOf(resp: AnthropicResp): string;
  complete(
    req: { model?: string; system?: string; prompt: string; max_tokens?: number; temperature?: number },
    timeoutMs?: number,
  ): Promise<string>;
  /** Extrai o conteúdo clínico de um PDF (base64). Cloud: nativo; local/echo: stub. */
  extractPdf(base64: string, instruction?: string): Promise<string>;
}

export interface STT {
  transcribe(bytes: Uint8Array, filename?: string): Promise<string>;
}
export interface TTS {
  /** vazio (length 0) quando não há voz. */
  synthesize(text: string): Promise<Uint8Array>;
}
export interface Evidence {
  analysis(questionEnglish: string): Promise<string>;
}
export interface Vision {
  describe(base64: string, mime?: string, prompt?: string): Promise<string>;
}

/** Concatena os blocos de texto de uma resposta no formato Anthropic. */
export function textOf(resp: AnthropicResp): string {
  return (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("")
    .trim();
}

// llm/ollama.ts — cérebro LOCAL via endpoint OpenAI-compatível (Ollama, LM Studio, vLLM...).
// Traduz o formato Anthropic ⇆ OpenAI chat completions. NÃO usa tools (no modo local o
// EVIDENCE_PROVIDER padrão é none, então o council não envia tools).
import { cfg } from "../../config.ts";
import { type AnthropicResp, type LLM, type LLMMessage, type LLMRequest, textOf } from "../types.ts";

function flatten(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  return (content || []).map((b) => b.text || "").join("\n");
}

function pickModel(reqModel?: string): string {
  // Mapeia o nome do modelo cloud para o modelo local equivalente.
  if (reqModel && reqModel === cfg.haikuModel) return cfg.ollamaHaikuModel;
  return cfg.ollamaCouncilModel;
}

async function messages(req: LLMRequest, timeoutMs = 120000): Promise<AnthropicResp> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const oaMessages: { role: string; content: string }[] = [];
    if (req.system) oaMessages.push({ role: "system", content: req.system });
    for (const m of req.messages) oaMessages.push({ role: m.role, content: flatten(m.content) });

    const res = await fetch(`${cfg.ollamaBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ollama" },
      body: JSON.stringify({
        model: pickModel(req.model),
        messages: oaMessages,
        max_tokens: req.max_tokens ?? cfg.councilMaxTokens,
        temperature: req.temperature ?? cfg.councilTemperature,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text);
    const answer = data?.choices?.[0]?.message?.content ?? "";
    return { content: [{ type: "text", text: String(answer) }], stop_reason: "end_turn" };
  } finally {
    clearTimeout(t);
  }
}

async function complete(
  req: { model?: string; system?: string; prompt: string; max_tokens?: number; temperature?: number },
  timeoutMs?: number,
): Promise<string> {
  const resp = await messages(
    { model: req.model, system: req.system, messages: [{ role: "user", content: req.prompt }], max_tokens: req.max_tokens, temperature: req.temperature },
    timeoutMs,
  );
  return textOf(resp);
}

function extractPdf(): Promise<string> {
  // Modelos locais via chat não leem PDF nativamente. Peça a página como foto (Vision) ou texto.
  return Promise.resolve("(extração de PDF não suportada no modo local — envie uma foto da página ou o texto)");
}

export const ollama: LLM = { messages, textOf, complete, extractPdf };

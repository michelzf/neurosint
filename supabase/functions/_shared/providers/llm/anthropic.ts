// llm/anthropic.ts — cérebro CLOUD (Anthropic Messages API). Porte de anthropic.js.
import { cfg } from "../../config.ts";
import { type AnthropicResp, type LLM, type LLMRequest, textOf } from "../types.ts";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

async function messages(req: LLMRequest, timeoutMs = 60000): Promise<AnthropicResp> {
  if (!cfg.anthropicKey) throw new Error("ANTHROPIC_API_KEY ausente (LLM_PROVIDER=anthropic).");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: req.model || cfg.councilModel,
      max_tokens: req.max_tokens ?? cfg.councilMaxTokens,
      messages: req.messages,
    };
    if (req.system) body.system = req.system;
    if (req.tools) body.tools = req.tools;
    if (typeof req.temperature === "number") body.temperature = req.temperature;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": cfg.anthropicKey,
        "anthropic-version": cfg.anthropicVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Anthropic ${body.model} ${res.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text) as AnthropicResp;
  } finally {
    clearTimeout(t);
  }
}

async function complete(
  req: { model?: string; system?: string; prompt: string; max_tokens?: number; temperature?: number },
  timeoutMs?: number,
): Promise<string> {
  const resp = await messages(
    {
      model: req.model || cfg.haikuModel,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      max_tokens: req.max_tokens ?? 800,
      temperature: req.temperature ?? 0.2,
    },
    timeoutMs,
  );
  return textOf(resp);
}

async function extractPdf(base64: string, instruction?: string): Promise<string> {
  const resp = await messages(
    {
      model: cfg.haikuModel,
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: instruction || "Extraia TODO o conteúdo clínico relevante deste documento (exames, receitas, laudos, datas, médicos). Responda em português." },
        ],
      }],
    },
    30000,
  );
  return textOf(resp);
}

export const anthropic: LLM = { messages, textOf, complete, extractPdf };

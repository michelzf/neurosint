// vision/ollama_vision.ts — descrição de imagem LOCAL (modelo multimodal via OpenAI-compat,
// ex.: llava, qwen2.5-vl no Ollama). Host local (OLLAMA_BASE_URL).
import { cfg } from "../../config.ts";
import { type Vision } from "../types.ts";

const DEFAULT_PROMPT =
  "Descreva esta imagem em português de forma objetiva. Se for exame/receita/DBS, descreva os dados relevantes.";

async function describe(base64: string, mime = "image/jpeg", prompt?: string): Promise<string> {
  const res = await fetch(`${cfg.ollamaBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer ollama" },
    body: JSON.stringify({
      model: cfg.ollamaCouncilModel,
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt || DEFAULT_PROMPT },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ollama vision ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).choices?.[0]?.message?.content || "";
}

export const ollamaVision: Vision = { describe };

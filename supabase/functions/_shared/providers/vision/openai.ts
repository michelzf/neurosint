// vision/openai.ts — descrição de imagem CLOUD (gpt-4.1-mini). Porte de openai.describeImage.
import { cfg } from "../../config.ts";
import { type Vision } from "../types.ts";

const DEFAULT_PROMPT =
  "Descreva esta imagem em português de forma objetiva. Se for um exame, receita, configuração " +
  "de DBS ou refeição, descreva os dados relevantes (valores, nomes, doses, alimentos).";

async function describe(base64: string, mime = "image/jpeg", prompt?: string): Promise<string> {
  if (!cfg.openaiKey) throw new Error("OPENAI_API_KEY ausente (VISION_PROVIDER=openai).");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.visionModel,
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
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).choices?.[0]?.message?.content || "";
}

export const openaiVision: Vision = { describe };

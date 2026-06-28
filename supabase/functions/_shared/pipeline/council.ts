// council.ts — chama o "Conselho de Especialistas" via getLLM(). Porte de council.js.
// Tool-use loop com a tool de evidência APENAS se getEvidence() != null (em local/echo, sem
// tools → uma volta só). Degrada gracioso em erro.
import { cfg } from "../config.ts";
import { getEvidence, getLLM } from "../providers/index.ts";
import { type AnthropicBlock, type LLMMessage } from "../providers/types.ts";
import { SYSTEM_PROMPT } from "../prompts/system-prompt.ts";
import { log } from "../logger.ts";

const TOOL = {
  name: "buscar_evidencia_cientifica",
  description:
    "Busca evidência científica peer-reviewed sobre Parkinson, DBS, medicações e diretrizes. " +
    "Use para confirmar um dado clínico. A pergunta DEVE ser feita em INGLÊS.",
  input_schema: {
    type: "object",
    properties: { question: { type: "string", description: "Pergunta clínica objetiva, em inglês." } },
    required: ["question"],
  },
};

export interface CouncilResult {
  text: string;
  degraded: boolean; // true = IA indisponível/falha → a UI deve sinalizar
}

export async function ask(context: string): Promise<CouncilResult> {
  const llm = getLLM();
  const evidence = getEvidence();
  const tools = evidence ? [TOOL] : undefined;
  const messages: LLMMessage[] = [{ role: "user", content: context }];

  for (let i = 0; i < 3; i++) {
    let resp;
    try {
      resp = await llm.messages({
        system: SYSTEM_PROMPT,
        messages,
        tools,
        max_tokens: cfg.councilMaxTokens,
        temperature: cfg.councilTemperature,
      });
    } catch (e) {
      log.error("council.call_failed", { err: (e as Error).message, iter: i });
      if (i === 0) throw e;
      return { text: "", degraded: true };
    }

    if (evidence && resp.stop_reason === "tool_use") {
      const toolUses = (resp.content || []).filter((b: AnthropicBlock) => b.type === "tool_use");
      // stop_reason=tool_use sem blocos tool_use (resposta malformada) → trata como final.
      if (toolUses.length === 0) {
        log.warn("council.tool_use_without_blocks", {});
        return { text: llm.textOf(resp), degraded: false };
      }
      messages.push({ role: "assistant", content: resp.content });
      const results: AnthropicBlock[] = [];
      for (const tu of toolUses) {
        const q = (tu as Record<string, unknown>).input as Record<string, unknown> | undefined;
        const question = (q?.question as string) || "";
        log.info("council.tool_call", { q: question.slice(0, 120) });
        const ev = await evidence.analysis(question);
        results.push({ type: "tool_result", tool_use_id: (tu as Record<string, unknown>).id as string, content: String(ev).slice(0, 6000) } as AnthropicBlock);
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    return { text: llm.textOf(resp), degraded: false };
  }

  // esgotou o loop em tool_use → última chamada sem tools forçando texto
  try {
    const final = await llm.messages({ system: SYSTEM_PROMPT, messages, max_tokens: cfg.councilMaxTokens, temperature: cfg.councilTemperature });
    return { text: llm.textOf(final), degraded: false };
  } catch (e) {
    log.error("council.final_failed", { err: (e as Error).message });
    return { text: "", degraded: true };
  }
}

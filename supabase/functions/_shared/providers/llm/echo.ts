// llm/echo.ts — stub SEM rede e SEM chave. Fecha o furo vertical offline e o CI.
// Não chama IA nenhuma; devolve uma resposta de demonstração no formato Anthropic.
import { type AnthropicResp, type LLM, textOf } from "../types.ts";

const DEMO =
  "Estou em modo de demonstração (provider echo), sem inteligência artificial real conectada. " +
  "Para respostas de verdade, configure LLM_PROVIDER como anthropic (nuvem) ou ollama (local). " +
  "Lembrando: este assistente apoia, mas quem decide é sempre o médico responsável.";

function messages(): Promise<AnthropicResp> {
  return Promise.resolve({ content: [{ type: "text", text: DEMO }], stop_reason: "end_turn" });
}

function complete(): Promise<string> {
  return Promise.resolve(DEMO);
}

function extractPdf(): Promise<string> {
  return Promise.resolve("(PDF recebido — extração em modo echo, sem IA real)");
}

export const echo: LLM = { messages, textOf, complete, extractPdf };

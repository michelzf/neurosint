// Testes dos providers de LLM: echo (sem rede) e ollama (mapeia Anthropic ⇆ OpenAI).
import { assert, eq } from "./_assert.ts";
import { echo } from "../../../supabase/functions/_shared/providers/llm/echo.ts";
import { ollama } from "../../../supabase/functions/_shared/providers/llm/ollama.ts";

Deno.test("echo — sem rede, formato Anthropic", async () => {
  const r = await echo.messages({ messages: [{ role: "user", content: "oi" }] });
  eq(r.stop_reason, "end_turn");
  assert(echo.textOf(r).toLowerCase().includes("demonstração"), "texto de demonstração");
  assert((await echo.complete({ prompt: "x" })).length > 0, "complete devolve texto");
  assert((await echo.extractPdf("YmFzZTY0")).length > 0, "extractPdf stub devolve texto");
});

Deno.test("echo.textOf concatena só blocos de texto", () => {
  eq(echo.textOf({ content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }] }), "ab");
});

Deno.test("ollama — traduz para OpenAI chat/completions e de volta", async () => {
  const orig = globalThis.fetch;
  let captured: { url: string; body: { messages: { role: string; content: string }[] } } | null = null;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), body: JSON.parse(String(init?.body)) };
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "resposta local" } }] }), { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await ollama.messages({ system: "regras", messages: [{ role: "user", content: "oi" }] });
    eq(r.stop_reason, "end_turn");
    eq(r.content[0].text, "resposta local", "mapeia choices[].message.content → bloco text");
    assert(captured!.url.includes("/chat/completions"), "endpoint OpenAI-compat: " + captured!.url);
    eq(captured!.body.messages[0].role, "system", "system vira 1ª mensagem");
    eq(captured!.body.messages[1].content, "oi", "mensagem do usuário preservada");
  } finally {
    globalThis.fetch = orig;
  }
});

// tts/piper.ts — voz LOCAL (Piper HTTP server). Retorna wav. Host local (PIPER_BASE_URL).
import { cfg } from "../../config.ts";
import { type TTS } from "../types.ts";

async function synthesize(text: string): Promise<Uint8Array> {
  const res = await fetch(cfg.piperBaseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Piper TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

export const piper: TTS = { synthesize };

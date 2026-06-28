// stt/openai.ts — transcrição CLOUD (OpenAI Whisper). Porte de openai.transcribe.
import { cfg } from "../../config.ts";
import { type STT } from "../types.ts";

async function transcribe(bytes: Uint8Array, filename = "audio.ogg"): Promise<string> {
  if (!cfg.openaiKey) throw new Error("OPENAI_API_KEY ausente (STT_PROVIDER=openai).");
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart]), filename);
  form.append("model", cfg.whisperModel);
  form.append("language", "pt");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.openaiKey}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI transcribe ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).text || "";
}

export const openaiStt: STT = { transcribe };

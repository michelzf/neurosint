// stt/faster_whisper.ts — transcrição LOCAL. faster-whisper-server e whisper.cpp expõem a
// mesma rota OpenAI-compatível (/v1/audio/transcriptions) num host local (STT_BASE_URL).
import { cfg } from "../../config.ts";
import { type STT } from "../types.ts";

async function transcribe(bytes: Uint8Array, filename = "audio.ogg"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart]), filename);
  form.append("model", cfg.sttModel);
  form.append("language", "pt");
  const res = await fetch(`${cfg.sttBaseUrl}/v1/audio/transcriptions`, { method: "POST", body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`faster_whisper ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text).text || "";
  } catch {
    return text; // alguns servidores devolvem texto puro
  }
}

export const fasterWhisper: STT = { transcribe };

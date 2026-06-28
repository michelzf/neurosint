// tts/elevenlabs.ts — voz CLOUD (ElevenLabs). Porte de elevenlabs.tts. Retorna mp3.
import { cfg } from "../../config.ts";
import { type TTS } from "../types.ts";

async function synthesize(text: string): Promise<Uint8Array> {
  if (!cfg.elevenKey || !cfg.elevenVoiceId) throw new Error("ELEVENLABS_API_KEY/VOICE_ID ausentes (TTS_PROVIDER=elevenlabs).");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.elevenVoiceId}`, {
    method: "POST",
    headers: { "xi-api-key": cfg.elevenKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: cfg.elevenModel,
      voice_settings: { stability: 0.8, similarity_boost: 0.9, style: 0.6, use_speaker_boost: true },
      speed: 1.0,
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

export const elevenlabs: TTS = { synthesize };

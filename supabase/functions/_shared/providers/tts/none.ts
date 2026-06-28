// tts/none.ts — sem voz. A resposta principal do app é TEXTO; TTS é opcional.
import { type TTS } from "../types.ts";

export const noneTts: TTS = {
  synthesize: () => Promise.resolve(new Uint8Array(0)),
};

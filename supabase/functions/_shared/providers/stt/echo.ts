// stt/echo.ts — sem rede. Placeholder de transcrição para dev/CI.
import { type STT } from "../types.ts";

export const echoStt: STT = {
  transcribe: () => Promise.resolve("(áudio recebido — transcrição em modo echo, sem STT real)"),
};

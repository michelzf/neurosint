// providers/index.ts — fábricas que resolvem a implementação de cada capacidade a partir
// do ENV (cfg.*Provider). Trocar de modo = trocar env; o resto do código não muda.
import { cfg } from "../config.ts";
import { type Evidence, type LLM, type STT, type TTS, type Vision } from "./types.ts";

import { anthropic } from "./llm/anthropic.ts";
import { ollama } from "./llm/ollama.ts";
import { echo } from "./llm/echo.ts";

import { openaiStt } from "./stt/openai.ts";
import { fasterWhisper } from "./stt/faster_whisper.ts";
import { echoStt } from "./stt/echo.ts";

import { elevenlabs } from "./tts/elevenlabs.ts";
import { piper } from "./tts/piper.ts";
import { noneTts } from "./tts/none.ts";

import { openaiVision } from "./vision/openai.ts";
import { ollamaVision } from "./vision/ollama_vision.ts";
import { noneVision } from "./vision/none.ts";

import { openevidence } from "./evidence/openevidence.ts";

export function getLLM(): LLM {
  switch (cfg.llmProvider) {
    case "ollama":
      return ollama;
    case "echo":
      return echo;
    default:
      return anthropic;
  }
}

export function getSTT(): STT {
  switch (cfg.sttProvider) {
    case "faster_whisper":
      return fasterWhisper;
    case "echo":
    case "none":
      return echoStt;
    default:
      return openaiStt;
  }
}

export function getTTS(): TTS {
  switch (cfg.ttsProvider) {
    case "elevenlabs":
      return elevenlabs;
    case "piper":
      return piper;
    default:
      return noneTts; // none | echo
  }
}

export function getVision(): Vision {
  switch (cfg.visionProvider) {
    case "ollama_vision":
      return ollamaVision;
    case "none":
    case "echo":
      return noneVision;
    default:
      return openaiVision;
  }
}

/** null quando EVIDENCE_PROVIDER=none → o council NÃO envia tools (degrada gracioso). */
export function getEvidence(): Evidence | null {
  return cfg.evidenceProvider === "none" ? null : openevidence;
}

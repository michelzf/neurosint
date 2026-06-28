// files.ts — utilitários de arquivo (puros, sem dependências): base64 + detecção de tipo por
// magic-bytes. Separado para ser testável em unidade.

/** Uint8Array → base64 (chunked, evita estourar o limite de args do spread). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export type SniffKind = "pdf" | "image" | "audio" | "text" | "unknown";

/** Detecta o tipo REAL pelos primeiros bytes (não confia no mime declarado pelo cliente). */
export function sniffType(b: Uint8Array): { type: SniffKind; mime?: string; text?: string } {
  const at = (i: number) => b[i];
  if (b.length >= 5 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return { type: "pdf" }; // %PDF
  if (b.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return { type: "image", mime: "image/png" };
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { type: "image", mime: "image/jpeg" };
  if (b.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46) { // RIFF
    const tag = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (tag === "WEBP") return { type: "image", mime: "image/webp" };
    if (tag === "WAVE") return { type: "audio" };
  }
  if (b.length >= 4 && at(0) === 0x4f && at(1) === 0x67 && at(2) === 0x67 && at(3) === 0x53) return { type: "audio" }; // OggS
  if (b.length >= 3 && at(0) === 0x49 && at(1) === 0x44 && at(2) === 0x33) return { type: "audio" }; // ID3 (mp3)
  if (b.length >= 2 && at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return { type: "audio" }; // mp3 frame sync
  try {
    return { type: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(b) };
  } catch {
    return { type: "unknown" };
  }
}

// Testes da detecção de tipo por magic-bytes (files.ts) — anti mime-spoofing na ingest.
import { assert, eq } from "./_assert.ts";
import { sniffType, toBase64 } from "../../../supabase/functions/_shared/files.ts";

const bytes = (...a: number[]) => new Uint8Array(a);

Deno.test("sniffType — PDF/PNG/JPEG", () => {
  eq(sniffType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d)).type, "pdf");
  eq(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0)).mime, "image/png");
  eq(sniffType(bytes(0xff, 0xd8, 0xff, 0)).mime, "image/jpeg");
});

Deno.test("sniffType — RIFF: WEBP vs WAVE", () => {
  const riff = (tag: string) => bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, ...[...tag].map((c) => c.charCodeAt(0)));
  eq(sniffType(riff("WEBP")).mime, "image/webp");
  eq(sniffType(riff("WAVE")).type, "audio");
});

Deno.test("sniffType — áudio OGG/MP3", () => {
  eq(sniffType(bytes(0x4f, 0x67, 0x67, 0x53)).type, "audio"); // OggS
  eq(sniffType(bytes(0x49, 0x44, 0x33, 0)).type, "audio"); // ID3
  eq(sniffType(bytes(0xff, 0xfb, 0)).type, "audio"); // mp3 frame sync
});

Deno.test("sniffType — texto UTF-8 vs binário desconhecido", () => {
  const t = sniffType(new TextEncoder().encode("Exame 12/03/2026 ok"));
  eq(t.type, "text");
  assert(t.text!.includes("Exame"), "devolve o texto decodificado");
  eq(sniffType(bytes(0xc0, 0x00, 0xff)).type, "unknown", "UTF-8 inválido → unknown");
});

Deno.test("toBase64 corresponde ao btoa", () => {
  eq(toBase64(bytes(1, 2, 3)), btoa("\x01\x02\x03"));
  eq(toBase64(new TextEncoder().encode("oi")), btoa("oi"));
});

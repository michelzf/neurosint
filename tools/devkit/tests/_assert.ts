// _assert.ts — asserts mínimos, sem dependências externas (rede com TLS interceptado).
export function assert(cond: unknown, msg = "assert falhou"): asserts cond {
  if (!cond) throw new Error(msg);
}
export function eq(actual: unknown, expected: unknown, msg = ""): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} — esperado ${e}, veio ${a}`);
}

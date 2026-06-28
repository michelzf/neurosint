// hosts.ts — utilitários de host SEM dependências (evita import circular entre config e guard).

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** host roda na própria máquina / rede local do dev? (inclui o Docker do dev) */
export function isLocalHost(host: string): boolean {
  if (!host) return true; // sem host = sem egress
  const h = host.toLowerCase();
  if (h === "localhost" || h === "::1") return true;
  if (h === "host.docker.internal" || h === "kong" || h === "gateway") return true;
  // TLDs reservados/privados (mDNS / uso interno) — não roteáveis publicamente.
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv4: só é local se o host INTEIRO for um IP em faixa loopback/privada.
  // (Casar por PREFIXO — ex.: /^10\./ — deixava passar "10.0.0.1.evil.com", que NÃO é a rede 10.x.)
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    return false; // qualquer outro IPv4 = externo
  }
  return false; // qualquer hostname não-reservado = externo
}

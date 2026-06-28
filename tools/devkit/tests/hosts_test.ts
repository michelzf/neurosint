// Testes do núcleo de isolamento de egress (hosts.ts) — decide o que é "local".
import { eq } from "./_assert.ts";
import { hostOf, isLocalHost } from "../../../supabase/functions/_shared/hosts.ts";

Deno.test("isLocalHost — locais/loopback/Docker/RFC1918", () => {
  for (const h of ["127.0.0.1", "localhost", "::1", "host.docker.internal", "kong", "x.local", "10.1.2.3", "192.168.0.10", "172.16.0.1", "172.31.255.1", ""]) {
    eq(isLocalHost(h), true, `${h} deveria ser local`);
  }
});

Deno.test("isLocalHost — externos são NÃO-locais", () => {
  for (const h of ["api.anthropic.com", "api.openai.com", "api.elevenlabs.io", "example.com", "172.32.0.1", "8.8.8.8"]) {
    eq(isLocalHost(h), false, `${h} deveria ser NÃO-local`);
  }
});

Deno.test("isLocalHost — prefixo de IP NÃO engana (anti-bypass do egress guard)", () => {
  // hostnames que só COMEÇAM com um IP privado são domínios externos — devem ser NÃO-locais
  for (const h of ["10.0.0.1.evil.com", "192.168.0.1.attacker.com", "172.16.0.1.example.net", "127.0.0.1.phish.io"]) {
    eq(isLocalHost(h), false, `${h} deveria ser NÃO-local (não é a rede privada)`);
  }
  // IPv4 privados COMPLETOS continuam locais
  for (const h of ["10.0.0.1", "172.20.5.5", "192.168.1.10", "127.0.0.1"]) {
    eq(isLocalHost(h), true, `${h} deveria ser local`);
  }
});

Deno.test("hostOf extrai hostname (ou vazio em URL inválida)", () => {
  eq(hostOf("https://api.openai.com/v1/x"), "api.openai.com");
  eq(hostOf("http://127.0.0.1:55321/rest"), "127.0.0.1");
  eq(hostOf("nao-e-url"), "");
});

import { defineConfig } from "@playwright/test";

// Usa o Edge/Chrome JÁ instalado no sistema (channel) — evita o download de browser do
// Playwright, que é bloqueado pelo proxy TLS desta máquina. Requer o dev-server em :8000
// (pwsh tools/local-dev.ps1).
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8000",
    channel: "msedge",
    headless: true,
  },
});

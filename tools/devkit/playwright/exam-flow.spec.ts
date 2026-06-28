import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("./fixtures/exame.txt", import.meta.url));

// Fluxo de produto no navegador: login → perguntar (+ red-flag) → enviar exame → linha do tempo.
// Requer o dev-server em :8000 no preset echo (login: cuidador@dev.local / neurosint-dev).
test("fluxo família: login, perguntar, enviar exame, linha do tempo", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#health")).toContainText("local");

  // login (campos já vêm preenchidos no preset dev)
  await page.getByTestId("email").fill("cuidador@dev.local");
  await page.getByTestId("password").fill("neurosint-dev");
  await page.getByTestId("login-btn").click();

  // paciente carregado via RLS
  await expect(page.getByTestId("patient-name")).toContainText("Paciente Exemplo");

  // perguntar com texto de red-flag → resposta + alerta
  await page.getByTestId("ask-input").fill("ele caiu hoje de manhã ao levantar da cama");
  await page.getByTestId("ask-btn").click();
  await expect(page.getByTestId("answer")).toBeVisible();
  await expect(page.getByTestId("alert")).toContainText(/queda/i);

  // enviar exame → processado
  await page.getByTestId("upload-file").setInputFiles(FIXTURE);
  await page.getByTestId("upload-btn").click();
  await expect(page.locator("#uploadMsg")).toContainText("processado", { timeout: 20_000 });

  // linha do tempo mostra o exame recém-enviado
  await expect(page.getByTestId("timeline")).toContainText("11/02/2026");
});

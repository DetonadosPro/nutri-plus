/** Local, opt-in browser acceptance test. Creates and removes only its own fixtures. */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db, databaseInfo, closeDatabase, transaction } from "../backend/db";
import { createSession } from "../backend/auth";
import { brazilDate, addCalendarDays } from "../backend/domain/datetime";
if (
  process.env.NUTRI_RUN_ACTIVITY_UI !== "true" ||
  !["localhost", "127.0.0.1"].includes(databaseInfo.host)
)
  throw Error("Requires explicit local UI test opt-in.");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NUTRI_PLAYWRIGHT_PATH || "playwright");
const origin = process.env.NUTRI_TEST_ORIGIN || "https://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Local test origin required.");
const marker = randomUUID();
const users: number[] = [];
let patientId: number | undefined;
let browser: any;
const assert = (v: unknown, message: string) => {
  if (!v) throw Error(message);
};
try {
  const pro = (await db
    .prepare(
      "INSERT INTO users(name,email,role,email_verified_at) VALUES('Profissional de teste de atividades',?,'nutritionist',CURRENT_TIMESTAMP) RETURNING id",
    )
    .get(`activity-pro-${marker}@test.local`))!;
  users.push(pro.id);
  const patient = (await db
    .prepare(
      "INSERT INTO users(name,email,role,email_verified_at) VALUES('Paciente de teste de atividades',?,'patient',CURRENT_TIMESTAMP) RETURNING id",
    )
    .get(`activity-patient-${marker}@test.local`))!;
  users.push(patient.id);
  patientId = (await db
    .prepare(
      "INSERT INTO patients(user_id,nutritionist_user_id,birth_date,sex,height_cm,activity_level) VALUES(?,?,'1990-01-01','male',175,'moderate') RETURNING id",
    )
    .get(patient.id, pro.id))!.id;
  const today = brazilDate();
  await db
    .prepare(
      "INSERT INTO weight_history(patient_id,weighed_at,weight_kg,recorded_by) VALUES(?,?,70,?)",
    )
    .run(patientId, addCalendarDays(today, -30), pro.id);
  await db
    .prepare(
      "INSERT INTO nutrition_goals(patient_id,valid_from,energy_kcal,carbohydrate_percent,protein_percent,fat_percent,created_by) VALUES(?,?,2300,45,30,25,?)",
    )
    .run(patientId, today, pro.id);
  await db
    .prepare(
      "INSERT INTO energy_settings(patient_id,valid_from,mode,factor,note,created_by) VALUES(?,?,'base_plus_net',1.2,'Teste: base sem treino',?)",
    )
    .run(patientId, today, pro.id);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies([
    { name: "nutri_session", value: (await createSession(patient.id)).token, url: origin },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("heading", { name: "Atividades do dia", exact: true }).waitFor();
  const panel = page.locator(".activity-panel");
  await panel.getByText("Nenhuma atividade registrada.", { exact: false }).waitFor();
  await panel.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page.getByLabel("Buscar modalidade").fill("caminhada moderada");
  await page
    .getByRole("button", {
      name: "Caminhada moderada, 4,5–5,5 km/h, terreno plano 3.8 MET",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Adicionar aos favoritos: Caminhada moderada, 4,5–5,5 km/h, terreno plano",
    })
    .click();
  await page.getByLabel(/^Mostrar/).selectOption("favorites");
  await page.waitForFunction(() => document.querySelectorAll(".activity-catalog>div").length === 1);
  assert((await page.locator(".activity-catalog>div").count()) === 1, "Favorite filter");
  await page.getByLabel("Horário de início").fill("09:00");
  await page.getByLabel("Esta atividade está fora").check();
  mkdirSync("outputs/activities", { recursive: true });
  await page.screenshot({ path: "outputs/activities/mobile-editor.png", fullPage: false });
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await panel.getByRole("button", { name: "Editar", exact: true }).waitFor();
  assert((await panel.innerText()).includes("133"), "Gross estimate shown");
  await panel.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Duração total (minutos)").fill("45");
  await page.getByLabel("Recalcular explicitamente").check();
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector(".activity-panel")?.textContent?.includes("45 min"),
  );
  await panel.getByRole("button", { name: "Duplicar", exact: true }).click();
  await page.getByLabel("Horário de início").fill("11:00");
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.querySelectorAll(".activity-session-title").length === 2,
  );
  await panel.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page.getByLabel("Buscar modalidade").fill("musculação");
  await page
    .getByRole("button", {
      name: "Musculação, vários exercícios, 8–15 repetições 3.5 MET",
      exact: true,
    })
    .click();
  await page.getByLabel("Horário de início").fill("14:00");
  await page.getByLabel("Detalhar séries").check();
  await page.getByRole("button", { name: "Adicionar exercício", exact: true }).click();
  await page.locator("fieldset").getByLabel("Nome", { exact: true }).fill("Agachamento");
  await page.getByLabel("Repetições por série").fill("10");
  await page.getByLabel("Execução por série (s)").fill("40");
  await page.getByLabel("Descanso entre séries (s)").fill("90");
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.querySelectorAll(".activity-session-title").length === 3,
  );
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "outputs/activities/mobile-diary.png", fullPage: false });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Mobile overflow",
  );
  await panel.getByRole("button", { name: "Analisar na Evolução →" }).click();
  await page.getByRole("heading", { name: "Balanço energético estimado", exact: true }).waitFor();
  await page.getByText("Tempo por modalidade · 3 sessões").waitFor();
  await page.screenshot({ path: "outputs/activities/mobile-progress.png", fullPage: false });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Progress overflow",
  );
  for (const width of [360, 768, 1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Progress overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "outputs/activities/desktop-progress.png", fullPage: false });
  const professional = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  await professional.addCookies([
    { name: "nutri_session", value: (await createSession(pro.id)).token, url: origin },
  ]);
  const proPage = await professional.newPage();
  await proPage.goto(origin);
  await proPage.getByText("Paciente de teste de atividades", { exact: true }).first().click();
  await proPage.getByRole("heading", { name: "Atividades do dia", exact: true }).waitFor();
  await proPage
    .locator(".activity-panel")
    .getByText("Caminhada moderada, 4,5–5,5 km/h, terreno plano", { exact: true })
    .first()
    .waitFor();
  await proPage
    .locator(".activity-panel")
    .getByRole("button", { name: "Excluir", exact: true })
    .first()
    .click();
  await proPage.getByRole("button", { name: "Excluir atividade", exact: true }).click();
  await proPage.getByRole("dialog").waitFor({ state: "hidden" });
  await proPage.waitForFunction(
    () => document.querySelectorAll(".activity-session-title").length === 2,
  );
  await proPage
    .locator(".activity-panel")
    .getByRole("button", { name: "Analisar na Evolução →" })
    .click();
  await proPage.getByText("Tempo por modalidade · 2 sessões").waitFor();
  await proPage.getByRole("button", { name: "Configurar cálculo" }).click();
  await proPage.getByRole("button", { name: "Salvar configuração" }).waitFor();
  await proPage.screenshot({
    path: "outputs/activities/professional-settings.png",
    fullPage: false,
  });
  await proPage.getByRole("button", { name: "Configurar cálculo" }).click();
  await proPage.locator(".energy-table tbody tr").first().getByRole("button").click();
  await proPage.getByRole("button", { name: "Recalcular base deste dia" }).click();
  await proPage
    .getByLabel("Motivo da correção")
    .fill("Validação de recálculo profissional auditado");
  await proPage.getByRole("button", { name: "Confirmar recálculo da base" }).click();
  await proPage.getByRole("dialog").waitFor({ state: "hidden" });
  assert(
    (await db
      .prepare("SELECT COUNT(*) AS count FROM energy_base_revisions WHERE patient_id=?")
      .get(patientId))!.count === 1,
    "Historical base audit",
  );
  assert(!errors.length, `Browser errors: ${errors.join("; ")}`);
  console.log(
    "PASS: mobile/desktop, catalog search/favorite, create/edit/duplicate, detailed resistance, professional visibility/delete, charts and settings.",
  );
} finally {
  if (browser) await browser.close();
  await transaction(async () => {
    if (patientId)
      await db.prepare("DELETE FROM patients WHERE id=? AND user_id=?").run(patientId, users[1]);
    for (const id of [...users].reverse())
      await db
        .prepare("DELETE FROM users WHERE id=? AND email LIKE ?")
        .run(id, `%${marker}@test.local`);
  });
  await closeDatabase();
}

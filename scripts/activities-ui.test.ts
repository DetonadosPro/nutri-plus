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
  const fixtureFood = (await db
    .prepare(
      "SELECT f.id FROM foods f JOIN food_nutrients n ON n.food_id=f.id AND n.nutrient_code='energia_kcal' WHERE f.active AND n.numeric_value>100 ORDER BY f.id LIMIT 1",
    )
    .get())!;
  const initialMeal = await context.request.post(origin + "/api/meals", {
    data: {
      date: today,
      mealType: "lunch",
      foodId: fixtureFood.id,
      grams: 100,
      consumedTime: "12:00",
    },
  });
  assert(initialMeal.ok(), "Real food fixture");
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => {
    errors.push(e.message);
    console.log("Browser error:", e.message);
  });
  mkdirSync("outputs/activities-simple", { recursive: true });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Atividades do dia", exact: true }).waitFor();
  const panel = page.locator(".activity-panel");
  await panel.getByText("Caminhou, treinou, dançou?", { exact: false }).waitFor();
  await page.getByText("Déficit estimado", { exact: true }).waitFor();
  const initialBalance = await page.locator(".daily-balance strong").innerText();
  // Tour the actual app, including the food reference and secondary diary.
  await page.screenshot({ path: "outputs/activities-simple/home-empty.png", fullPage: true });
  await page.getByRole("button", { name: "Registrar alimento", exact: true }).last().click();
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor();
  await page.screenshot({ path: "outputs/activities-simple/food-reference.png" });
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await page
    .locator(".patient-bottom-nav")
    .getByRole("button", { name: "Perfil", exact: true })
    .click();
  await page.getByRole("button", { name: "Registrar peso", exact: true }).waitFor();
  await page.screenshot({ path: "outputs/activities-simple/profile.png", fullPage: true });
  await page
    .locator(".patient-bottom-nav")
    .getByRole("button", { name: "Diário", exact: true })
    .click();
  await panel.getByRole("button", { name: "Adicionar atividade", exact: true }).click();
  await page.getByRole("button", { name: "Caminhada", exact: true }).waitFor();
  await page
    .locator(".movement-dialog")
    .evaluate((el: HTMLElement) => el.getAnimations().forEach((a) => a.finish()));
  await page.screenshot({ path: "outputs/activities-simple/categories-mobile.png" });
  await page.getByRole("button", { name: "Caminhada", exact: true }).click();
  await page.getByLabel("Duração em minutos").fill("30");
  assert(
    (await page.locator(".movement-options").isVisible()) === false,
    "Options hidden by default",
  );
  await page.screenshot({ path: "outputs/activities-simple/walking-mobile.png" });
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector(".activity-session-title")?.textContent?.includes("133"),
  );
  await page.waitForFunction(
    (prior: string) => document.querySelector(".daily-balance strong")?.textContent !== prior,
    initialBalance,
  );
  let saved = (await db
    .prepare("SELECT * FROM activity_sessions WHERE patient_id=?")
    .get(patientId))!;
  assert(saved.local_time === null, "No invented time");
  assert(saved.outside_base === true, "Explicit exercise eligibility");
  assert(saved.snapshot.weight.weight_kg === 70, "Weight snapshot");
  await db
    .prepare(
      "INSERT INTO weight_history(patient_id,weighed_at,weight_kg,recorded_by) VALUES(?,?,80,?)",
    )
    .run(patientId, today, pro.id);
  await panel.locator(".activity-session-title").click();
  await page.getByRole("button", { name: "Editar atividade", exact: true }).click();
  await page.getByLabel("Duração em minutos").fill("45");
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector(".activity-session-title")?.textContent?.includes("45 min"),
  );
  saved = (await db.prepare("SELECT * FROM activity_sessions WHERE patient_id=?").get(patientId))!;
  assert(
    saved.snapshot.weight.weight_kg === 70 && Math.abs(saved.snapshot.grossKcal - 199.5) < 0.01,
    "Edit keeps original weight",
  );
  await panel.getByRole("button", { name: "Adicionar atividade", exact: true }).click();
  await page
    .locator(".movement-recents")
    .getByRole("button", { name: /Caminhada/ })
    .click();
  assert(
    (await page.getByLabel("Duração em minutos").inputValue()) === "45",
    "Recent duration reused",
  );
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.querySelectorAll(".activity-session-title").length === 2,
  );
  await panel.getByRole("button", { name: "Adicionar atividade", exact: true }).click();
  await page
    .locator(".movement-category-grid")
    .getByRole("button", { name: "Musculação", exact: true })
    .click();
  await page.getByRole("button", { name: "60 min", exact: true }).click();
  await page.getByRole("button", { name: "1–2 min", exact: true }).click();
  await page.screenshot({ path: "outputs/activities-simple/strength-mobile.png" });
  await page.getByRole("button", { name: "Salvar atividade", exact: true }).click();
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.querySelectorAll(".activity-session-title").length === 3,
  );
  const strength = (await db
    .prepare("SELECT * FROM activity_sessions WHERE patient_id=? AND rest_period IS NOT NULL")
    .get(patientId))!;
  assert(
    strength.rest_period === "1to2" && strength.details.length === 0,
    "Simple strength persisted",
  );
  assert(strength.snapshot.grossKcal === 280, "No rest multiplier");
  const beforeFood = await page.locator(".daily-balance strong").innerText();
  await page.getByRole("button", { name: "Registrar alimento", exact: true }).last().click();
  await page.getByPlaceholder("Busque arroz, banana, frango…").fill("arroz");
  await page.locator(".food-result-row > button").first().click();
  await page.getByLabel("Quantidade em gramas").fill("5000");
  await page.locator(".meal-picker").getByRole("button", { name: "Almoço", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar alimento", exact: true }).click();
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await page.waitForFunction(
    (prior: string) => document.querySelector(".daily-balance strong")?.textContent !== prior,
    beforeFood,
  );
  await page.getByText("Superávit estimado", { exact: true }).waitFor();
  await page.locator('[data-slot="toast-close"]').click();
  await page.locator('[data-slot="toast"]').waitFor({ state: "hidden" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await panel.locator(".activity-session-title").first().waitFor();
  await page.screenshot({ path: "outputs/activities-simple/home-mobile.png", fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Home overflow",
  );
  await page
    .getByRole("button", { name: "Ver detalhes do balanço energético", exact: true })
    .click();
  await page.getByRole("button", { name: "Registrei toda a alimentação", exact: true }).click();
  await page.getByRole("button", { name: "Reabrir registros do dia", exact: true }).waitFor();
  await page.screenshot({ path: "outputs/activities-simple/balance-details.png" });
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await panel.getByRole("button", { name: "Ver meu histórico →" }).click();
  await page.getByRole("heading", { name: "Seu balanço energético", exact: true }).waitFor();
  await page.getByRole("button", { name: "30 dias", exact: true }).click();
  await page.getByText("Ver dias e atividades · 3 registros").waitFor();
  await page.getByText(/Superávit estimado · 1 dias completos/).waitFor();
  await page.screenshot({ path: "outputs/activities-simple/progress-mobile.png", fullPage: true });
  for (const width of [360, 390, 768, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => {
      const chart = document.querySelector(".movement-progress .recharts-surface");
      const parent = document.querySelector(".movement-progress .recharts-responsive-container");
      return (
        chart && parent && Math.abs(Number(chart.getAttribute("width")) - parent.clientWidth) < 2
      );
    });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Progress overflow ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".patient-bottom-nav")
    .getByRole("button", { name: "Diário", exact: true })
    .click();
  await page.getByRole("button", { name: "Detalhes do dia", exact: true }).click();
  await page.getByText("Como foi o dia?", { exact: true }).waitFor();
  await page.screenshot({
    path: "outputs/activities-simple/diary-detail-mobile.png",
    fullPage: true,
  });
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
  await proPage.locator(".activity-session-title").first().click();
  await proPage.getByRole("button", { name: "Excluir", exact: true }).click();
  await proPage.getByRole("button", { name: "Excluir atividade", exact: true }).click();
  await proPage.locator('[role="dialog"][data-open]:not([data-slot="toast"])').waitFor({ state: "hidden" });
  await proPage.waitForFunction(
    () => document.querySelectorAll(".activity-session-title").length === 2,
  );
  await proPage.getByRole("button", { name: "Ver meu histórico →" }).click();
  await proPage.getByRole("button", { name: "Configurar cálculo" }).click();
  await proPage.getByRole("button", { name: "Salvar configuração" }).waitFor();
  await proPage.screenshot({ path: "outputs/activities-simple/professional.png", fullPage: true });
  assert(!errors.length, `Browser errors: ${errors.join("; ")}`);
  console.log(
    "PASS: mobile/desktop, simple categories, create/edit/recent, rest, snapshots, professional visibility/delete, charts and settings.",
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

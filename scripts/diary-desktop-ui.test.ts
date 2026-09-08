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
  mkdirSync("outputs/diary-desktop", { recursive: true });
  await page.goto(origin);
  await page.getByRole("heading", {name:"Atividades do dia", exact:true}).waitFor();
  for (const width of [390,768,1024,1280,1440,1920,2560]) {
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(350);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width}`);
    await page.screenshot({path:`outputs/diary-desktop/diary-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("button",{name:"Ver Almoço",exact:true}).click();
  await page.screenshot({path:"outputs/diary-desktop/expanded.png",fullPage:true});
  await page.getByRole("button",{name:"Adicionar atividade",exact:true}).click();
  await page.getByRole("button",{name:"Caminhada",exact:true}).waitFor();
  await page.screenshot({path:"outputs/diary-desktop/activity-dialog.png"});
  await page.getByRole("button",{name:"Caminhada",exact:true}).click();
  await page.getByRole("button",{name:"Salvar atividade",exact:true}).click();
  await page.locator(".activity-session-title").waitFor();
  await page.screenshot({path:"outputs/diary-desktop/populated.png",fullPage:true});
  console.log("PASS responsive diary, food expansion, real exercise saved");
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

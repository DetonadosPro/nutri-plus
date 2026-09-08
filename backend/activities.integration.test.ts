import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import type { Server } from "node:http";
import { addCalendarDays, brazilDate } from "./domain/datetime";

describe.skipIf(process.env.NUTRI_RUN_ACTIVITY_TESTS !== "true")(
  "atividades na API e PostgreSQL isolado",
  () => {
    const schema = `nutri_activity_test_${randomUUID().replaceAll("-", "")}`;
    let root: pg.Pool, database: typeof import("./db"), server: Server, base: string;
    let patientId: number, otherId: number, userId: number, professionalId: number;
    const cookies: Record<string, string> = {};
    const today = brazilDate(),
      yesterday = addCalendarDays(today, -1);
    const payload = (extra: Record<string, unknown> = {}) => ({
      date: today,
      time: "09:00",
      duration: 30,
      intensity: "moderate",
      outsideBase: true,
      code: "17190",
      version: "2024-pt-BR.1",
      manual: null,
      details: [],
      note: "",
      ...extra,
    });
    async function request(path: string, method = "GET", body?: unknown, who = "patient") {
      const r = await fetch(base + path, {
        method,
        headers: { Cookie: cookies[who] ?? "", "Content-Type": "application/json" },
        body: body == null ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }
    beforeAll(async () => {
      if (existsSync("../.env.local")) loadEnvFile("../.env.local");
      const url = new URL(process.env.DATABASE_URL || process.env.DATABASE_URL_DEV || "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        process.env.NUTRI_ENV === "production" ||
        process.env.NUTRI_AWS_SECRET_ID
      )
        throw Error("Testes exigem PostgreSQL local.");
      root = new pg.Pool({ connectionString: url.toString() });
      await root.query(`CREATE SCHEMA ${schema}`);
      url.searchParams.set("options", `-c search_path=${schema},public`);
      vi.stubEnv("DATABASE_URL", url.toString());
      vi.stubEnv("NUTRI_ENV", "test");
      database = await import("./db");
      await database.migrate();
      const { activitiesRouter, seedActivityCatalog } = await import("./activities");
      await seedActivityCatalog();
      await seedActivityCatalog();
      const { createSession, userForSession } = await import("./auth");
      const { patientAccess } = await import("./patient-access");
      const db = database.db;
      for (const [who, role] of [
        ["professional", "nutritionist"],
        ["patient", "patient"],
        ["other", "patient"],
        ["stranger", "nutritionist"],
        ["admin", "admin"],
      ] as const) {
        const u = (await db
          .prepare(
            "INSERT INTO users(name,email,role,email_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP) RETURNING id",
          )
          .get(`${who} activity test`, `${who}@test.local`, role))!;
        cookies[who] = `nutri_session=${(await createSession(u.id)).token}`;
        if (who === "professional") professionalId = u.id;
        if (role === "patient") {
          const p = (await db
            .prepare(
              "INSERT INTO patients(user_id,nutritionist_user_id,birth_date,sex,height_cm,activity_level) VALUES(?,?,'1990-01-01','male',175,'moderate') RETURNING id",
            )
            .get(u.id, professionalId))!;
          await db
            .prepare(
              "INSERT INTO weight_history(patient_id,weighed_at,weight_kg,recorded_by) VALUES(?,?,70,?)",
            )
            .run(p.id, yesterday, u.id);
          if (who === "patient") {
            patientId = p.id;
            userId = u.id;
          } else otherId = p.id;
        }
      }
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use(
        "/api/activities",
        activitiesRouter({
          authUser: async (req, res) => {
            const u = await userForSession(req.cookies.nutri_session);
            if (!u) res.status(401).json({ error: "Não autenticado" });
            return u;
          },
          patientAccess,
        }),
      );
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/activities`;
    }, 30000);
    afterAll(async () => {
      if (server) await new Promise<void>((r) => server.close(() => r()));
      if (database) await database.closeDatabase();
      if (root) {
        await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await root.end();
      }
      vi.unstubAllEnvs();
    });
    it("isola pacientes, profissionais e administradores em todas as rotas", async () => {
      for (const who of ["admin", "stranger", "other"])
        expect(
          (await request(`/history?patientId=${patientId}`, "GET", undefined, who)).status,
        ).toBe(403);
      expect((await request("/history", "GET", undefined, "anonymous")).status).toBe(401);
      expect((await request(`/history?patientId=${otherId}`)).status).toBe(403);
      expect(
        (await request(`/history?patientId=${patientId}`, "GET", undefined, "professional")).status,
      ).toBe(200);
    });
    it("importa catálogo idempotente e guarda favoritos por usuário", async () => {
      const catalog = (await request("/catalog")).body;
      expect(catalog).toHaveLength(142);
      expect(new Set(catalog.map((c: any) => c.category)).size).toBe(15);
      expect(
        (
          await request("/favorites", "PUT", {
            code: "17190",
            version: "2024-pt-BR.1",
            favorite: true,
          })
        ).status,
      ).toBe(204);
      expect((await request("/catalog")).body.find((c: any) => c.code === "17190").favorite).toBe(
        true,
      );
      expect(
        (await request("/catalog", "GET", undefined, "other")).body.find(
          (c: any) => c.code === "17190",
        ).favorite,
      ).toBe(false);
    });
    it("registra, edita, preserva snapshots e exclui com totais sincronizados", async () => {
      const created = await request("/sessions", "POST", payload());
      expect(created.status).toBe(201);
      const s = created.body;
      expect(s.snapshot.grossKcal).toBe(133);
      expect(s.snapshot.netKcal).toBeCloseTo(98);
      let h = (await request(`/history?from=${today}&to=${today}`)).body;
      expect(h.days[0].additionalKcal).toBe(0);
      expect(h.days[0].intakeKcal).toBeNull();
      expect(h.completeDays).toBe(0);
      expect((await request("/sessions", "POST", payload())).status).toBe(409);
      expect(
        (
          await request(
            `/sessions/${s.id}?patientId=${otherId}`,
            "PUT",
            payload({ revision: 1 }),
            "other",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request("/settings", "POST", {
            mode: "base_plus_net",
            factor: 1.2,
            clinicalReview: false,
            note: "Base sem exercícios estruturados.",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            `/settings?patientId=${patientId}`,
            "POST",
            {
              mode: "base_plus_net",
              factor: 1.2,
              clinicalReview: false,
              note: "Base sem exercícios estruturados.",
            },
            "professional",
          )
        ).status,
      ).toBe(201);
      h = (await request(`/history?from=${today}&to=${today}`)).body;
      expect(h.days[0].additionalKcal).toBeCloseTo(98);
      await database.db
        .prepare("UPDATE weight_history SET weight_kg=80 WHERE patient_id=?")
        .run(patientId);
      const updated = await request(
        `/sessions/${s.id}`,
        "PUT",
        payload({ revision: 1, note: "Nota sem recálculo" }),
      );
      expect(updated.status).toBe(200);
      expect(updated.body.snapshot.weight.weight_kg).toBe(70);
      expect((await request(`/sessions/${s.id}`, "PUT", payload({ revision: 1 }))).status).toBe(
        409,
      );
      expect(
        (await request(`/sessions/${s.id}`, "PUT", payload({ revision: 2, duration: 60 }))).status,
      ).toBe(400);
      const recalculated = await request(
        `/sessions/${s.id}`,
        "PUT",
        payload({ revision: 2, duration: 60, recalculate: true }),
      );
      expect(recalculated.status).toBe(200);
      expect(recalculated.body.snapshot.weight.weight_kg).toBe(80);
      expect(recalculated.body.snapshot.netKcal).toBeCloseTo(224);
      const audit = await database.db
        .prepare("SELECT * FROM activity_revisions WHERE session_id=? ORDER BY revision")
        .all(s.id);
      expect(audit).toHaveLength(2);
      expect(audit[0].previous_record.snapshot.weight.weight_kg).toBe(70);
      const pro = (
        await request(
          `/history?patientId=${patientId}&from=${today}&to=${today}`,
          "GET",
          undefined,
          "professional",
        )
      ).body;
      expect(pro.sessions[0].id).toBe(s.id);
      expect(pro.days[0].additionalKcal).toBeCloseTo(224);
      expect((await request(`/sessions/${s.id}?revision=3`, "DELETE")).status).toBe(204);
      h = (await request(`/history?from=${today}&to=${today}`)).body;
      expect(h.days[0].additionalKcal).toBe(0);
      expect(h.sessions).toHaveLength(0);
    });
    it("registra musculação rápida e detalhada sem inferir MET de descanso", async () => {
      const d = {
        name: "Agachamento",
        sets: 3,
        reps: 10,
        loadKg: 20,
        executionSeconds: 40,
        restSeconds: 90,
      };
      const a = await request(
        "/sessions",
        "POST",
        payload({ code: "02054", time: "10:00", details: [d] }),
      );
      expect(a.status).toBe(201);
      expect(a.body.snapshot.met).toBe(3.5);
      const b = await request(
        "/sessions",
        "POST",
        payload({ code: "02054", time: "11:00", details: [{ ...d, restSeconds: 30 }] }),
      );
      expect(b.status).toBe(201);
      expect(b.body.snapshot.netKcal).toBe(a.body.snapshot.netKcal);
      const quick = await request("/sessions", "POST", payload({ code: "02050", time: "12:00" }));
      expect(quick.status).toBe(201);
      expect(
        (
          await request(
            "/sessions",
            "POST",
            payload({ code: "02054", time: "13:00", duration: 1, details: [d] }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await request("/sessions", "POST", payload({ time: "23:50", duration: 30 }))).status,
      ).toBe(400);
    });
    it("identifica energia manual sem confundir líquido e bruto", async () => {
      const a = await request(
        "/sessions",
        "POST",
        payload({
          code: null,
          version: null,
          time: "14:00",
          manual: {
            name: "Caminhada do relógio",
            source: "Dispositivo teste",
            kcal: 100,
            kind: "net",
          },
        }),
      );
      expect(a.status).toBe(201);
      expect(a.body.snapshot.netKcal).toBe(100);
      expect(a.body.snapshot.met).toBeNull();
      const b = await request(
        "/sessions",
        "POST",
        payload({
          code: null,
          version: null,
          time: "15:00",
          manual: {
            name: "Caminhada do relógio",
            source: "Dispositivo teste",
            kcal: 100,
            kind: "unknown",
          },
        }),
      );
      expect(b.status).toBe(201);
      expect(
        (await request(`/history?from=${today}&to=${today}`)).body.days[0].totalKcal,
      ).toBeNull();
    });
    it("preserva a base histórica e distingue dia incompleto, vazio e energia ausente", async () => {
      const h = (await request(`/history?from=${yesterday}&to=${yesterday}`)).body;
      const baseBefore = h.days[0].base;
      await database.db.prepare("UPDATE patients SET height_cm=190 WHERE id=?").run(patientId);
      expect(
        (await request(`/history?from=${yesterday}&to=${yesterday}`)).body.days[0].base,
      ).toEqual(baseBefore);
      await request("/food-status", "PUT", { date: yesterday, complete: true });
      expect(
        (await request(`/history?from=${yesterday}&to=${yesterday}`)).body.days[0].intakeKcal,
      ).toBe(0);
      const db = database.db;
      const log = (await db
        .prepare("INSERT INTO daily_logs(patient_id,log_date) VALUES(?,?) RETURNING id")
        .get(patientId, yesterday))!;
      const meal = (await db
        .prepare("INSERT INTO meals(daily_log_id,meal_type) VALUES(?,'lunch') RETURNING id")
        .get(log.id))!;
      const food = (await db
        .prepare(
          "INSERT INTO foods(source,source_code,description,normalized_name) VALUES('TACO','test','Teste','teste') RETURNING id",
        )
        .get())!;
      await db
        .prepare(
          "INSERT INTO meal_entries(meal_id,food_id,amount,unit,grams_equivalent) VALUES(?,?,100,'g',100)",
        )
        .run(meal.id, food.id);
      let day = (await request(`/history?from=${yesterday}&to=${yesterday}`)).body.days[0];
      expect(day.intakeKcal).toBeNull();
      expect(day.foodComplete).toBe(false);
      await db
        .prepare(
          "INSERT INTO nutrients(code,name,tagname,unit,nutrient_group) VALUES('energia_kcal','Energia','ENERC','kcal','energy')",
        )
        .run();
      await db
        .prepare(
          "INSERT INTO food_nutrients(food_id,nutrient_code,numeric_value,raw_value,status) VALUES(?,'energia_kcal',2300,'2300','numeric')",
        )
        .run(food.id);
      day = (await request(`/history?from=${yesterday}&to=${yesterday}`)).body.days[0];
      expect(day.intakeKcal).toBe(2300);
      expect(day.balanceKcal).toBeCloseTo(2300 - baseBefore.baseKcal);
    });
    it("exige recálculo profissional explícito e preserva a base anterior", async () => {
      const before = (await request(`/history?from=${yesterday}&to=${yesterday}`)).body.days[0]
        .base;
      expect(
        (
          await request("/recalculate-base", "POST", {
            date: yesterday,
            reason: "Correção de altura",
          })
        ).status,
      ).toBe(403);
      const result = await request(
        `/recalculate-base?patientId=${patientId}`,
        "POST",
        { date: yesterday, reason: "Correção de altura" },
        "professional",
      );
      expect(result.status).toBe(200);
      expect(result.body.days[0].base.baseKcal).not.toBe(before.baseKcal);
      const audit = await database.db
        .prepare(
          "SELECT previous_snapshot,reason FROM energy_base_revisions WHERE patient_id=? AND day=?",
        )
        .get(patientId, yesterday);
      expect(audit!.previous_snapshot).toEqual(before);
      expect(audit!.reason).toBe("Correção de altura");
    });
    it("não calcula MET adulto para menores e valida datas e valores", async () => {
      await database.db
        .prepare("UPDATE patients SET birth_date='2015-01-01' WHERE id=?")
        .run(otherId);
      expect((await request("/sessions", "POST", payload(), "other")).status).toBe(400);
      expect((await request("/sessions", "POST", payload({ date: "2026-02-30" }))).status).toBe(
        400,
      );
      expect((await request("/sessions", "POST", payload({ duration: null }))).status).toBe(400);
      expect((await request("/history?from=2020-01-01&to=2026-01-01")).status).toBe(400);
    });
  },
);

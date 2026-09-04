import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  brazilDate,
  brazilTime,
  inclusiveDaysBetween,
  localTimestamp,
} from "./datetime";

describe("datas do Nutri+ em America/Sao_Paulo", () => {
  it.each([
    ["2026-09-01T06:10:00.000Z", "2026-09-01", "03:10"],
    ["2026-09-01T18:10:00.000Z", "2026-09-01", "15:10"],
    ["2026-09-02T02:55:00.000Z", "2026-09-01", "23:55"],
    ["2026-09-02T03:05:00.000Z", "2026-09-02", "00:05"],
  ])("interpreta %s como %s às %s em Brasília", (iso, date, time) => {
    const instant = new Date(iso);
    expect(brazilDate(instant)).toBe(date);
    expect(brazilTime(instant)).toBe(time);
  });

  it("mantém refeição escolhida e horário como dados independentes", () => {
    expect(localTimestamp("2026-09-01", "03:10")).toBe("2026-09-01T03:10:00");
    expect(localTimestamp("2026-09-01", "15:10")).toBe("2026-09-01T15:10:00");
    expect(localTimestamp("2026-09-01", "12:00")).toBe("2026-09-01T12:00:00");
  });

  it("muda de dia sem depender do fuso do servidor", () => {
    expect(addCalendarDays("2026-09-01", 1)).toBe("2026-09-02");
    expect(addCalendarDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(inclusiveDaysBetween("2026-08-31", "2026-09-02")).toBe(3);
  });
});

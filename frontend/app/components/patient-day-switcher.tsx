"use client";

import { useRef } from "react";
import { BarChart3, CalendarDays } from "lucide-react";
import { addDays, brazilNow, formatDate, isToday } from "@/lib/datetime";
import { DatePickerPopover } from "./date-picker-popover";

type TouchPoint = { x: number; y: number };

export function PatientDaySwitcher({
  date,
  patientName,
  loading,
  onChange,
  onProgress,
}: {
  date: string;
  patientName: string;
  loading: boolean;
  onChange: (date: string) => void;
  onProgress: () => void;
}) {
  const touchStart = useRef<TouchPoint | null>(null);
  const firstName = patientName.trim().split(/\s+/)[0] || "você";
  const today = isToday(date);

  return (
    <header
      className="patient-day-switcher"
      onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
        onChange(addDays(date, deltaX > 0 ? -1 : 1));
      }}
    >
      <div className="patient-day-heading">
        <div>
          <p className="patient-day-greeting">Olá, {firstName}</p>
          <div className="patient-day-title-row">
            <h1>{today ? "Hoje" : formatDate(date, { weekday: "long" })}</h1>
            <DatePickerPopover
              date={date}
              onChange={onChange}
              triggerClassName="patient-calendar-button"
              align="start"
            >
              <CalendarDays className="size-5" aria-hidden="true" />
            </DatePickerPopover>
          </div>
          <p className="patient-selected-date">
            {formatDate(date, {
              weekday: "short",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>
        <button
          type="button"
          className="patient-day-stats"
          onClick={onProgress}
          aria-label="Abrir evolução"
        >
          <BarChart3 className="size-5" />
        </button>
      </div>

      {!today && (
        <button
          type="button"
          className="patient-back-today"
          onClick={() => onChange(brazilNow().date)}
        >
          Voltar para hoje
        </button>
      )}
      <p className="patient-swipe-hint" aria-live="polite">
        {loading ? "Atualizando dia…" : "Deslize para trocar de dia"}
      </p>
    </header>
  );
}

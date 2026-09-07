"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { addDays, formatDate, isToday } from "@/lib/datetime";
import { DatePickerPopover } from "./date-picker-popover";

export function DateNavigator({
  date,
  onChange,
  loading = false,
}: {
  date: string;
  onChange: (date: string) => void;
  loading?: boolean;
}) {
  const days = Array.from({ length: 9 }, (_, index) => addDays(date, index - 4));
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [date]);
  return (
    <section className="date-navigator" aria-label="Navegação por dias">
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <p className="eyebrow">{isToday(date) ? "Hoje" : "Dia selecionado"}</p>
          <p className="mt-0.5 text-sm font-medium capitalize text-foreground">
            {formatDate(date, { month: "long", year: "numeric" })}
          </p>
        </div>
        <DatePickerPopover date={date} onChange={onChange} triggerClassName="secondary-action">
            <CalendarDays className="size-4" />
            Ir para data
        </DatePickerPopover>
      </div>
      <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-1">
        <button
          className="icon-button"
          onClick={() => onChange(addDays(date, -1))}
          aria-label="Dia anterior"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="day-strip" aria-busy={loading}>
          {days.map((day) => {
            const selected = day === date;
            return (
              <button
                ref={selected ? selectedRef : undefined}
                key={day}
                onClick={() => onChange(day)}
                aria-pressed={selected}
                className="day-chip"
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.08em]">
                  {formatDate(day, { weekday: "short" }).replace(".", "")}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {formatDate(day, { day: "2-digit" })}
                </span>
                <span className="h-3 text-[9px] font-semibold">{isToday(day) ? "Hoje" : ""}</span>
              </button>
            );
          })}
        </div>
        <button
          className="icon-button"
          onClick={() => onChange(addDays(date, 1))}
          aria-label="Próximo dia"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
    </section>
  );
}

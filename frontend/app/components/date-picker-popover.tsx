"use client";

import { useState, type ReactNode } from "react";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function dateFromValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function valueFromDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePickerPopover({
  date,
  onChange,
  children,
  triggerClassName,
  align = "end",
}: {
  date: string;
  onChange: (date: string) => void;
  children: ReactNode;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label="Escolher data"
        className={triggerClassName}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={10}
        className="w-auto rounded-[1.6rem] border border-primary/10 bg-white/98 p-3 shadow-[0_18px_55px_rgb(25_57_54_/_16%)]"
      >
        <Calendar
          mode="single"
          selected={dateFromValue(date)}
          defaultMonth={dateFromValue(date)}
          onSelect={(selected) => {
            if (!selected) return;
            onChange(valueFromDate(selected));
            setOpen(false);
          }}
          locale={ptBR}
          captionLayout="dropdown"
          startMonth={new Date(1930, 0, 1)}
          endMonth={new Date(2100, 11, 31)}
          className={cn(
            "rounded-[1.25rem] bg-transparent p-2",
            "[--cell-radius:0.85rem] [--cell-size:2.45rem]",
          )}
        />
      </PopoverContent>
    </Popover>
  );
}

export const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';

export function brazilNow(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat('pt-BR', { timeZone: BRAZIL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const timeParts = new Intl.DateTimeFormat('pt-BR', { timeZone: BRAZIL_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return {
    date: `${part(dateParts, 'year')}-${part(dateParts, 'month')}-${part(dateParts, 'day')}`,
    time: `${part(timeParts, 'hour')}:${part(timeParts, 'minute')}`,
  };
}

export function calendarDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function addDays(date: string, amount: number) {
  const value = calendarDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(calendarDate(date));
}

export function formatDateTime(value: string, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: BRAZIL_TIME_ZONE }).format(new Date(value));
}

export function timeFromTimestamp(value?: string | null) {
  return value?.match(/T?(\d{2}):(\d{2})/)?.slice(1, 3).join(':') ?? '';
}

export function isToday(date: string) {
  return date === brazilNow().date;
}

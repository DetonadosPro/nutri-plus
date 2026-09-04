export const formatNumber = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value);

export const progressPercent = (value: number, goal?: number) =>
  goal ? Math.min(100, Math.max(0, (value / goal) * 100)) : 0;

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export const bmiBand = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return null;
  if (value < 18.5) return { label: 'Baixo peso', range: 'Abaixo de 18,5' };
  if (value < 25) return { label: 'Peso adequado', range: '18,5 a 24,9' };
  if (value < 30) return { label: 'Sobrepeso', range: '25,0 a 29,9' };
  if (value < 35) return { label: 'Obesidade grau I', range: '30,0 a 34,9' };
  if (value < 40) return { label: 'Obesidade grau II', range: '35,0 a 39,9' };
  return { label: 'Obesidade grau III', range: '40,0 ou mais' };
};

export const bmiDistance = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return '';
  if (value < 18.5)
    return `${formatNumber(18.5 - value, 1)} ponto(s) até a faixa adequada`;
  if (value < 25)
    return `${formatNumber(value - 18.5, 1)} da magreza · ${formatNumber(25 - value, 1)} do sobrepeso`;
  if (value < 30)
    return `${formatNumber(30 - value, 1)} ponto(s) até obesidade grau I`;
  return 'Acompanhe esta faixa com seu nutricionista';
};

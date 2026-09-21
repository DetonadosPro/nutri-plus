import { mealDefinition } from './meal-types';
import type { WeeklyPatientSummary } from '../app/types';

export type WeeklyInsight = { title: string; detail: string };

export function weeklySummaryInsights(data: WeeklyPatientSummary): {
  positive: WeeklyInsight;
  attention: WeeklyInsight;
} {
  const recordedDays = data.registration.recordedDays;
  const strongest = data.plan.strongestMeal;
  const attention = data.plan.attentionMeal;

  const positive: WeeklyInsight = recordedDays === 0
    ? {
        title: 'A semana ainda está sem registros alimentares.',
        detail: 'Assim que o paciente registrar uma refeição, o resumo começa a ganhar contexto.',
      }
    : strongest?.coveredItems
      ? {
          title: `${mealDefinition(strongest.mealType).label} foi a refeição mais próxima do plano.`,
          detail: `${strongest.coveredItems} de ${strongest.plannedItems} itens planejados tiveram registro correspondente.`,
        }
      : {
          title: `O diário teve registros em ${recordedDays} de ${data.registration.totalDays} dias.`,
          detail: 'Os dados disponíveis já ajudam a entender a rotina da semana.',
        };

  let attentionInsight: WeeklyInsight;
  if (recordedDays === 0) {
    attentionInsight = {
      title: 'O primeiro passo é retomar o diário.',
      detail: 'Sem registros, não é possível comparar a rotina com o plano.',
    };
  } else if (!data.plan.available) {
    attentionInsight = {
      title: 'Ainda não há plano publicado para comparar.',
      detail: 'Os registros estão preservados e entrarão na leitura quando houver um plano válido.',
    };
  } else if (
    attention &&
    (attention.mealType !== strongest?.mealType || attention.coveragePercent < 100)
  ) {
    attentionInsight = {
      title: `${mealDefinition(attention.mealType).label} merece uma olhada.`,
      detail: `${attention.coveredItems} de ${attention.plannedItems} itens planejados tiveram registro correspondente.`,
    };
  } else if (data.plan.quantityDifferences > 0) {
    attentionInsight = {
      title: `${data.plan.quantityDifferences} ${data.plan.quantityDifferences === 1 ? 'registro teve' : 'registros tiveram'} diferença relevante de quantidade.`,
      detail: 'Vale conferir o contexto antes de orientar qualquer ajuste.',
    };
  } else {
    attentionInsight = {
      title: 'Nenhum ponto prioritário apareceu nos registros disponíveis.',
      detail: 'A comparação detalhada continua disponível caso você queira revisar um dia específico.',
    };
  }

  return { positive, attention: attentionInsight };
}

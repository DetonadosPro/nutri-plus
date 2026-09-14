import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const component = readFileSync(join(import.meta.dirname, '../app/components/plan-diary-adherence.tsx'), 'utf8');
const css = readFileSync(join(import.meta.dirname, '../app/adherence.css'), 'utf8');
const nutritionistApp = readFileSync(join(import.meta.dirname, '../app/components/nutritionist-app.tsx'), 'utf8');
const patientApp = readFileSync(join(import.meta.dirname, '../app/components/patient-app.tsx'), 'utf8');

describe('plan diary adherence presentation contract', () => {
  it('uses the same read-only comparison for patient and nutritionist', () => {
    expect(component).toContain("'/patient/adherence'");
    expect(component).toContain('`/nutritionist/patients/${patientId}/adherence`');
    expect(component).not.toMatch(/method:\s*['"](?:POST|PATCH|PUT|DELETE)/);
    expect(nutritionistApp).toContain('<PlanDiaryAdherencePanel patientId={Number(profile.id)} />');
    expect(patientApp).toContain('<PlanDiaryAdherencePanel simple />');
  });

  it('offers the required periods and exposes explicit denominators', () => {
    expect(component).toContain('[7, 30]');
    expect(component).toContain('Personalizado');
    expect(component).toContain('coveredPlannedItems} de {data.summary.eligiblePlannedItems');
    expect(component).toContain('compatibleItems} de {data.summary.evaluableRecordedItems');
    expect(component).toContain('quantityAlignedItems} de {data.summary.quantityEvaluableItems');
  });

  it('uses neutral explanations and distinguishes missing data from a difference', () => {
    expect(component).toContain('<ContentSkeleton rows={4} />');
    expect(component).toContain('Ainda não há plano publicado neste período');
    expect(component).toContain('Sem registro suficiente para avaliar');
    expect(component).toContain('Sem plano publicado nesta data');
    expect(component).toContain("meal.state === 'aligned'");
    expect(component).toContain("meal.state === 'mostly_aligned'");
    expect(component).toContain('Substituição aprovada');
    expect(component).toContain('Quantidade diferente da planejada');
    expect(component).toContain('Alimento adicional registrado');
    expect(component).toContain('O plano mudou durante este período');
    expect(component).not.toMatch(/falhou|fracasso|ruim|culpa|nota de aderência/i);
  });

  it('has accessible disclosure controls, errors and reduced motion', () => {
    expect(component).toContain('<details className="adherence-day"');
    expect(component).toContain('role="alert"');
    expect(component).toContain('aria-pressed=');
    expect(css).toContain('@media (prefers-reduced-motion:reduce)');
  });

  it('contains bounded responsive layouts for narrow mobile and desktop', () => {
    expect(css).toContain('max-width:76rem');
    expect(css).toContain('@media (max-width:800px)');
    expect(css).toContain('@media (max-width:430px)');
    expect(css).toContain('minmax(0,1fr)');
    expect(css).toContain('overflow-x:auto');
  });
});

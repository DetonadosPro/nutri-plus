import type { FoodMeasure } from '../../shared/food-measures';
export type User = {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'nutritionist' | 'patient';
  canManageNutritionData?: boolean;
};
export type NutrientMap = Record<string, number | null>;
export type NutrientCatalogItem = {
  code: string;
  name: string;
  unit: string;
  nutrientGroup: string;
  sortOrder: number;
};
export type Food = {
  measures?: FoodMeasure[];
  id: number;
  source_code: string;
  description: string;
  name?: string;
  displayName?: string | null;
  recognitionName?: string;
  curationPriority?: 'common' | 'useful' | 'specific' | null;
  curationDetails?: string[];
  curationConfidence?: 'high' | 'medium' | 'low' | null;
  category: string | null;
  scientific_name?: string | null;
  brand?: string | null;
  source: 'TACO' | 'TBCA';
  favorite: boolean;
  glycemicIndex?: number | null;
  nutrients: NutrientMap;
  nutrientSources: Record<string, 'TACO' | 'TBCA'>;
  dataSources: string[];
};
export type MealEntry = {
  measure_snapshot?: FoodMeasure | null;
  id: number;
  food_id: number;
  description: string;
  name?: string;
  displayName?: string | null;
  category: string | null;
  source: 'TACO' | 'TBCA';
  glycemicIndex: number | null;
  amount: number;
  unit: string;
  grams_equivalent: number;
  consumed_at?: string | null;
  nutrients: NutrientMap;
  nutrientSources: Record<string, 'TACO' | 'TBCA'>;
  dataSources: string[];
  /** CG absoluta da porção, quando IG e carboidrato estão disponíveis. */
  glycemicLoad?: number | null;
};
export type Meal = {
  id: number;
  meal_type: string;
  label: string;
  eaten_at?: string;
  entries: MealEntry[];
  totals: NutrientMap;
  unavailable: string[];
  /** Resumo da refeição; `load`/`rawGL` permanecem em CG absoluta. */
  glycemic?: GlycemicSummary;
};
export type Goals = {
  energy_kcal?: number;
  protein_g?: number;
  carbohydrate_percent?: number;
  protein_percent?: number;
  fat_percent?: number;
  protein_gkg_min?: number;
  protein_gkg_max?: number;
  carbohydrate_g?: number;
  fat_g?: number;
  fiber_g?: number;
  water_ml?: number;
  daily_activity_factor?: number;
};
export type GlycemicClassification =
  | 'excelente'
  | 'boa'
  | 'moderada'
  | 'elevada'
  | 'muito elevada';
export type GlycemicSummary = {
  index: number | null;
  /** CG absoluta; mantido para compatibilidade e detalhamento. */
  load: number | null;
  rawGL: number | null;
  totalKcal: number | null;
  normalizedGL: number | null;
  per1000Kcal: number | null;
  classification: GlycemicClassification | null;
  coveredEntries: number;
  unavailableEntries: number;
  coveredDays?: number;
  unavailableDays?: number;
};
export type Summary = {
  date: string;
  patient: Record<string, string | number | null>;
  log: {
    water_ml: number;
    hunger?: number;
    satiety?: number;
    energy?: number;
    training?: string;
    note?: string;
  };
  meals: Meal[];
  totals: NutrientMap;
  unavailable: string[];
  weight: { weight_kg: number; weighed_at: string } | null;
  goals: Goals | null;
  proteinPerKg: number | null;
  waterGoalMl?: number | null;
  metrics: {
    bmi: number | null;
    basalKcal: number | null;
    formula: 'Mifflin-St Jeor';
  };
  energy: {
    carbohydrateKcal: number;
    proteinKcal: number;
    fatKcal: number;
    calculatedKcal: number;
    directKcal: number | null;
    differenceKcal: number | null;
    carbohydratePercent: number;
    proteinPercent: number;
    fatPercent: number;
  };
  glycemic: GlycemicSummary;
  nutrientCatalog: NutrientCatalogItem[];
};
export type History = {
  from: string;
  to: string;
  totalDays: number;
  registeredDays: number;
  days: Summary[];
  weights: Array<{ weighed_at: string; weight_kg: number }>;
  glycemic: GlycemicSummary;
};
export type PatientListItem = {
  id: number;
  name: string;
  email: string | null;
  accessStatus: 'pending_activation' | 'pending_verification' | 'active';
  objective?: string;
  height_cm?: number;
  weight_kg?: number;
  weight_date?: string;
  last_log_date?: string;
  today: Summary;
};
export type NutritionistDetail = {
  profile: Record<string, string | number | null>;
  today: Summary;
  period: {
    from: string;
    to: string;
    totalDays: number;
    registeredDays: number;
    days: Summary[];
    average: NutrientMap;
    glycemic: GlycemicSummary;
  };
  weights: Array<{ weighed_at: string; weight_kg: number }>;
  notes: Array<{
    id: number;
    visibility: 'private' | 'patient';
    content: string;
    created_at: string;
  }>;
};
export type MealPlanItem = {
  id: number;
  meal_plan_meal_id: number;
  food_id: number;
  position: number;
  amount: number;
  unit: string;
  grams_equivalent: number;
  measure_snapshot?: FoodMeasure | null;
  notes?: string | null;
  source_code: string;
  description: string;
  display_name: string;
  category?: string | null;
  source: 'TBCA';
  nutrients: NutrientMap;
  measures: FoodMeasure[];
};
export type MealPlanMeal = {
  id: number;
  meal_plan_id: number;
  meal_type: import('../../shared/meal-types').MealType;
  position: number;
  notes?: string | null;
  items: MealPlanItem[];
  totals: NutrientMap;
};
export type MealPlan = {
  id: number;
  patient_id: number;
  created_by: number;
  source_plan_id?: number | null;
  version: number;
  status: 'draft' | 'active' | 'archived';
  title?: string | null;
  notes?: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  archived_at?: string | null;
  meals: MealPlanMeal[];
  totals: NutrientMap;
  goals: (Goals & { protein_gkg_min_grams?: number }) | null;
  queryCount: number;
};
export type MealPlanListItem = Pick<
  MealPlan,
  | 'id'
  | 'version'
  | 'status'
  | 'title'
  | 'created_at'
  | 'updated_at'
  | 'published_at'
  | 'archived_at'
> & { meal_count: number };
export type Orientation = {
  id: number;
  content: string;
  created_at: string;
  patient_read_at: string | null;
  author_name: string;
};
export type OrientationInbox = { items: Orientation[]; unreadCount: number };

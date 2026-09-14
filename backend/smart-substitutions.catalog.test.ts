import { afterAll, describe, expect, it } from 'vitest';

describe('smart substitutions with the local TBCA catalog', () => {
  let close: (() => Promise<void>) | undefined;

  afterAll(async () => {
    await close?.();
  });

  it('covers real carbohydrate, legume, protein, egg, dairy and negative cases', async () => {
    const { db, closeDatabase, databaseInfo } = await import('./db');
    const {
      automaticSubstitutionSuggestions,
      classifySubstitutionFood,
    } = await import('./smart-substitutions');
    close = closeDatabase;
    if (databaseInfo.host !== '127.0.0.1') throw new Error('Teste de catálogo somente local.');

    const codes = [
      'BRC0018A', 'BRC0001T', 'BRC0114F', 'BRC0065J', 'BRC0044G', 'BRC0025J',
      'BRC0007C', 'BRC0011C', 'BRC0010J', 'BRC0004D', 'BRC0101F', 'BRC0188F',
      'BRC0475F', 'BRC0006F', 'BRC0172F', 'BRC0116G', 'BRC0018D',
    ];
    const rows = await db
      .prepare('SELECT id,source_code FROM foods WHERE source_code=ANY(?::text[]) AND active')
      .all<{ id: number; source_code: string }>(codes);
    expect(rows).toHaveLength(codes.length);
    const ids = Object.fromEntries(rows.map((row) => [row.source_code, Number(row.id)]));

    const cases = [
      ['BRC0018A', 'carbohydrate', 3],
      ['BRC0001T', 'legume', 3],
      ['BRC0114F', 'animal_protein', 3],
      ['BRC0065J', 'egg', 3],
      ['BRC0044G', 'dairy', 3],
      ['BRC0025J', 'unknown', 0],
    ] as const;
    for (const [code, group, maximum] of cases) {
      const result = await automaticSubstitutionSuggestions(ids[code], code === 'BRC0044G' ? 200 : 100);
      expect(result.classification?.group).toBe(group);
      expect(result.suggestions.length).toBeLessThanOrEqual(maximum);
      expect(result.suggestions.length).toBeLessThanOrEqual(3);
      expect(result.metrics.rankingMs).toBeLessThan(1500);
      for (const suggestion of result.suggestions) {
        expect(suggestion.equivalence.automaticCompatible).toBe(true);
        expect(suggestion.equivalence.candidateClassification.group).toBe(group);
        expect(suggestion.equivalence.gramsFinal).toBeGreaterThan(0);
        expect(suggestion.equivalence.gramsFinal).toBeLessThanOrEqual(5000);
        if (suggestion.equivalence.measureSnapshot) {
          const registered = await db
            .prepare('SELECT quantity::float8 quantity,grams::float8 grams FROM food_measures WHERE id=? AND food_id=?')
            .get<{ quantity: number; grams: number }>(
              suggestion.equivalence.measureSnapshot.id,
              suggestion.food.id,
            );
          expect(registered).toBeTruthy();
          expect(suggestion.equivalence.gramsFinal).toBeCloseTo(
            suggestion.equivalence.amount * (registered!.grams / registered!.quantity),
            8,
          );
        } else {
          expect(suggestion.equivalence.unit).toBe('g');
        }
      }
    }

    const riceA = await automaticSubstitutionSuggestions(ids.BRC0018A, 100);
    const riceB = await automaticSubstitutionSuggestions(ids.BRC0018A, 100);
    expect(
      riceA.suggestions.map((entry) => [entry.food.source_code, entry.equivalence.gramsFinal]),
    ).toEqual(
      riceB.suggestions.map((entry) => [entry.food.source_code, entry.equivalence.gramsFinal]),
    );
    expect(riceA.suggestions.map((entry) => entry.food.source_code)).toEqual(
      expect.arrayContaining(['BRC0053B']),
    );
    expect(riceA.suggestions.every((entry) => entry.equivalence.candidateClassification.family !== 'oleo')).toBe(true);

    const protein = await automaticSubstitutionSuggestions(ids.BRC0114F, 100);
    expect(protein.suggestions.every((entry) => entry.equivalence.candidateClassification.family !== 'oleo')).toBe(true);
    expect(protein.suggestions.every((entry) => !/linguiça|empanad|nugget|presunt|fiambre/i.test(entry.food.display_name))).toBe(true);

    const fruit = await automaticSubstitutionSuggestions(ids.BRC0007C, 100);
    expect(fruit.suggestions.map((entry) => entry.food.source_code)).toEqual(
      expect.arrayContaining(['BRC0010C', 'BRC0063C']),
    );

    const legume = await automaticSubstitutionSuggestions(ids.BRC0001T, 100);
    expect(legume.suggestions.map((entry) => entry.food.source_code)).toEqual(
      expect.arrayContaining(['BRC0003T', 'BRC0018T']),
    );

    const egg = await automaticSubstitutionSuggestions(ids.BRC0065J, 100);
    expect(egg.suggestions.every((entry) => !/carne|cogumelo|queijo|vegetais/i.test(entry.food.display_name))).toBe(true);

    const boiledEgg = await automaticSubstitutionSuggestions(ids.BRC0010J, 100);
    expect(boiledEgg.suggestions[0]?.equivalence.measureSnapshot?.kind).toBe('count');

    const milk = await automaticSubstitutionSuggestions(ids.BRC0044G, 200);
    expect(milk.suggestions.length).toBeGreaterThan(0);
    expect(milk.suggestions.every((entry) => entry.equivalence.measureSnapshot?.kind === 'volume')).toBe(true);

    const butter = await automaticSubstitutionSuggestions(ids.BRC0004D, 100);
    expect(butter.suggestions).toHaveLength(0);

    const blockedRows = await db.prepare(`SELECT f.id,f.source_code,COALESCE(f.display_name,f.description) display_name,
      f.description,f.category,f.curation_category,f.curation_confidence,f.curation_flags,f.curation_details,
      f.curation_score,f.duplicate_group FROM foods f WHERE f.source_code=ANY(?::text[])`)
      .all<any>(['BRC0101F', 'BRC0188F', 'BRC0475F', 'BRC0006F', 'BRC0172F', 'BRC0116G', 'BRC0018D']);
    expect(blockedRows).toHaveLength(7);
    expect(blockedRows.every((food) => classifySubstitutionFood(food).group === 'unknown')).toBe(true);

    const classified = await db.prepare(`SELECT f.id,f.source_code,COALESCE(f.display_name,f.description) display_name,
      f.description,f.category,f.curation_category,f.curation_confidence,f.curation_flags,f.curation_details,
      f.curation_score,f.duplicate_group FROM foods f WHERE f.source='TBCA' AND f.active`).all<any>();
    const counts = classified.reduce<Record<string, number>>((total, food) => {
      const group = classifySubstitutionFood(food).group;
      total[group] = (total[group] ?? 0) + 1;
      return total;
    }, {});
    expect(classified).toHaveLength(5874);
    expect(counts.unknown).toBeGreaterThan(0);
    expect(counts.carbohydrate).toBeGreaterThan(0);
    expect(counts.animal_protein).toBeGreaterThan(0);
    console.info(`[smart-substitutions-catalog] ${JSON.stringify(counts)}`);
  }, 20_000);
});

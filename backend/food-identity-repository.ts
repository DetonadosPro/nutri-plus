import { db } from './db';
import { foodRetrievalTokens, type DetectedFood, type SearchableFood } from '../shared/food-recognition';

export type TbcaSearchableFood = SearchableFood & {
  id: number;
  source_code: string;
  displayName: string;
  searchAliases: string[];
  category: string;
  source: string;
};

const SELECT_FOOD = `SELECT id,source_code,description,description AS name,
  COALESCE(display_name,description) AS "displayName",search_aliases AS "searchAliases",category,source
  FROM foods`;

/**
 * Retrieves a bounded identity family with the existing pg_trgm-backed search
 * text. Nutritional variants are still resolved by the pure semantic matcher.
 */
export async function tbcaCandidatesForDetection(item: DetectedFood, limit = 400) {
  const tokens = foodRetrievalTokens(item);
  if (!tokens.length) return [] as TbcaSearchableFood[];
  const where = tokens.map(() => 'normalized_search_text LIKE ?').join(' AND ');
  const query = tokens.join(' ');
  return db.prepare(`${SELECT_FOOD}
    WHERE active AND source='TBCA' AND ${where}
    ORDER BY GREATEST(similarity(normalized_display_name,?),similarity(normalized_name,?)) DESC,source_code
    LIMIT ${Math.max(25, Math.min(500, Math.trunc(limit)))}`)
    .all<TbcaSearchableFood>(...tokens.map((token) => `%${token}%`), query, query);
}

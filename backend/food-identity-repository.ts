import { db } from './db';
import { foodRetrievalTokens, type DetectedFood, type SearchableFood } from '../shared/food-recognition';

export type TbcaSearchableFood = SearchableFood & {
  id: number;
  source_code: string;
  displayName: string;
  searchAliases: string[];
  category: string;
  source: string;
  curationPriority: 'common' | 'useful' | 'specific';
  curationScore: number;
  curationCategory: NonNullable<SearchableFood['curationCategory']>;
  curationDetails: string[];
  curationFlags: string[];
  curationConfidence: 'high' | 'medium' | 'low';
  duplicateGroup: string | null;
};

const SELECT_FOOD = `SELECT id,source_code,description,description AS name,
  COALESCE(display_name,description) AS "displayName",search_aliases AS "searchAliases",category,source,
  curation_priority AS "curationPriority",curation_score AS "curationScore",
  curation_category AS "curationCategory",curation_details AS "curationDetails",
  curation_flags AS "curationFlags",curation_confidence AS "curationConfidence",
  duplicate_group AS "duplicateGroup"
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
    ORDER BY CASE
      WHEN normalized_display_name=? THEN 0
      WHEN ?=ANY(normalized_search_aliases) THEN 1
      WHEN normalized_display_name LIKE ? THEN 2
      WHEN EXISTS(SELECT 1 FROM unnest(normalized_search_aliases) alias WHERE alias LIKE ?) THEN 3
      ELSE 4 END,
      COALESCE(curation_priority_rank,1),COALESCE(curation_score,0) DESC,
      GREATEST(similarity(normalized_display_name,?),similarity(normalized_name,?)) DESC,source_code
    LIMIT ${Math.max(25, Math.min(500, Math.trunc(limit)))}`)
    .all<TbcaSearchableFood>(...tokens.map((token) => `%${token}%`), query, query, `${query}%`, `${query}%`, query, query);
}

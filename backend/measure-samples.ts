import { db, closeDatabase } from './db';
import { normalizeSearch } from './taco-import';

const searches = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['arroz polido cru', 'feijão cozido', 'achocolatado em pó', 'pão francês', 'abóbora', 'abacate'];
try {
  for (const search of searches) {
    const term = normalizeSearch(search);
    const foods = await db.prepare(`SELECT id,source_code,COALESCE(display_name,description) display_name
      FROM foods WHERE source='TBCA' AND active AND normalized_search_text LIKE ?
      ORDER BY CASE WHEN normalized_display_name=? THEN 0 WHEN normalized_display_name LIKE ? THEN 1 ELSE 2 END, normalized_display_name
      LIMIT 5`).all<{id:number;source_code:string;display_name:string}>(`%${term}%`, term, `${term}%`);
    const result = [];
    for (const food of foods) {
      const measures = await db.prepare(`SELECT kind,name,plural,quantity,grams,source,reference,is_default AS "isDefault"
        FROM food_measures WHERE food_id=? ORDER BY name`).all(food.id);
      if (measures.length) result.push({ ...food, measures });
    }
    console.log(JSON.stringify({ search, matches: result.slice(0, 2) }, null, 2));
  }
} finally { await closeDatabase(); }

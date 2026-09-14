ALTER TABLE foods DROP CONSTRAINT IF EXISTS foods_source_check;
ALTER TABLE foods ADD CONSTRAINT foods_source_check CHECK (source IN ('TACO', 'TBCA', 'USDA'));

WITH food AS (
  INSERT INTO foods (
    source, source_code, description, normalized_name, category, source_url,
    reference_amount, reference_unit, active, display_name, search_aliases,
    normalized_display_name, normalized_search_aliases, normalized_search_text,
    glycemic_index, curation_priority, curation_priority_rank, curation_score,
    curation_category, curation_details, curation_flags, curation_confidence,
    curation_version
  ) VALUES (
    'USDA', '167961', 'Pele suína frita, com sal', 'pele suina frita com sal',
    'Snacks', 'https://fdc.nal.usda.gov/fdc-app.html#/food-details/167961/nutrients',
    100, 'g', TRUE, 'Torresmo',
    ARRAY['torresminho','pele de porco frita','pele suína frita','pork rinds','pork skins'],
    'torresmo',
    ARRAY['torresminho','pele de porco frita','pele suina frita','pork rinds','pork skins'],
    'torresmo pele suina frita com sal torresminho pele de porco frita pele suina frita pork rinds pork skins',
    NULL, 'specific', 2, 0, 'composite_recipe',
    ARRAY['Pele suína frita','Com sal','USDA FoodData Central — Snacks, pork skins, plain'],
    ARRAY['fried','salted','processed'], 'high', 'usda-fooddata-central-sr-legacy'
  )
  RETURNING id
)
INSERT INTO food_nutrients(food_id,nutrient_code,numeric_value,raw_value,status)
SELECT food.id, nutrient.code, nutrient.value, nutrient.raw_value, nutrient.status
FROM food
CROSS JOIN (VALUES
  ('energia_kcal',544.0,'544','numeric'),
  ('energia_kj',2276.096,'2276.096','numeric'),
  ('proteina_g',61.3,'61.3','numeric'),
  ('carboidrato_g',0.0,'0','numeric'),
  ('lipideos_g',31.3,'31.3','numeric'),
  ('fibra_g',0.0,'0','numeric'),
  ('saturados_g',11.37,'11.37','numeric'),
  ('monoinsaturados_g',14.78,'14.78','numeric'),
  ('poliinsaturados_g',3.64,'3.64','numeric'),
  ('colesterol_mg',95.0,'95','numeric'),
  ('trans_g',NULL,'NA','missing'),
  ('calcio_mg',30.0,'30','numeric'),
  ('ferro_mg',0.88,'0.88','numeric'),
  ('magnesio_mg',11.0,'11','numeric'),
  ('fosforo_mg',85.0,'85','numeric'),
  ('potassio_mg',127.0,'127','numeric'),
  ('sodio_mg',1818.0,'1818','numeric'),
  ('zinco_mg',0.56,'0.56','numeric'),
  ('cobre_mg',0.094,'0.094','numeric'),
  ('manganes_mg',0.069,'0.069','numeric'),
  ('selenio_mcg',41.0,'41','numeric'),
  ('rae_ug',12.0,'12','numeric'),
  ('tiamina_mg',0.099,'0.099','numeric'),
  ('riboflavina_mg',0.283,'0.283','numeric'),
  ('niacina_mg',1.549,'1.549','numeric'),
  ('piridoxina_mg',0.023,'0.023','numeric'),
  ('vitamina_b12_mcg',0.64,'0.64','numeric'),
  ('vitamina_c_mg',0.5,'0.5','numeric'),
  ('vitamina_d_mcg',0.0,'0','numeric'),
  ('vitamina_e_mg',0.53,'0.53','numeric'),
  ('folato_equivalente_mcg',0.0,'0','numeric'),
  ('umidade_g',1.8,'1.8','numeric')
) AS nutrient(code,value,raw_value,status);

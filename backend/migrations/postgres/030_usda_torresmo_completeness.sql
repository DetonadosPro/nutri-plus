-- Keep one explicit state for every nutrient supported by the application.
-- Values come from USDA FoodData Central SR Legacy food 167961. Components
-- without a defensible source value remain unavailable instead of becoming 0.
WITH food AS (
  SELECT id FROM foods WHERE source='USDA' AND source_code='167961'
), nutrient_values(code,value,raw_value,status) AS (VALUES
  ('vitamina_e_mg',0.53,'0.53','numeric'),
  ('acucar_adicao_g',NULL,'NA','missing'),
  ('carboidrato_disponivel_g',NULL,'NA','missing'),
  ('carboidrato_g',0.0,'0','numeric'),
  ('cinzas_g',NULL,'NA','missing'),
  ('cobre_mg',0.094,'0.094','numeric'),
  ('colesterol_mg',95.0,'95','numeric'),
  ('calcio_mg',30.0,'30','numeric'),
  ('energia_kcal',544.0,'544','numeric'),
  ('energia_kj',2276.0,'2276','numeric'),
  ('folato_equivalente_mcg',0.0,'0','numeric'),
  ('ferro_mg',0.88,'0.88','numeric'),
  ('fibra_g',0.0,'0','numeric'),
  ('fosforo_mg',85.0,'85','numeric'),
  ('gordura_adicao_g',NULL,'NA','missing'),
  ('lipideos_g',31.3,'31.3','numeric'),
  ('magnesio_mg',11.0,'11','numeric'),
  ('manganes_mg',0.069,'0.069','numeric'),
  ('niacina_mg',1.549,'1.549','numeric'),
  ('potassio_mg',127.0,'127','numeric'),
  ('proteina_g',61.3,'61.3','numeric'),
  ('proteina_animal_g',NULL,'NA','missing'),
  ('proteina_vegetal_g',NULL,'NA','missing'),
  ('riboflavina_mg',0.283,'0.283','numeric'),
  ('sal_adicao_g',NULL,'NA','missing'),
  ('selenio_mcg',41.0,'41','numeric'),
  ('sodio_mg',1818.0,'1818','numeric'),
  ('tiamina_mg',0.099,'0.099','numeric'),
  ('umidade_g',1.8,'1.8','numeric'),
  ('rae_ug',12.0,'12','numeric'),
  ('re_ug',NULL,'NA','missing'),
  ('vitamina_b12_mcg',0.64,'0.64','numeric'),
  ('piridoxina_mg',0.023,'0.023','numeric'),
  ('vitamina_c_mg',0.5,'0.5','numeric'),
  ('vitamina_d_mcg',0.0,'0','numeric'),
  ('zinco_mg',0.56,'0.56','numeric'),
  ('monoinsaturados_g',14.78,'14.78','numeric'),
  ('poliinsaturados_g',3.64,'3.64','numeric'),
  ('saturados_g',11.37,'11.37','numeric'),
  ('trans_g',NULL,'NA','missing'),
  ('alcool_g',NULL,'NA','missing')
)
INSERT INTO food_nutrients(food_id,nutrient_code,numeric_value,raw_value,status,updated_at)
SELECT food.id,nutrient_values.code,nutrient_values.value,nutrient_values.raw_value,nutrient_values.status,CURRENT_TIMESTAMP
FROM food CROSS JOIN nutrient_values
ON CONFLICT(food_id,nutrient_code) DO UPDATE SET
  numeric_value=excluded.numeric_value,
  raw_value=excluded.raw_value,
  status=excluded.status,
  updated_at=CURRENT_TIMESTAMP;

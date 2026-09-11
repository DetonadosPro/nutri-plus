UPDATE foods
SET display_name = 'Omelete',
    normalized_display_name = 'omelete',
    search_aliases = ARRAY['omelete','omelete simples','omelete de ovo','ovo mexido','ovo mexido simples'],
    normalized_search_aliases = ARRAY['omelete','omelete simples','omelete de ovo','ovo mexido','ovo mexido simples'],
    normalized_search_text = 'omelete omelete simples omelete de ovo ovo mexido ovo mexido simples ' || normalized_name,
    curation_priority = 'common',
    curation_priority_rank = 0,
    curation_score = 975,
    curation_confidence = 'high',
    updated_at = CURRENT_TIMESTAMP
WHERE source = 'TBCA' AND source_code = 'BRC0065J';

INSERT INTO food_measures(food_id,key,kind,name,plural,quantity,grams,source,reference,is_default)
SELECT id,'omelet-egg-count','count','ovo','ovos',1,50,'TBCA',
  'https://www.tbca.net.br/base-dados-en/int_food_composition_2_edit.php?cod_produto=BRC0010J',true
FROM foods
WHERE source = 'TBCA' AND source_code = 'BRC0065J'
ON CONFLICT(food_id,key) DO UPDATE SET
  kind=excluded.kind,name=excluded.name,plural=excluded.plural,quantity=excluded.quantity,
  grams=excluded.grams,source=excluded.source,reference=excluded.reference,is_default=excluded.is_default;

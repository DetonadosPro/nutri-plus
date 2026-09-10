UPDATE foods
SET active = false, updated_at = CURRENT_TIMESTAMP
WHERE source = 'TBCA' AND source_code = 'BRC0001A';

UPDATE foods
SET display_name = 'Arroz Branco',
    normalized_display_name = 'arroz branco',
    search_aliases = ARRAY(SELECT DISTINCT alias FROM unnest(search_aliases || ARRAY['Arroz Branco']) alias),
    normalized_search_aliases = ARRAY(SELECT DISTINCT alias FROM unnest(normalized_search_aliases || ARRAY['arroz branco']) alias),
    normalized_search_text = 'arroz branco ' || normalized_search_text,
    updated_at = CURRENT_TIMESTAMP
WHERE source = 'TBCA' AND source_code = 'BRC0018A';

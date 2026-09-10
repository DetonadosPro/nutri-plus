-- A selector must not contain two indistinguishable descriptions for one food.
CREATE UNIQUE INDEX food_measures_unique_label ON food_measures(food_id, lower(trim(name)));

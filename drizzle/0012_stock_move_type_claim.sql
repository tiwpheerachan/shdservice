-- 0012_stock_move_type_claim — stock_move_type 6 "จ่ายออกตามงานเบิกอะไหล่เคลม": parts issued by hand, no job and no sale
-- order, like 5 จ่ายออกอื่นๆ (the same movement_action, -1). The legacy dump has no such row, so a reload (db-wipe +
-- every migration again) gets it back here. Idempotent: added only while no row has id 6.
INSERT INTO stock_move_type (stock_move_type_id, stock_move_type_name, movement_action_type, movement_action, effect_material, effect_package, effect_product, remark, is_active)
SELECT 6, 'จ่ายออกตามงานเบิกอะไหล่เคลม', 'จ่ายออก', -1, true, true, true, '', true
WHERE NOT EXISTS (SELECT 1 FROM stock_move_type WHERE stock_move_type_id = 6);

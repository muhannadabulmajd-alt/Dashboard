DO $$
DECLARE
  target_entry_id TEXT;
  target_line_id TEXT;
  target_branch_id TEXT;
  old_line JSONB;
  old_asset JSONB;
  inventory_id TEXT := 'inv_repair_doc000163_holder';
BEGIN
  SELECT id, "branchId" INTO target_entry_id, target_branch_id
  FROM "FinanceEntry"
  WHERE "importKey" = 'PUR:HISTORICAL_SPEND:DOC000163';

  IF target_entry_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id, to_jsonb(line) INTO target_line_id, old_line
  FROM "LedgerEntryLine" line
  WHERE line."financeEntryId" = target_entry_id AND line."lineNo" = 1;

  SELECT to_jsonb(asset) INTO old_asset
  FROM "FixedAsset" asset
  WHERE asset."financeEntryId" = target_entry_id
  LIMIT 1;

  INSERT INTO "InventoryItem" (
    id, category, "nameEn", "nameAr", unit, "unitCost", "branchId", "isActive", "createdAt"
  ) VALUES (
    inventory_id, 'PACKAGING'::"InventoryCategory", 'Paper cup holder', 'هولدر كوب ورقي',
    'piece', 840.000, target_branch_id, true, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    category = EXCLUDED.category,
    "nameEn" = EXCLUDED."nameEn",
    "nameAr" = EXCLUDED."nameAr",
    unit = EXCLUDED.unit,
    "unitCost" = EXCLUDED."unitCost",
    "branchId" = EXCLUDED."branchId",
    "isActive" = true;

  DELETE FROM "FixedAsset" WHERE "financeEntryId" = target_entry_id;
  DELETE FROM "InventoryCostLayer" WHERE "financeEntryId" = target_entry_id;
  DELETE FROM "StockMovement" WHERE "financeEntryId" = target_entry_id;

  UPDATE "LedgerEntryLine"
  SET "itemType" = 'INVENTORY',
      "itemName" = 'هولدر كوب ورقي',
      "assetKey" = NULL,
      "assetCategory" = NULL,
      "categoryType" = 'PACKAGING'::"ExpenseCategoryType",
      "inventoryItemId" = inventory_id,
      unit = 'piece',
      quantity = 1000.000,
      "unitCost" = 840.000,
      "landedUnitCost" = 840.000,
      notes = CONCAT_WS(' ', notes, 'Corrected from 1 fixed asset to 1,000 inventory units.')
  WHERE id = target_line_id;

  UPDATE "FinanceEntry"
  SET "recordClass" = 'PURCHASE'::"LedgerRecordClass",
      "categoryType" = 'PACKAGING'::"ExpenseCategoryType"
  WHERE id = target_entry_id;

  INSERT INTO "InventoryCostLayer" (
    id, "inventoryItemId", "financeEntryId", "qtyReceived", "unitCost", "receivedAt", "createdAt"
  )
  SELECT 'layer_repair_doc000163_holder', inventory_id, target_entry_id, 1000.000, 840.000, date, NOW()
  FROM "FinanceEntry" WHERE id = target_entry_id;

  INSERT INTO "StockMovement" (
    id, "inventoryItemId", "financeEntryId", "occurredAt", reason, quantity,
    reference, "externalId", "branchId", "createdAt"
  )
  SELECT 'move_repair_doc000163_holder', inventory_id, target_entry_id, date,
    'PURCHASE'::"MovementReason", 1000.000, reference,
    'PUR:HISTORICAL_SPEND:DOC000163:1', "branchId", NOW()
  FROM "FinanceEntry" WHERE id = target_entry_id;

  INSERT INTO "AuditLog" (id, action, entity, "entityId", metadata, "createdAt")
  VALUES (
    'audit_repair_doc000163_holder', 'DATA_REPAIR', 'FinanceEntry', target_entry_id,
    jsonb_build_object(
      'migration', '20260619190000_repair_doc000163_inventory',
      'reason', 'Corrected paper cup holders from one fixed asset to 1,000 inventory pieces',
      'beforeLine', old_line,
      'beforeAsset', old_asset,
      'after', jsonb_build_object(
        'itemType', 'INVENTORY', 'inventoryItemId', inventory_id,
        'quantity', '1000.000', 'unit', 'piece', 'unitCost', '840.000'
      )
    ),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
END $$;

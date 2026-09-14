import 'server-only';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
import { prisma } from '@/server/db/client';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import { resolveOrCreatePartyInTransaction } from '@/server/commands/parties';
import { syncInventoryReceiptFinance } from '@/server/finance/sync';
import type {
  CommandCommitHook,
  CommandPreconditionHook,
} from '@/server/records/shared';
import { requireInventoryV2Enabled } from './config';
import { inventoryCommandError } from './errors';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
  lockInventoryCommandKey,
} from './idempotency';
import {
  assertLocationItemPolicy,
  auditStockCommand,
  bumpLocationVersion,
  lockLocation,
} from './internal';
import { generateStockDocumentNumber, stockLotNumber } from './numbering';
import { ReceiveStockCommandSchema, type ReceiveStockCommandInput } from './schemas';

export type ReceiveStockResult = {
  stockDocumentId: string;
  documentNumber: string;
  inventoryItemId: string;
  locationId: string;
  movementId: string;
  costLayerId: string;
  financeEntryId: string | null;
  partyId: string;
  partyName: string;
  stockVersion: number;
  replayed: boolean;
};

export async function receivePurchasedStock(
  actor: CurrentUser,
  input: ReceiveStockCommandInput,
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<ReceiveStockResult>;
  } = {},
): Promise<ReceiveStockResult> {
  requireInventoryV2Enabled();
  try {
    const command = ReceiveStockCommandSchema.parse(input);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new Error('purchase_receipt_forbidden');
    const inputHash = inventoryCommandInputHash('RECEIVE_PURCHASED_STOCK', actor.id, command);

    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.stockDocument.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: { movements: true, costLayers: true, party: { select: { id: true, name: true } } },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        if (replay.type !== 'PURCHASE_RECEIPT') throw new Error('idempotency_conflict');
        const movement = replay.movements[0];
        const layer = replay.costLayers[0];
        if (!movement || !layer || !replay.party) throw new Error('idempotency_result_incomplete');
        if (
          replay.destinationLocationId !== command.locationId
          || movement.inventoryItemId !== command.inventoryItemId
          || decimalNumber(movement.quantity) !== command.quantity
          || decimalNumber(layer.unitCost) !== command.unitCost
          || (command.partyId && replay.partyId !== command.partyId)
          || (command.newSupplier && replay.party.name !== command.newSupplier.name)
        ) {
          throw new Error('idempotency_conflict');
        }
        const result = {
          stockDocumentId: replay.id,
          documentNumber: replay.documentNumber,
          inventoryItemId: movement.inventoryItemId,
          locationId: command.locationId,
          movementId: movement.id,
          costLayerId: layer.id,
          financeEntryId: movement.financeEntryId,
          partyId: replay.party.id,
          partyName: replay.party.name,
          stockVersion: (await tx.stockLocation.findUniqueOrThrow({ where: { id: command.locationId } })).stockVersion,
          replayed: true,
        };
        await options.onCommitted?.(tx, result);
        return result;
      }

      const location = await lockLocation(
        tx,
        actor,
        command.locationId,
        'receive',
        command.expectedLocationVersion,
      );
      const { item } = await assertLocationItemPolicy(
        tx,
        command.inventoryItemId,
        command.locationId,
      );
      const supplier = command.partyId
        ? await tx.party.findUnique({
            where: { id: command.partyId },
            select: { id: true, name: true, type: true, isActive: true },
          })
        : await resolveOrCreatePartyInTransaction(
            tx,
            {
              ...command.newSupplier!,
              type: 'SUPPLIER',
              openingPayable: 0,
              openingReceivable: 0,
              netFeesFromRemittance: false,
              collectsOrderPayments: false,
            },
            { actorId: actor.id, source: 'inventory-v2-receipt' },
          );
      if (!supplier || ('isActive' in supplier && !supplier.isActive)) throw new Error('supplier_inactive');
      if ('type' in supplier && !['SUPPLIER', 'OTHER'].includes(supplier.type)) throw new Error('supplier_invalid');
      if (command.paymentMode === 'PAID') {
        const account = await tx.financeAccount.findUnique({
          where: { id: command.accountId! },
          select: {
            isActive: true,
            currency: true,
            type: true,
            branchId: true,
            stockLocationId: true,
          },
        });
        if (
          !account?.isActive
          || account.currency !== 'IQD'
          || account.type === 'PAYMENT_GATEWAY'
          || (account.stockLocationId && account.stockLocationId !== command.locationId)
          || (!account.stockLocationId && account.branchId && account.branchId !== location.branchId)
        ) {
          throw new Error('payment_account_invalid');
        }
      }
      const documentNumber = await generateStockDocumentNumber(tx, 'PURCHASE_RECEIPT', command.occurredAt);
      const document = await tx.stockDocument.create({
        data: {
          documentNumber,
          type: 'PURCHASE_RECEIPT',
          status: 'RECEIVED',
          destinationLocationId: command.locationId,
          occurredAt: command.occurredAt,
          confirmedAt: command.occurredAt,
          notes: command.notes,
          reason: command.reference,
          idempotencyKey: command.idempotencyKey,
          inputHash,
          partyId: supplier.id,
          createdById: actor.id,
          confirmedById: actor.id,
        },
      });
      const layer = await tx.inventoryCostLayer.create({
        data: {
          inventoryItemId: command.inventoryItemId,
          stockDocumentId: document.id,
          lotNumber: stockLotNumber(documentNumber),
          supplierLot: command.supplierLot,
          bestBefore: command.bestBefore,
          qtyReceived: command.quantity.toFixed(3),
          unitCost: command.unitCost.toFixed(3),
          receivedAt: command.occurredAt,
        },
      });
      const movement = await tx.stockMovement.create({
        data: {
          inventoryItemId: command.inventoryItemId,
          occurredAt: command.occurredAt,
          reason: 'PURCHASE',
          quantity: command.quantity.toFixed(3),
          reference: command.reference ?? documentNumber,
          expiryDate: command.bestBefore,
          branchId: location.branchId,
          locationId: command.locationId,
          stockDocumentId: document.id,
          costLayerId: layer.id,
          externalId: `inventory-v2:${command.idempotencyKey}:movement`,
        },
      });
      const financeEntryId = await syncInventoryReceiptFinance(tx, {
        movementId: movement.id,
        inventoryItemId: command.inventoryItemId,
        quantity: command.quantity,
        unitCost: command.unitCost,
        receivedAt: command.occurredAt,
        paymentMode: command.paymentMode,
        accountId: command.accountId,
        partyId: supplier.id,
        dueDate: command.dueDate,
        reference: command.reference ?? documentNumber,
        createdById: actor.id,
        stockLocationId: command.locationId,
      });
      if (command.unitCost > 0 && !financeEntryId) throw new Error('inventory_finance_sync_failed');
      if (financeEntryId) {
        await tx.inventoryCostLayer.update({ where: { id: layer.id }, data: { financeEntryId } });
        await tx.stockMovement.update({ where: { id: movement.id }, data: { financeEntryId } });
      }
      const stockVersion = await bumpLocationVersion(tx, command.locationId);
      await auditStockCommand(tx, actor, 'RECEIVE_PURCHASED_STOCK', 'StockDocument', document.id, {
        documentNumber,
        inventoryItemId: item.id,
        locationId: command.locationId,
        quantity: command.quantity.toFixed(3),
        unitCost: command.unitCost.toFixed(3),
        financeEntryId,
        partyId: supplier.id,
      });
      const result = {
        stockDocumentId: document.id,
        documentNumber,
        inventoryItemId: item.id,
        locationId: command.locationId,
        movementId: movement.id,
        costLayerId: layer.id,
        financeEntryId,
        partyId: supplier.id,
        partyName: supplier.name,
        stockVersion,
        replayed: false,
      };
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'receive_stock');
  }
}

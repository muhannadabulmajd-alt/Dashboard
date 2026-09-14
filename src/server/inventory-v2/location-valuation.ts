type ValuedMovement = {
  quantity: number;
  unitCost: number | null;
};

export function deriveLocationUnitCost(
  movements: ValuedMovement[],
  fallbackUnitCost: number | null,
): number | null {
  const quantity = movements.reduce((sum, movement) => sum + movement.quantity, 0);
  if (quantity <= 0) return fallbackUnitCost;

  let value = 0;
  for (const movement of movements) {
    const unitCost = movement.unitCost ?? fallbackUnitCost;
    if (unitCost === null || !Number.isFinite(unitCost)) return null;
    value += movement.quantity * unitCost;
  }
  const result = value / quantity;
  return Number.isFinite(result) && result >= 0 ? result : fallbackUnitCost;
}

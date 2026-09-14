import 'server-only';

export type InventoryV2Config = {
  enabled: boolean;
};

type InventoryV2Env = Readonly<{
  [key: string]: string | undefined;
  INVENTORY_V2_ENABLED?: string;
}>;

export function getInventoryV2Config(
  env: InventoryV2Env = process.env,
): InventoryV2Config {
  return { enabled: env.INVENTORY_V2_ENABLED === 'true' };
}

export function requireInventoryV2Enabled(
  env: InventoryV2Env = process.env,
): void {
  if (!getInventoryV2Config(env).enabled) throw new Error('inventory_v2_disabled');
}

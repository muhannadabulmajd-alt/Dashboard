import { marginStatus } from './margin';

/**
 * Centralized alerts engine (§9/§17): fold the operational signals scattered
 * across pages (low stock, expiry, thin margins) into one ranked feed so the
 * dashboard can show a single notifications surface. Pure + locale-free — the
 * UI maps each kind to an icon and a localized message from `name`/`value`.
 */
export type AlertSeverity = 'critical' | 'warning';
export type AlertKind = 'stockout' | 'reorder' | 'expiry' | 'belowCost' | 'lowMargin';

export interface AlertItem {
  kind: AlertKind;
  severity: AlertSeverity;
  refId: string;
  name: { en: string; ar: string };
  /** Context for the message: stock qty, days-to-expiry, or margin ratio (0..1). */
  value: number;
  unit?: string;
}

export interface StockAlertInput {
  id: string;
  nameEn: string;
  nameAr: string;
  unit: string;
  current: number;
  reorderPoint: number | null;
}
export interface ExpiryAlertInput {
  id: string;
  nameEn: string;
  nameAr: string;
  daysToExpiry: number;
}
export interface MarginAlertInput {
  id: string;
  nameEn: string;
  nameAr: string;
  sellingPrice: number;
  cogsPerUnit: number;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1 };
const KIND_ORDER: Record<AlertKind, number> = { stockout: 0, belowCost: 1, expiry: 2, reorder: 3, lowMargin: 4 };

/**
 * Build the ranked alert feed from already-gathered inputs. Stockouts and
 * below-cost products are critical; reorder, near-expiry and low-margin are
 * warnings. Expired lots (daysToExpiry ≤ 0) escalate to critical. Sorted by
 * severity then kind so the most urgent surfaces first.
 */
export function buildAlerts(
  input: { stock: StockAlertInput[]; expiring: ExpiryAlertInput[]; products: MarginAlertInput[] },
  opts: { lowMarginThreshold?: number } = {},
): AlertItem[] {
  const out: AlertItem[] = [];
  for (const s of input.stock) {
    if (s.current <= 0) {
      out.push({ kind: 'stockout', severity: 'critical', refId: s.id, name: { en: s.nameEn, ar: s.nameAr }, value: s.current, unit: s.unit });
    } else if (s.reorderPoint != null && s.current <= s.reorderPoint) {
      out.push({ kind: 'reorder', severity: 'warning', refId: s.id, name: { en: s.nameEn, ar: s.nameAr }, value: s.current, unit: s.unit });
    }
  }
  for (const e of input.expiring) {
    out.push({
      kind: 'expiry',
      severity: e.daysToExpiry <= 0 ? 'critical' : 'warning',
      refId: e.id,
      name: { en: e.nameEn, ar: e.nameAr },
      value: e.daysToExpiry,
    });
  }
  for (const p of input.products) {
    const st = marginStatus(p.sellingPrice, p.cogsPerUnit, opts.lowMarginThreshold);
    if (st === 'ok') continue;
    const ratio = p.sellingPrice > 0 ? (p.sellingPrice - p.cogsPerUnit) / p.sellingPrice : 0;
    out.push({
      kind: st === 'belowCost' ? 'belowCost' : 'lowMargin',
      severity: st === 'belowCost' ? 'critical' : 'warning',
      refId: p.id,
      name: { en: p.nameEn, ar: p.nameAr },
      value: ratio,
    });
  }
  return out.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}

export function alertCounts(alerts: AlertItem[]): { total: number; critical: number; warning: number } {
  let critical = 0;
  for (const a of alerts) if (a.severity === 'critical') critical += 1;
  return { total: alerts.length, critical, warning: alerts.length - critical };
}

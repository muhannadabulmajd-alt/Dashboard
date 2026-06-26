import { describe, expect, it } from 'vitest';
import { can } from '@/lib/rbac';
import {
  DASHBOARD_TEMPLATES,
  DashboardConfigSchema,
  METRIC_CATALOG,
  WIDGET_TYPES,
  metricById,
} from '@/lib/dashboard-builder';

describe('dashboard builder config', () => {
  it('ships valid templates with matching widget layout ids', () => {
    expect(DASHBOARD_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    for (const template of DASHBOARD_TEMPLATES) {
      const parsed = DashboardConfigSchema.parse(template.config);
      const widgets = new Set(parsed.widgets.map((widget) => widget.id));
      expect(parsed.layout.every((item) => widgets.has(item.i))).toBe(true);
      expect(parsed.layout.every((item) => item.w >= 1 && item.w <= 12)).toBe(true);
    }
  });

  it('keeps metric defaults compatible with supported widget types', () => {
    for (const metric of METRIC_CATALOG) {
      expect(metric.supportedTypes).toContain(metric.defaultType);
      expect(metricById(metric.id)?.id).toBe(metric.id);
    }
  });

  it('includes all first-launch widget types', () => {
    expect(WIDGET_TYPES).toEqual([
      'kpi',
      'line',
      'bar',
      'stackedBar',
      'combo',
      'donut',
      'table',
      'text',
      'section',
    ]);
  });
});

describe('dashboard builder permissions', () => {
  it('lets owner/admin fully manage dashboards', () => {
    expect(can('OWNER', 'manage:dashboards')).toBe(true);
    expect(can('ADMIN', 'manage:dashboards')).toBe(true);
    expect(can('OWNER', 'export:dashboards')).toBe(true);
    expect(can('ADMIN', 'export:dashboards')).toBe(true);
  });

  it('lets operational roles create dashboards but keeps viewer roles read-only', () => {
    expect(can('FINANCE', 'manage:dashboards')).toBe(true);
    expect(can('SALES_CRM', 'manage:dashboards')).toBe(true);
    expect(can('BRANCH_MANAGER', 'manage:dashboards')).toBe(true);
    expect(can('ROASTERY_OPS', 'manage:dashboards')).toBe(true);
    expect(can('VIEWER', 'view:dashboard-builder')).toBe(true);
    expect(can('VIEWER', 'manage:dashboards')).toBe(false);
    expect(can('FRANCHISEE_VIEWER', 'manage:dashboards')).toBe(false);
  });
});

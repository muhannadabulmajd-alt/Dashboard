import { describe, expect, it } from 'vitest';
import { can } from '@/lib/rbac';
import {
  DATA_SOURCES,
  DASHBOARD_TEMPLATES,
  DashboardConfigSchema,
  METRIC_CATALOG,
  WIDGET_TYPES,
  metricById,
} from '@/lib/dashboard-builder';
import { NAV_ITEMS } from '@/lib/rbac';

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

  it('supports visual-studio widget settings without a schema migration', () => {
    const parsed = DashboardConfigSchema.parse({
      version: 1,
      grid: { cols: 12, rowHeight: 96, gap: 16 },
      globalFilters: { range: 'this_month' },
      widgets: [{
        id: 'w-1',
        type: 'bar',
        title: 'Sales by channel',
        source: 'sales',
        metric: 'sales.byChannel',
        dimension: 'Channel',
        filters: { range: '7d' },
        style: { tone: 'accent', showLegend: true, showValues: true },
        locked: true,
        refreshNonce: 123,
        hideFromPdf: false,
      }],
      layout: [{ i: 'w-1', x: 0, y: 0, w: 6, h: 4 }],
    });
    expect(parsed.widgets[0].locked).toBe(true);
    expect(parsed.widgets[0].dimension).toBe('Channel');
    expect(parsed.widgets[0].style?.showValues).toBe(true);
  });

  it('keeps the studio source and dimension metadata available for guided setup', () => {
    expect(DATA_SOURCES).toEqual(['sales', 'finance', 'inventory', 'customers', 'fulfillment', 'roastery']);
    expect(metricById('sales.byChannel')?.dimensionEn).toBe('Channel');
    expect(metricById('finance.spendByCategory')?.dimensionEn).toBe('Category');
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

describe('dashboard builder navigation', () => {
  it('replaces the visible management reports entry', () => {
    expect(NAV_ITEMS.some((item) => item.href === '/dashboard-builder')).toBe(true);
    expect(NAV_ITEMS.some((item) => item.href === '/finance/reports')).toBe(false);
  });
});

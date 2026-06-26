'use client';

import useSWR from 'swr';
import { BarChartCard, DonutChartCard, LineChartCard } from '@/components/charts/Charts';
import { DataTable } from '@/components/data-table/DataTable';
import { KpiCard } from '@/components/kpi/KpiCard';
import { Card, CardContent } from '@/components/ui/primitives';
import type { DashboardConfig, DashboardWidget, WidgetData } from '@/lib/dashboard-builder';
import { formatMoney, formatNumber, formatPercent, type AppLocale } from '@/lib/money';

async function fetchWidgetData([url, widget, filters, locale]: [string, DashboardWidget, DashboardConfig['globalFilters'], AppLocale]) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widget, filters, locale }),
  });
  if (!response.ok) throw new Error('Failed to load widget');
  return response.json() as Promise<WidgetData>;
}

function formatValue(data: Extract<WidgetData, { kind: 'kpi' }>, locale: AppLocale): string {
  if (data.valueKind === 'iqd') return formatMoney(data.value, 'IQD', locale);
  if (data.valueKind === 'percent') return formatPercent(data.value, locale);
  if (data.valueKind === 'grams') return `${formatNumber(data.value / 1000, locale, 3)} kg`;
  if (data.valueKind === 'days') return `${formatNumber(data.value, locale, 1)} d`;
  return formatNumber(data.value, locale, 1);
}

function TableWidget({ data }: { data: Extract<WidgetData, { kind: 'table' }> }) {
  return (
    <DataTable
      columns={data.columns.map((label) => ({ label }))}
      rows={data.rows}
      emptyLabel="No data found for the selected filters."
    />
  );
}

export function WidgetPreview({
  widget,
  filters,
  locale,
}: {
  widget: DashboardWidget;
  filters: DashboardConfig['globalFilters'];
  locale: AppLocale;
}) {
  const { data, error, isLoading } = useSWR(['/api/dashboard-builder/widget-data', widget, filters, locale], fetchWidgetData, {
    keepPreviousData: true,
  });

  if (widget.type === 'text' || widget.type === 'section') {
    return (
      <Card variant={widget.type === 'section' ? 'accent' : 'surface'} className="h-full">
        <CardContent className="pt-4">
          <p className={widget.type === 'section' ? 'text-lg font-bold text-roast' : 'text-sm leading-6 text-muted-foreground'}>
            {widget.text || widget.description || widget.title}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <Card className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">Loading widget...</Card>;
  }
  if (error || !data) {
    return <Card variant="danger" className="flex h-full items-center justify-center p-4 text-sm text-danger">Widget could not load.</Card>;
  }
  if (data.kind === 'empty') {
    return <Card variant="surface" className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">{data.message}</Card>;
  }
  if (data.kind === 'kpi') {
    return <KpiCard label={widget.title} value={formatValue(data, locale)} sub={data.subtitle} locale={locale} tone={widget.style?.tone ?? 'default'} />;
  }
  if (data.kind === 'series') {
    if (widget.type === 'donut') return <DonutChartCard title={widget.title} data={data.points} locale={locale} valueKind={data.valueKind === 'iqd' ? 'iqd' : data.valueKind === 'percent' ? 'percent' : 'count'} />;
    if (widget.type === 'line' || widget.type === 'combo') return <LineChartCard title={widget.title} data={data.points} locale={locale} valueKind={data.valueKind === 'iqd' ? 'iqd' : data.valueKind === 'percent' ? 'percent' : 'count'} />;
    return <BarChartCard title={widget.title} data={data.points} locale={locale} valueKind={data.valueKind === 'iqd' ? 'iqd' : data.valueKind === 'percent' ? 'percent' : 'count'} horizontal={data.points.length > 5} />;
  }
  if (data.kind === 'table') return <TableWidget data={data} />;
  return <Card className="h-full p-4 text-sm text-muted-foreground">{data.body}</Card>;
}

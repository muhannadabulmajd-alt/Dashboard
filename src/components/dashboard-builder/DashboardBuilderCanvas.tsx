'use client';

import { useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import GridLayout, { WidthProvider, type Layout, type LayoutItem } from 'react-grid-layout/legacy';
import { Download, Eye, EyeOff, Grip, Plus, Save, Trash2, Copy, Settings } from 'lucide-react';
import { METRIC_CATALOG, WIDGET_TYPES, metricById, type DashboardConfig, type DashboardWidget, type DashboardWidgetType } from '@/lib/dashboard-builder';
import type { DashboardFilters } from '@/lib/filters';
import type { AppLocale } from '@/lib/money';
import { cn } from '@/lib/utils';
import { WidgetPreview } from './WidgetPreview';

const ResponsiveGrid = WidthProvider(GridLayout);

function nextPosition(config: DashboardConfig, id: string, type: DashboardWidgetType): LayoutItem {
  const y = config.layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const size =
    type === 'kpi' ? { w: 3, h: 2 } :
    type === 'table' ? { w: 12, h: 4 } :
    type === 'section' || type === 'text' ? { w: 12, h: 1 } :
    { w: 6, h: 4 };
  return { i: id, x: 0, y, ...size };
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w-${Date.now()}`;
}

function cloneConfig(config: DashboardConfig): DashboardConfig {
  return JSON.parse(JSON.stringify(config)) as DashboardConfig;
}

function createWidget(metricId: string, type?: DashboardWidgetType): DashboardWidget {
  const metric = metricById(metricId);
  const widgetType = type ?? metric?.defaultType ?? 'kpi';
  return {
    id: makeId(),
    type: widgetType,
    title: metric?.labelEn ?? 'Widget',
    source: metric?.source,
    metric: metricId,
    hideFromPdf: false,
    style: { tone: 'default', showLegend: true },
  };
}

function toolbarButtonClass() {
  return 'inline-flex size-8 items-center justify-center rounded-md border border-border/80 bg-card text-muted-foreground hover:bg-linen/40 hover:text-roast';
}

export function DashboardBuilderCanvas({
  dashboardId,
  initialConfig,
  runtimeFilters,
  locale,
  canEdit,
  canExport,
  saveConfig,
}: {
  dashboardId: string;
  initialConfig: DashboardConfig;
  runtimeFilters: DashboardFilters;
  locale: AppLocale;
  canEdit: boolean;
  canExport: boolean;
  saveConfig: (id: string, configJson: string, commit: boolean) => Promise<{ ok: true } | { error: string }>;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [selectedId, setSelectedId] = useState<string | null>(initialConfig.widgets[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const searchParams = useSearchParams();
  const selected = config.widgets.find((widget) => widget.id === selectedId) ?? null;
  const activeFilters = runtimeFilters as DashboardConfig['globalFilters'];
  const pdfQuery = searchParams.toString();
  const pdfHref = `/api/dashboard-builder/${dashboardId}/pdf?locale=${locale}${pdfQuery ? `&${pdfQuery}` : ''}`;
  const layout = useMemo<Layout>(() => config.layout.map((item) => ({ ...item })), [config.layout]);

  const persist = (next: DashboardConfig, commit: boolean) => {
    setConfig(next);
    setMessage(commit ? 'Saving...' : 'Draft saved');
    startTransition(async () => {
      const result = await saveConfig(dashboardId, JSON.stringify(next), commit);
      setMessage('error' in result ? 'Could not save dashboard.' : commit ? 'Dashboard saved.' : 'Draft saved.');
    });
  };

  const updateLocal = (next: DashboardConfig) => {
    setConfig(next);
    startTransition(async () => {
      await saveConfig(dashboardId, JSON.stringify(next), false);
    });
  };

  const addWidget = (metricId: string) => {
    const widget = createWidget(metricId);
    const next = cloneConfig(config);
    next.widgets.push(widget);
    next.layout.push(nextPosition(next, widget.id, widget.type));
    setSelectedId(widget.id);
    updateLocal(next);
  };

  const addTextWidget = (type: 'text' | 'section') => {
    const widget: DashboardWidget = {
      id: makeId(),
      type,
      title: type === 'section' ? 'Section header' : 'Note',
      text: type === 'section' ? 'Section header' : 'Add your note here.',
      hideFromPdf: false,
    };
    const next = cloneConfig(config);
    next.widgets.push(widget);
    next.layout.push(nextPosition(next, widget.id, type));
    setSelectedId(widget.id);
    updateLocal(next);
  };

  const updateWidget = (patch: Partial<DashboardWidget>) => {
    if (!selected) return;
    const next = cloneConfig(config);
    next.widgets = next.widgets.map((widget) => widget.id === selected.id ? { ...widget, ...patch } : widget);
    updateLocal(next);
  };

  const removeWidget = (id: string) => {
    const next = cloneConfig(config);
    next.widgets = next.widgets.filter((widget) => widget.id !== id);
    next.layout = next.layout.filter((item) => item.i !== id);
    setSelectedId(next.widgets[0]?.id ?? null);
    updateLocal(next);
  };

  const duplicateWidget = (id: string) => {
    const source = config.widgets.find((widget) => widget.id === id);
    if (!source) return;
    const widget = { ...source, id: makeId(), title: `${source.title} copy` };
    const next = cloneConfig(config);
    next.widgets.push(widget);
    next.layout.push(nextPosition(next, widget.id, widget.type));
    setSelectedId(widget.id);
    updateLocal(next);
  };

  const handleLayoutChange = (items: Layout) => {
    const next = cloneConfig(config);
    next.layout = items.map((item) => ({ i: item.i, x: item.x, y: item.y, w: item.w, h: item.h }));
    updateLocal(next);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 rounded-[var(--radius)] border bg-linen/20 p-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="text-xs font-medium text-muted-foreground">
            12-column canvas · drag cards, resize from the corner, then save.
          </div>
          <div className="flex items-center gap-2">
            {message ? <span className="text-xs text-muted-foreground">{pending ? 'Working...' : message}</span> : null}
            {canExport ? (
              <a href={pdfHref} className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs font-semibold hover:bg-linen/40">
                <Download className="size-3.5" />
                PDF
              </a>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={() => persist(config, true)}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-amber/90"
              >
                <Save className="size-3.5" />
                Save
              </button>
            ) : null}
          </div>
        </div>

        {config.widgets.length ? (
          <ResponsiveGrid
            className="dashboard-builder-grid"
            layout={layout}
            cols={12}
            rowHeight={config.grid.rowHeight}
            margin={[config.grid.gap, config.grid.gap]}
            containerPadding={[0, 0]}
            isDraggable={canEdit}
            isResizable={canEdit}
            compactType="vertical"
            preventCollision={false}
            draggableHandle=".dashboard-widget-handle"
            onLayoutChange={handleLayoutChange}
          >
            {config.widgets.map((widget) => (
              <div
                key={widget.id}
                className={cn(
                  'group overflow-hidden rounded-[var(--radius)] bg-transparent',
                  selectedId === widget.id && 'ring-2 ring-primary/45',
                )}
                onClick={() => setSelectedId(widget.id)}
              >
                <div className="mb-1 flex items-center justify-between gap-2 rounded-lg border bg-card/95 p-1 shadow-sm">
                  <button type="button" className="dashboard-widget-handle inline-flex cursor-move items-center gap-1 px-2 text-xs font-semibold text-muted-foreground">
                    <Grip className="size-3.5" />
                    {widget.title}
                  </button>
                  {canEdit ? (
                    <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                      <button type="button" className={toolbarButtonClass()} onClick={(event) => { event.stopPropagation(); updateWidget({ hideFromPdf: !widget.hideFromPdf }); }}>
                        {widget.hideFromPdf ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                      <button type="button" className={toolbarButtonClass()} onClick={(event) => { event.stopPropagation(); duplicateWidget(widget.id); }}>
                        <Copy className="size-3.5" />
                      </button>
                      <button type="button" className={toolbarButtonClass()} onClick={(event) => { event.stopPropagation(); removeWidget(widget.id); }}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="h-[calc(100%-2.5rem)]">
                  <WidgetPreview widget={widget} filters={activeFilters} locale={locale} />
                </div>
              </div>
            ))}
          </ResponsiveGrid>
        ) : (
          <div className="flex min-h-96 flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed bg-card/60 p-8 text-center">
            <p className="text-lg font-semibold text-roast">Start building your dashboard.</p>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">Add a KPI, chart, table, note, or section header from the panel.</p>
          </div>
        )}
      </section>

      <aside className="space-y-3">
        {canEdit ? (
          <div className="rounded-[var(--radius)] border bg-card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-roast">
              <Plus className="size-4" />
              Add widget
            </div>
            <label className="text-xs font-medium text-muted-foreground">
              Metric
              <select
                className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary"
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  addWidget(event.target.value);
                  event.target.value = '';
                }}
              >
                <option value="">Choose a metric...</option>
                {METRIC_CATALOG.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {locale === 'ar' ? metric.labelAr : metric.labelEn}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => addTextWidget('section')} className="rounded-lg border px-2 py-2 text-xs font-semibold hover:bg-linen/40">Section</button>
              <button type="button" onClick={() => addTextWidget('text')} className="rounded-lg border px-2 py-2 text-xs font-semibold hover:bg-linen/40">Note</button>
            </div>
          </div>
        ) : null}

        <div className="rounded-[var(--radius)] border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-roast">
            <Settings className="size-4" />
            Widget settings
          </div>
          {selected ? (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Title
                <input disabled={!canEdit} value={selected.title} onChange={(event) => updateWidget({ title: event.target.value })} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Type
                <select disabled={!canEdit} value={selected.type} onChange={(event) => updateWidget({ type: event.target.value as DashboardWidgetType })} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
                  {WIDGET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              {(selected.type === 'text' || selected.type === 'section') ? (
                <label className="block text-xs font-medium text-muted-foreground">
                  Text
                  <textarea disabled={!canEdit} value={selected.text ?? ''} onChange={(event) => updateWidget({ text: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <input disabled={!canEdit} type="checkbox" checked={selected.hideFromPdf} onChange={(event) => updateWidget({ hideFromPdf: event.target.checked })} />
                Hide from PDF
              </label>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a widget to edit it.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

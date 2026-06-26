'use client';

import { useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import GridLayout, { WidthProvider, type Layout, type LayoutItem } from 'react-grid-layout/legacy';
import { Copy, Download, Eye, EyeOff, Grip, Lock, Maximize2, Minimize2, Plus, RefreshCcw, RotateCcw, Save, Settings, Trash2, Unlock } from 'lucide-react';
import { DATA_SOURCES, METRIC_CATALOG, WIDGET_TYPES, metricById, type DashboardConfig, type DashboardDataSource, type DashboardWidget, type DashboardWidgetType } from '@/lib/dashboard-builder';
import { RANGE_PRESETS } from '@/lib/filters';
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
    dimension: metric?.dimensionEn,
    hideFromPdf: false,
    style: { tone: 'default', showLegend: true, showValues: true },
  };
}

function toolbarButtonClass() {
  return 'inline-flex size-8 items-center justify-center rounded-md border border-border/80 bg-card text-muted-foreground hover:bg-linen/40 hover:text-roast';
}

const TYPE_LABELS: Record<DashboardWidgetType, string> = {
  kpi: 'Score card',
  line: 'Line chart',
  bar: 'Bar chart',
  stackedBar: 'Stacked bar',
  combo: 'Combo chart',
  donut: 'Donut chart',
  table: 'Table',
  text: 'Note',
  section: 'Section',
};

const SOURCE_LABELS: Record<DashboardDataSource, string> = {
  sales: 'Sales',
  finance: 'Finance',
  inventory: 'Inventory',
  customers: 'Customers',
  fulfillment: 'Delivery',
  roastery: 'Roastery',
};

const QUICK_SIZES = [
  { label: 'Small', w: 3, h: 2 },
  { label: 'Medium', w: 6, h: 4 },
  { label: 'Large', w: 8, h: 5 },
  { label: 'Full width', w: 12, h: 5 },
] as const;

const WIDTH_PRESETS = [
  { label: '25%', w: 3 },
  { label: '33%', w: 4 },
  { label: '50%', w: 6 },
  { label: '66%', w: 8 },
  { label: '75%', w: 9 },
  { label: '100%', w: 12 },
] as const;

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
  const [previewMode, setPreviewMode] = useState(false);
  const [draftType, setDraftType] = useState<DashboardWidgetType>('kpi');
  const [draftSource, setDraftSource] = useState<DashboardDataSource>('sales');
  const [draftMetric, setDraftMetric] = useState('');
  const searchParams = useSearchParams();
  const selected = config.widgets.find((widget) => widget.id === selectedId) ?? null;
  const activeFilters = { ...runtimeFilters, ...config.globalFilters } as DashboardConfig['globalFilters'];
  const pdfQuery = searchParams.toString();
  const pdfHref = `/api/dashboard-builder/${dashboardId}/pdf?locale=${locale}${pdfQuery ? `&${pdfQuery}` : ''}`;
  const layout = useMemo<Layout>(() => config.layout.map((item) => ({
    ...item,
    static: config.widgets.find((widget) => widget.id === item.i)?.locked,
  })), [config.layout, config.widgets]);
  const availableMetrics = METRIC_CATALOG.filter((metric) => metric.source === draftSource && metric.supportedTypes.includes(draftType));

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

  const addWidget = (metricId: string, type = draftType) => {
    const widget = createWidget(metricId, type);
    const metric = metricById(metricId);
    widget.title = locale === 'ar' ? (metric?.labelAr ?? widget.title) : (metric?.labelEn ?? widget.title);
    widget.dimension = locale === 'ar' ? metric?.dimensionAr : metric?.dimensionEn;
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

  const updateLayoutItem = (id: string, patch: Partial<LayoutItem>) => {
    const next = cloneConfig(config);
    next.layout = next.layout.map((item) => item.i === id ? { ...item, ...patch } : item);
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

  const updateGlobalRange = (range: string) => {
    const next = cloneConfig(config);
    next.globalFilters = { ...next.globalFilters, range };
    updateLocal(next);
  };

  const updateWidgetRange = (range: string) => {
    if (!selected) return;
    updateWidget({ filters: { ...(selected.filters ?? {}), range } });
  };

  return (
    <div className={cn('grid gap-4', previewMode ? 'xl:grid-cols-1' : 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
      <section className="min-w-0 rounded-[var(--radius)] border bg-linen/20 p-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>12-column canvas</span>
            <span className="hidden sm:inline">·</span>
            <span>{previewMode ? 'Preview mode' : 'Drag, resize, then save.'}</span>
            <label className="ms-2 inline-flex items-center gap-1.5">
              <span>Default range</span>
              <select
                disabled={!canEdit || previewMode}
                value={String(config.globalFilters.range ?? '')}
                onChange={(event) => updateGlobalRange(event.target.value)}
                className="rounded-md border bg-card px-2 py-1 text-xs font-semibold text-roast outline-none disabled:opacity-60"
              >
                <option value="">Top filters</option>
                {RANGE_PRESETS.map((range) => <option key={range} value={range}>{range}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            {message ? <span className="text-xs text-muted-foreground">{pending ? 'Working...' : message}</span> : null}
            <button
              type="button"
              onClick={() => setPreviewMode((value) => !value)}
              className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs font-semibold hover:bg-linen/40"
            >
              {previewMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              {previewMode ? 'Edit' : 'Preview'}
            </button>
            {canExport ? (
              <a href={pdfHref} className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs font-semibold hover:bg-linen/40">
                <Download className="size-3.5" />
                PDF
              </a>
            ) : null}
            {canEdit && !previewMode ? (
              <button
                type="button"
                onClick={() => {
                  setConfig(initialConfig);
                  setSelectedId(initialConfig.widgets[0]?.id ?? null);
                  setMessage('Restored last saved version.');
                }}
                className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs font-semibold hover:bg-linen/40"
              >
                <RotateCcw className="size-3.5" />
                Restore
              </button>
            ) : null}
            {canEdit && !previewMode ? (
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
            isDraggable={canEdit && !previewMode}
            isResizable={canEdit && !previewMode}
            compactType="vertical"
            preventCollision
            draggableHandle=".dashboard-widget-handle"
            onLayoutChange={handleLayoutChange}
          >
            {config.widgets.map((widget) => (
              <div
                key={widget.id}
                className={cn(
                  'group overflow-hidden rounded-[var(--radius)] bg-transparent',
                  !previewMode && selectedId === widget.id && 'ring-2 ring-primary/45 ring-offset-2 ring-offset-background',
                )}
                onClick={() => setSelectedId(widget.id)}
              >
                {!previewMode ? <div className="mb-1 flex items-center justify-between gap-2 rounded-lg border bg-card/95 p-1 shadow-sm">
                  <button type="button" className="dashboard-widget-handle inline-flex cursor-move items-center gap-1 px-2 text-xs font-semibold text-muted-foreground">
                    <Grip className="size-3.5" />
                    {widget.title}
                  </button>
                  {canEdit ? (
                    <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                      <button type="button" className={toolbarButtonClass()} onClick={(event) => { event.stopPropagation(); updateWidget({ locked: !widget.locked }); }}>
                        {widget.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                      </button>
                      <button type="button" className={toolbarButtonClass()} onClick={(event) => { event.stopPropagation(); updateWidget({ refreshNonce: Date.now() }); }}>
                        <RefreshCcw className="size-3.5" />
                      </button>
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
                </div> : null}
                <div className={previewMode ? 'h-full' : 'h-[calc(100%-2.5rem)]'}>
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

      {!previewMode ? <aside className="space-y-3">
        {canEdit ? (
          <div className="rounded-[var(--radius)] border bg-card p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-roast">
              <Plus className="size-4" />
              Add widget
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">1. Widget type</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {WIDGET_TYPES.filter((type) => type !== 'section' && type !== 'text').map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setDraftType(type);
                        const nextMetric = METRIC_CATALOG.find((metric) => metric.source === draftSource && metric.supportedTypes.includes(type));
                        setDraftMetric(nextMetric?.id ?? '');
                      }}
                      className={cn('rounded-lg border px-2 py-1.5 text-start text-xs font-semibold hover:bg-linen/40', draftType === type && 'border-primary bg-amber/10 text-primary')}
                    >
                      {TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                2. Data source
                <select
                  value={draftSource}
                  onChange={(event) => {
                    const source = event.target.value as DashboardDataSource;
                    setDraftSource(source);
                    const nextMetric = METRIC_CATALOG.find((metric) => metric.source === source && metric.supportedTypes.includes(draftType));
                    setDraftMetric(nextMetric?.id ?? '');
                  }}
                  className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm normal-case tracking-normal text-roast outline-none focus:border-primary"
                >
                  {DATA_SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source]}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                3. Metric
                <select
                  className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm normal-case tracking-normal text-roast outline-none focus:border-primary"
                  value={draftMetric}
                  onChange={(event) => setDraftMetric(event.target.value)}
                >
                  <option value="">Choose a metric...</option>
                  {availableMetrics.map((metric) => (
                    <option key={metric.id} value={metric.id}>
                      {locale === 'ar' ? metric.labelAr : metric.labelEn}
                    </option>
                  ))}
                </select>
              </label>
              {draftMetric ? (
                <div className="rounded-lg border bg-linen/20 p-2 text-xs leading-5 text-muted-foreground">
                  <strong className="text-roast">4. Dimension:</strong>{' '}
                  {locale === 'ar' ? (metricById(draftMetric)?.dimensionAr ?? 'غير مطلوب') : (metricById(draftMetric)?.dimensionEn ?? 'Not needed')}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!draftMetric}
                  onClick={() => addWidget(draftMetric)}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add widget
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = cloneConfig(config);
                    next.layout = next.widgets.map((widget, index) => ({ i: widget.id, x: (index % 4) * 3, y: Math.floor(index / 4) * 3, w: widget.type === 'kpi' ? 3 : 6, h: widget.type === 'kpi' ? 2 : 4 }));
                    updateLocal(next);
                  }}
                  className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-linen/40"
                >
                  Reset layout
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
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
                Description
                <input disabled={!canEdit} value={selected.description ?? ''} onChange={(event) => updateWidget({ description: event.target.value })} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Type
                <select disabled={!canEdit} value={selected.type} onChange={(event) => updateWidget({ type: event.target.value as DashboardWidgetType })} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
                  {WIDGET_TYPES
                    .filter((type) => !selected.metric || metricById(selected.metric)?.supportedTypes.includes(type) || type === 'text' || type === 'section')
                    .map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              {selected.metric ? (
                <div className="rounded-lg border bg-linen/20 p-2 text-xs leading-5 text-muted-foreground">
                  <div><strong className="text-roast">Data source:</strong> {SOURCE_LABELS[metricById(selected.metric)?.source ?? 'sales']}</div>
                  <div><strong className="text-roast">Metric:</strong> {locale === 'ar' ? metricById(selected.metric)?.labelAr : metricById(selected.metric)?.labelEn}</div>
                  <div><strong className="text-roast">Dimension:</strong> {selected.dimension ?? (locale === 'ar' ? 'غير مطلوب' : 'Not needed')}</div>
                </div>
              ) : null}
              <label className="block text-xs font-medium text-muted-foreground">
                Local date range
                <select disabled={!canEdit} value={String(selected.filters?.range ?? '')} onChange={(event) => updateWidgetRange(event.target.value)} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
                  <option value="">Use dashboard range</option>
                  {RANGE_PRESETS.map((range) => <option key={range} value={range}>{range}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Tone
                <select disabled={!canEdit} value={selected.style?.tone ?? 'default'} onChange={(event) => updateWidget({ style: { ...(selected.style ?? {}), tone: event.target.value as NonNullable<DashboardWidget['style']>['tone'] } })} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60">
                  {['default', 'accent', 'success', 'warning', 'danger'].map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                </select>
              </label>
              <div className="space-y-2 rounded-lg border bg-linen/20 p-2">
                <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Quick size</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_SIZES.map((size) => (
                    <button key={size.label} type="button" disabled={!canEdit} onClick={() => updateLayoutItem(selected.id, { w: size.w, h: size.h })} className="rounded-md border bg-card px-2 py-1.5 text-xs font-semibold hover:bg-linen/45 disabled:opacity-60">
                      {size.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {WIDTH_PRESETS.map((size) => (
                    <button key={size.label} type="button" disabled={!canEdit} onClick={() => updateLayoutItem(selected.id, { w: size.w })} className="rounded-md border bg-card px-2 py-1.5 text-xs font-semibold hover:bg-linen/45 disabled:opacity-60">
                      {size.label}
                    </button>
                  ))}
                </div>
              </div>
              {(selected.type === 'text' || selected.type === 'section') ? (
                <label className="block text-xs font-medium text-muted-foreground">
                  Text
                  <textarea disabled={!canEdit} value={selected.text ?? ''} onChange={(event) => updateWidget({ text: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border bg-background px-2 py-2 text-sm outline-none focus:border-primary disabled:opacity-60" />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <input disabled={!canEdit} type="checkbox" checked={Boolean(selected.locked)} onChange={(event) => updateWidget({ locked: event.target.checked })} />
                Lock position
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <input disabled={!canEdit} type="checkbox" checked={selected.hideFromPdf} onChange={(event) => updateWidget({ hideFromPdf: event.target.checked })} />
                Hide from PDF
              </label>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a widget to edit it.</p>
          )}
        </div>
      </aside> : null}
    </div>
  );
}

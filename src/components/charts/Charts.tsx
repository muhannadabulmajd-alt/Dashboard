'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { formatMoney, formatMoneyCompact, formatNumber, formatPercent, type AppLocale } from '@/lib/money';
import { CHART_COLORS, POSITIVE, NEGATIVE } from '@/lib/colors';

export type ValueKind = 'iqd' | 'count' | 'percent';

function fmt(v: number, kind: ValueKind, locale: AppLocale, compact = false): string {
  if (kind === 'iqd') return compact ? formatMoneyCompact(v, 'IQD', locale) : formatMoney(v, 'IQD', locale);
  if (kind === 'percent') return formatPercent(v, locale);
  return formatNumber(v, locale);
}

const axisProps = {
  tick: { fontSize: 11, fill: '#766b5f' },
  tickLine: false,
  axisLine: false,
} as const;

function hasDrilldown(data: Point[]): boolean {
  return data.some((point) => Boolean(point.href));
}

function ChartFrame({
  title,
  children,
  drilldown,
  locale,
}: {
  title: string;
  children: React.ReactNode;
  drilldown?: boolean;
  locale: AppLocale;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="items-start">
        <CardTitle>{title}</CardTitle>
        {drilldown ? (
          <span className="rounded-full border border-amber/25 bg-amber/10 px-2 py-0.5 text-[11px] font-semibold text-primary max-sm:w-full max-sm:text-center">
            {locale === 'ar' ? 'عرض التفاصيل' : 'View details'}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="h-[calc(100%-3.5rem)] min-h-64 sm:min-h-72">
        <div className="h-full min-h-56 w-full sm:min-h-64">{children}</div>
      </CardContent>
    </Card>
  );
}

interface Point {
  label: string;
  value: number;
  href?: string;
}

function openPoint(point: unknown): void {
  if (!point || typeof point !== 'object' || !('href' in point)) return;
  const href = (point as { href?: unknown }).href;
  if (typeof href === 'string' && href) window.location.assign(href);
}

function activePoint(state: unknown): unknown {
  return (state as { activePayload?: { payload?: unknown }[] } | undefined)?.activePayload?.[0]?.payload;
}

function ChartEmpty({ locale }: { locale: AppLocale }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-amber/25 bg-linen/20 p-4 text-center text-sm text-muted-foreground">
      {locale === 'ar' ? 'لا توجد بيانات ضمن الفلاتر الحالية.' : 'No data found for the selected filters.'}
    </div>
  );
}

export function LineChartCard({
  title,
  data,
  locale,
  valueKind = 'iqd',
}: {
  title: string;
  data: Point[];
  locale: AppLocale;
  valueKind?: ValueKind;
}) {
  const drilldown = hasDrilldown(data);
  return (
    <ChartFrame title={title} drilldown={drilldown} locale={locale}>
      {data.length ? <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
          onClick={(state) => openPoint(activePoint(state))}
          style={drilldown ? { cursor: 'pointer' } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={18} tickMargin={8} />
          <YAxis {...axisProps} width={valueKind === 'iqd' ? 68 : 44} tickFormatter={(v) => fmt(Number(v), valueKind, locale, true)} />
          <Tooltip
            formatter={(v) => fmt(Number(v), valueKind, locale)}
            labelFormatter={(label) => drilldown ? `${label} · ${locale === 'ar' ? 'اضغط للتفاصيل' : 'click for details'}` : String(label)}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer> : <ChartEmpty locale={locale} />}
    </ChartFrame>
  );
}

export function BarChartCard({
  title,
  data,
  locale,
  valueKind = 'iqd',
  horizontal = false,
}: {
  title: string;
  data: Point[];
  locale: AppLocale;
  valueKind?: ValueKind;
  horizontal?: boolean;
}) {
  const drilldown = hasDrilldown(data);
  const leftWidth = Math.min(190, Math.max(116, ...data.map((point) => point.label.length * 7)));
  return (
    <ChartFrame title={title} drilldown={drilldown} locale={locale}>
      {data.length ? <ResponsiveContainer width="100%" height="100%">
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 8 }} style={drilldown ? { cursor: 'pointer' } : undefined}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" horizontal={false} />
            <XAxis type="number" {...axisProps} tickFormatter={(v) => fmt(Number(v), valueKind, locale, true)} />
            <YAxis type="category" dataKey="label" {...axisProps} width={leftWidth} tick={{ ...axisProps.tick, width: leftWidth }} />
            <Tooltip
              formatter={(v) => fmt(Number(v), valueKind, locale)}
              labelFormatter={(label) => drilldown ? `${label} · ${locale === 'ar' ? 'اضغط للتفاصيل' : 'click for details'}` : String(label)}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={(point) => openPoint(point?.payload)}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }} style={drilldown ? { cursor: 'pointer' } : undefined}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" vertical={false} />
            <XAxis dataKey="label" {...axisProps} minTickGap={10} interval="preserveStartEnd" tickMargin={8} />
            <YAxis {...axisProps} width={valueKind === 'iqd' ? 68 : 44} tickFormatter={(v) => fmt(Number(v), valueKind, locale, true)} />
            <Tooltip
              formatter={(v) => fmt(Number(v), valueKind, locale)}
              labelFormatter={(label) => drilldown ? `${label} · ${locale === 'ar' ? 'اضغط للتفاصيل' : 'click for details'}` : String(label)}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} onClick={(point) => openPoint(point?.payload)}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer> : <ChartEmpty locale={locale} />}
    </ChartFrame>
  );
}

export function DonutChartCard({
  title,
  data,
  locale,
  valueKind = 'iqd',
}: {
  title: string;
  data: Point[];
  locale: AppLocale;
  valueKind?: ValueKind;
}) {
  const drilldown = hasDrilldown(data);
  return (
    <ChartFrame title={title} drilldown={drilldown} locale={locale}>
      {data.length ? <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            onClick={(point) => openPoint(point?.payload ?? point)}
            style={drilldown ? { cursor: 'pointer' } : undefined}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => fmt(Number(v), valueKind, locale)}
            labelFormatter={(label) => drilldown ? `${label} · ${locale === 'ar' ? 'اضغط للتفاصيل' : 'click for details'}` : String(label)}
          />
          <Legend wrapperStyle={{ fontSize: 11, lineHeight: '18px', paddingTop: 10, maxWidth: '100%' }} />
        </PieChart>
      </ResponsiveContainer> : <ChartEmpty locale={locale} />}
    </ChartFrame>
  );
}

export interface WaterfallStep {
  label: string;
  /** Magnitude of this step (always positive). */
  value: number;
  kind: 'total' | 'inc' | 'dec';
}

export function WaterfallChart({
  title,
  steps,
  locale,
}: {
  title: string;
  steps: WaterfallStep[];
  locale: AppLocale;
}) {
  const data = steps.reduce<{ running: number; rows: { label: string; base: number; bar: number; fill: string }[] }>(
    (acc, s) => {
      if (s.kind === 'total') {
        return {
          running: s.value,
          rows: [...acc.rows, { label: s.label, base: 0, bar: s.value, fill: CHART_COLORS[0] }],
        };
      }
      if (s.kind === 'inc') {
        return {
          running: acc.running + s.value,
          rows: [...acc.rows, { label: s.label, base: acc.running, bar: s.value, fill: POSITIVE }],
        };
      }
      return {
        running: acc.running - s.value,
        rows: [...acc.rows, { label: s.label, base: acc.running - s.value, bar: s.value, fill: NEGATIVE }],
      };
    },
    { running: 0, rows: [] },
  ).rows;

  return (
    <ChartFrame title={title} locale={locale}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval={0} angle={-15} textAnchor="end" height={50} />
          <YAxis {...axisProps} width={74} tickFormatter={(v) => formatMoneyCompact(Number(v), 'IQD', locale)} />
          <Tooltip formatter={(v) => formatMoney(Number(v), 'IQD', locale)} />
          <Bar dataKey="base" stackId="wf" fill="transparent" />
          <Bar dataKey="bar" stackId="wf" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

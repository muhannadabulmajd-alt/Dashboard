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

function ChartFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

interface Point {
  label: string;
  value: number;
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
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => fmt(Number(v), valueKind, locale, true)} />
          <Tooltip formatter={(v) => fmt(Number(v), valueKind, locale)} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
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
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height="100%">
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" horizontal={false} />
            <XAxis type="number" {...axisProps} tickFormatter={(v) => fmt(Number(v), valueKind, locale, true)} />
            <YAxis type="category" dataKey="label" {...axisProps} width={110} />
            <Tooltip formatter={(v) => fmt(Number(v), valueKind, locale)} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" vertical={false} />
            <XAxis dataKey="label" {...axisProps} minTickGap={8} />
            <YAxis {...axisProps} width={56} tickFormatter={(v) => fmt(Number(v), valueKind, locale, true)} />
            <Tooltip formatter={(v) => fmt(Number(v), valueKind, locale)} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
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
  return (
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => fmt(Number(v), valueKind, locale)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
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
    <ChartFrame title={title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6dccb" vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval={0} angle={-15} textAnchor="end" height={50} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => formatMoneyCompact(Number(v), 'IQD', locale)} />
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

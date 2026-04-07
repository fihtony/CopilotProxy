import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, type TooltipProps } from "recharts";
import { formatBucketToLocalTime, getBucketAxisLabel, hasVisibleSecondaryBucketAxisLabels } from "../utils/dateFormatter";
import type { TimeWindowValue } from "../api/client";

interface TimelineChartProps {
  title: string;
  subtitle?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  dataKeys: Array<{ key: string; color: string; label?: string }>;
  unit?: string;
  timeWindow?: TimeWindowValue;
  /** When true and unit is "ms", automatically switch Y-axis to seconds if any value is at least 10 s. */
  autoScaleMs?: boolean;
}

export function TimelineChart({ title, subtitle, data, dataKeys, unit, timeWindow, autoScaleMs }: TimelineChartProps) {
  const useSeconds =
    Boolean(autoScaleMs) && unit === "ms" && data.some((row) => dataKeys.some((dk) => Number(row[dk.key] ?? 0) >= 10_000));

  const displayUnit = useSeconds ? "s" : (unit ?? "");

  function formatSeriesValue(value: number, label?: string) {
    if (label?.endsWith("%")) {
      return `${Math.round(value)}%`;
    }
    if (displayUnit === "s") {
      return `${(value / 1000).toFixed(1)}s`;
    }
    if (displayUnit === "ms") {
      return `${Math.round(value)}ms`;
    }
    if (displayUnit === "%") {
      return `${Math.round(value)}%`;
    }
    return String(Math.round(value * 100) / 100);
  }

  function renderTooltip({ active, payload, label }: TooltipProps<number, string>) {
    if (!active || !payload || !payload.length) return null;
    const displayLabel = formatBucketToLocalTime(label || "");
    return (
      <div
        style={{
          backgroundColor: "#dedede",
          border: "1px solid #3f404d",
          borderRadius: "8px",
          padding: "8px 12px",
          color: "#161616",
        }}
      >
        <p style={{ margin: "0 0 4px 0", color: "#4d4c4c", fontWeight: 400 }}>{displayLabel}</p>
        {payload.map((entry, index) => {
          let entryLabel = entry.name || "";
          let displayValue: string;

          if (entryLabel.endsWith("%") && typeof entry.value === "number") {
            entryLabel = entryLabel.slice(0, -1).trim();
            displayValue = `${entry.value}%`;
          } else if (typeof entry.value === "number") {
            displayValue = formatSeriesValue(entry.value, entry.name);
          } else {
            displayValue = String(entry.value ?? "");
          }

          return (
            <p key={index} style={{ margin: "2px 0", color: entry.color }}>
              {entryLabel}: {displayValue}
            </p>
          );
        })}
      </div>
    );
  }

  const xAxisInterval = data.length > 8 ? Math.ceil(data.length / 8) - 1 : 0;
  // Suppress time labels on the X-axis for any window except 24h:
  // - 7d buckets have hourly time components but we want date-only labels to keep
  //   the axis height consistent with 30d/90d (which have no time in their buckets).
  // - Crucially, this is derived from *data* (not just timeWindow), so if stale 7d
  //   hourly data is still rendered while new 30d data is loading, time labels are
  //   still suppressed — preventing the two-row flash on window switch.
  const dataHasTimeBuckets = data.some((row) => String(row.bucket ?? "").includes(" "));
  const axisLabelOptions = {
    suppressAllTime: dataHasTimeBuckets && timeWindow !== "24h",
  };
  const visibleTickStep = xAxisInterval + 1;
  const hasSecondaryAxisLabels = hasVisibleSecondaryBucketAxisLabels(
    data.map((row) => String(row.bucket ?? "")),
    axisLabelOptions,
    visibleTickStep,
  );

  function renderXAxisTick(props: { x?: number; y?: number; payload?: { value?: string } }) {
    const { x = 0, y = 0, payload } = props;
    const label = getBucketAxisLabel(String(payload?.value ?? ""), axisLabelOptions);
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={14} textAnchor="middle" fill="#d6d7df" fontSize={12}>
          <tspan x={0}>{label.primary}</tspan>
          {label.secondary ? <tspan x={0} dy={14}>{label.secondary}</tspan> : null}
        </text>
      </g>
    );
  }

  return (
    <div className="chart-card" data-testid="timeline-chart">
      <div className="section-head">
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <defs>
            {dataKeys.map((dk) => (
              <linearGradient key={dk.key} id={`grad-${dk.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={dk.color} stopOpacity={0.55} />
                <stop offset="100%" stopColor={dk.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#3f404d" />
          <XAxis
            dataKey="bucket"
            tick={renderXAxisTick}
            interval={xAxisInterval}
            minTickGap={12}
            height={hasSecondaryAxisLabels ? 48 : 30}
          />
          <YAxis
            tick={{ fill: "#d6d7df", fontSize: 12 }}
            unit={displayUnit}
            tickFormatter={useSeconds ? (v) => (v / 1000).toFixed(1) : undefined}
          />
          <Tooltip content={renderTooltip} />
          {dataKeys.length > 1 && <Legend />}
          {dataKeys.map((dk) => (
            <Area
              key={dk.key}
              type="monotone"
              dataKey={dk.key}
              name={dk.label ?? dk.key}
              stroke={dk.color}
              fill={`url(#grad-${dk.key})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, type TooltipProps } from "recharts";
import { formatBucketToLocalTime } from "../utils/dateFormatter";

interface TimelineChartProps {
  title: string;
  subtitle?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  dataKeys: Array<{ key: string; color: string; label?: string }>;
  unit?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (active && payload && payload.length) {
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
          // Format the label: remove trailing unit indicators and format properly
          let label = entry.name || "";
          let displayValue: string | number | undefined = entry.value;

          // Special case: if label ends with %, remove it from label and add to value
          if (label.endsWith("%") && typeof entry.value === "number") {
            label = label.slice(0, -1).trim();
            displayValue = `${entry.value}%`;
          }

          return (
            <p key={index} style={{ margin: "2px 0", color: entry.color }}>
              {label}: {displayValue}
            </p>
          );
        })}
      </div>
    );
  }
  return null;
}

export function TimelineChart({ title, subtitle, data, dataKeys, unit }: TimelineChartProps) {
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
          <XAxis dataKey="bucket" tick={{ fill: "#d6d7df", fontSize: 12 }} tickFormatter={formatBucketToLocalTime} />
          <YAxis tick={{ fill: "#d6d7df", fontSize: 12 }} unit={unit} />
          <Tooltip content={<CustomTooltip />} />
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

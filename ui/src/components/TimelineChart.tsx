import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, type TooltipProps } from "recharts";

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
        <p style={{ margin: "0 0 4px 0", color: "#4d4c4c", fontWeight: 400 }}>{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ margin: "2px 0", color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
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
          <XAxis dataKey="bucket" tick={{ fill: "#d6d7df", fontSize: 12 }} />
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

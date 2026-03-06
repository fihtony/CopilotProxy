import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface TimelineChartProps {
  data: Array<{
    bucket: string;
    calls: number;
    avgResponseTime: number;
    successRate: number;
  }>;
}

export function TimelineChart({ data }: TimelineChartProps) {
  return (
    <div className="chart-card" data-testid="timeline-chart">
      <div className="section-head">
        <h3>Call Timeline</h3>
        <p>Calls per hour with response-time trend.</p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff7a18" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#ff7a18" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#3f404d" />
          <XAxis dataKey="bucket" tick={{ fill: "#d6d7df", fontSize: 12 }} />
          <YAxis tick={{ fill: "#d6d7df", fontSize: 12 }} />
          <Tooltip />
          <Area type="monotone" dataKey="calls" stroke="#ff7a18" fill="url(#callsGradient)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

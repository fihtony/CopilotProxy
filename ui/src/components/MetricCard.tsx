interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  hints?: string[];
}

export function MetricCard({ label, value, hint, hints }: MetricCardProps) {
  return (
    <section className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {hints && hints.length > 0 ? (
        <div className="metric-hint-tags">
          {hints.map((h) => <span key={h} className="metric-tag">{h}</span>)}
        </div>
      ) : hint ? (
        <span className="metric-hint">{hint}</span>
      ) : null}
    </section>
  );
}

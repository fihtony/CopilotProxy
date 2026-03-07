import { formatDateTime } from "../utils/dateFormatter";

interface RequestItem {
  id: number;
  timestamp: string;
  path: string;
  status_code: number;
  response_time_ms: number;
  model_requested: string | null;
  model_used: string;
  total_tokens: number | null;
  success: number;
  error_message: string | null;
}

export function RequestTable({ items }: { items: RequestItem[] }) {
  return (
    <div className="table-card">
      <div className="section-head">
        <h3>Recent Requests</h3>
        <p>Latest requests for the selected API key.</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Path</th>
            <th>Status</th>
            <th>Latency</th>
            <th>Requested</th>
            <th>Used</th>
            <th>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} data-testid="history-row">
              <td>{formatDateTime(item.timestamp)}</td>
              <td>{item.path}</td>
              <td>{item.status_code}</td>
              <td>{item.response_time_ms} ms</td>
              <td>{item.model_requested ?? "n/a"}</td>
              <td>{item.model_used}</td>
              <td>{item.total_tokens ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 ? <p className="empty-state">No requests captured yet.</p> : null}
    </div>
  );
}

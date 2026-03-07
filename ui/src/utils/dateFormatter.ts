/**
 * Centralized date formatting utilities for the CopilotProxy UI.
 * All date formatting across the application should use these functions
 * to ensure consistency with the YYYY/MM/DD format.
 */

/**
 * Format an ISO date string or Date object as YYYY/MM/DD HH:MM:SS
 * @param iso - ISO string or Date object (null/undefined returns "—")
 * @returns Formatted string in YYYY/MM/DD HH:MM:SS format
 */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format an ISO date string or Date object as YYYY/MM/DD
 * @param iso - ISO string or Date object (null/undefined returns "—")
 * @returns Formatted string in YYYY/MM/DD format
 */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * Format a date bucket for timeline charts.
 * - For hourly buckets (contains ":"): returns YYYY/MM/DD HH:00
 * - For daily buckets: returns YYYY/MM/DD
 * @param bucket - Date bucket string (can be in various formats from backend)
 * @returns Formatted bucket label
 */
export function formatBucketToLocalTime(bucket: string): string {
  if (!bucket) return bucket;
  // Backend now returns buckets already in LOCAL time via datetime(timestamp,'localtime').
  // Format: "2026-03-07 14:00:00" (24h hourly) or "2026-03-07" (7d/30d/90d daily).
  // Reformat the string parts directly — no Date/timezone conversion needed.
  if (bucket.includes(" ")) {
    const [datePart, timePart] = bucket.split(" ");
    const [year, month, day] = datePart.split("-");
    const [hour] = timePart.split(":");
    return `${year}/${month}/${day} ${hour}:00`;
  }
  if (bucket.includes("-")) {
    const [year, month, day] = bucket.split("-");
    return `${year}/${month}/${day}`;
  }
  return bucket;
}

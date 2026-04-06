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
 * - Current-year buckets use MM-DD
 * - Cross-year buckets use YY-MM-DD
 * - Time is shown as HH:MM only when the bucket includes a time component
 * @param bucket - Date bucket string (can be in various formats from backend)
 * @returns Formatted bucket label
 */
export function formatBucketToLocalTime(bucket: string): string {
  const label = getBucketAxisLabel(bucket);
  return label.secondary ? `${label.primary} ${label.secondary}` : label.primary;
}

export interface BucketAxisLabelOptions {
  suppressMidnightTime?: boolean;
  /** Suppress all time parts from axis labels (e.g. for 7d window to keep axis height consistent with 30d/90d). */
  suppressAllTime?: boolean;
}

export function getBucketAxisLabel(
  bucket: string,
  options?: BucketAxisLabelOptions,
): { primary: string; secondary?: string } {
  if (!bucket) return { primary: bucket };

  const [datePart, timePart] = bucket.split(" ");
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) {
    return { primary: bucket };
  }

  const currentYear = new Date().getFullYear();
  const numericYear = Number(year);
  const dateLabel = numericYear === currentYear ? `${month}-${day}` : `${year.slice(-2)}-${month}-${day}`;

  if (!timePart) {
    return { primary: dateLabel };
  }

  const [hour = "00", minute = "00"] = timePart.split(":");
  if (options?.suppressAllTime) {
    return { primary: dateLabel };
  }
  if (options?.suppressMidnightTime && hour === "00" && minute === "00") {
    return { primary: dateLabel };
  }

  return {
    primary: dateLabel,
    secondary: `${hour}:${minute}`,
  };
}

export function hasVisibleSecondaryBucketAxisLabels(
  buckets: string[],
  options?: BucketAxisLabelOptions,
  visibleTickStep = 1,
) {
  return buckets.some((bucket, index) => index % visibleTickStep === 0 && Boolean(getBucketAxisLabel(bucket, options).secondary));
}

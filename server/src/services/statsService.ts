import { insertRequestLog, getKeyHistory, getKeyStats, getOverview } from "../db/database.js";
import type { RequestLogRecord, TimeWindow } from "../types.js";

export function recordRequest(record: RequestLogRecord) {
  insertRequestLog(record);
}

export function readOverview(window: TimeWindow) {
  return getOverview(window);
}

export function readKeyStats(id: number, window: TimeWindow) {
  return getKeyStats(id, window);
}

export function readKeyHistory(id: number, page: number, limit: number) {
  return getKeyHistory(id, page, limit);
}

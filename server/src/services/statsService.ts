import { insertRequestLog, getKeyHistory, getKeyStats, getOverview } from "../db/database.js";
import type { RequestLogRecord, TimeWindow } from "../types.js";

export function recordRequest(record: RequestLogRecord) {
  insertRequestLog(record);
}

export function readOverview(window: TimeWindow, timeZone?: string) {
  return getOverview(window, timeZone);
}

export function readKeyStats(id: number, window: TimeWindow | null, timeZone?: string, allowedModels?: string[]) {
  return getKeyStats(id, window, timeZone, allowedModels);
}

export function readKeyHistory(id: number, page: number, limit: number) {
  return getKeyHistory(id, page, limit);
}

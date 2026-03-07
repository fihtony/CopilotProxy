import { getSettingsFromDb, updateSettingsInDb } from "../db/database.js";
import type { SettingsRecord } from "../types.js";

let cached: SettingsRecord;

export function initSettings() {
  cached = getSettingsFromDb();
}

export function getSettings(): SettingsRecord {
  cached = getSettingsFromDb();
  return cached;
}

export function updateSettings(patch: Partial<SettingsRecord>) {
  updateSettingsInDb(patch);
  cached = getSettingsFromDb();
  return cached;
}

export function getCachedSettings(): SettingsRecord {
  return cached;
}

// Initialize on import
initSettings();

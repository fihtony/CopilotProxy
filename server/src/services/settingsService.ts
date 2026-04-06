import { getSettingsFromDb, updateSettingsInDb } from "../db/database.js";
import type { SettingsRecord } from "../types.js";
import { getSafeDefaultCopilotUrl, sanitizeSettingsPatch, sanitizeSettingsRecord } from "./copilotUrlPolicy.js";

let cached: SettingsRecord = {
  copilot_url: getSafeDefaultCopilotUrl(),
  default_model: "gpt-5-mini",
  dashboard_time_window: "24h",
  key_detail_time_window: "24h",
};

function refreshSettings(): SettingsRecord {
  const raw = getSettingsFromDb();
  const { record, changed } = sanitizeSettingsRecord(raw);
  if (changed && record.copilot_url !== raw.copilot_url) {
    updateSettingsInDb({ copilot_url: record.copilot_url });
  }
  cached = record;
  return cached;
}

export function initSettings() {
  refreshSettings();
}

export function getSettings(): SettingsRecord {
  return refreshSettings();
}

export function updateSettings(patch: Partial<SettingsRecord>) {
  updateSettingsInDb(sanitizeSettingsPatch(patch));
  return refreshSettings();
}

export function getCachedSettings(): SettingsRecord {
  if (!cached) {
    return refreshSettings();
  }
  return cached;
}

// Initialize on import
initSettings();

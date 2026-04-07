import { apiClient, type SettingsResponse, type TimeWindowValue } from "../api/client";

export type TimeWindowPreferenceKey = "dashboard_time_window" | "key_detail_time_window";

export async function readTimeWindowPreference(key: TimeWindowPreferenceKey): Promise<TimeWindowValue> {
  const response = await apiClient.get<SettingsResponse>("/settings");
  return response.data[key];
}

export function saveTimeWindowPreference(key: TimeWindowPreferenceKey, value: TimeWindowValue) {
  return apiClient.put("/settings", { [key]: value });
}
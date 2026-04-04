import net from "node:net";
import { config } from "../config.js";
import type { SettingsRecord } from "../types.js";

const BLOCKED_METADATA_HOSTS = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
  "fd00:ec2::254",
  "metadata.google.internal",
  "metadata.internal",
]);

function normalizeBaseUrl(url: URL): string {
  const text = url.toString();
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

function isBlockedMetadataHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return BLOCKED_METADATA_HOSTS.has(normalized) || (net.isIP(normalized) !== 0 && BLOCKED_METADATA_HOSTS.has(normalized));
}

export function validateCopilotUrl(urlString: string): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, error: "copilot_url must be a valid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "copilot_url must use http:// or https://" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: "copilot_url must not include embedded credentials" };
  }

  if (isBlockedMetadataHost(parsed.hostname)) {
    return { ok: false, error: "copilot_url must not point to a cloud metadata service address" };
  }

  return { ok: true, normalizedUrl: normalizeBaseUrl(parsed) };
}

export function getSafeDefaultCopilotUrl(): string {
  const result = validateCopilotUrl(config.copilotUrl);
  if (!result.ok) {
    throw new Error(`Invalid COPILOT_URL configuration: ${result.error}`);
  }
  return result.normalizedUrl;
}

export function sanitizeSettingsPatch(patch: Partial<SettingsRecord>): Partial<SettingsRecord> {
  if (patch.copilot_url === undefined) {
    return patch;
  }

  const result = validateCopilotUrl(patch.copilot_url);
  if (!result.ok) {
    throw new Error(result.error);
  }

  return { ...patch, copilot_url: result.normalizedUrl };
}

export function sanitizeSettingsRecord(record: SettingsRecord): { record: SettingsRecord; changed: boolean } {
  const result = validateCopilotUrl(record.copilot_url);
  if (!result.ok) {
    const fallbackUrl = getSafeDefaultCopilotUrl();
    return {
      record: { ...record, copilot_url: fallbackUrl },
      changed: record.copilot_url !== fallbackUrl,
    };
  }

  return {
    record: { ...record, copilot_url: result.normalizedUrl },
    changed: record.copilot_url !== result.normalizedUrl,
  };
}
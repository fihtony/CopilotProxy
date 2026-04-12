import { getApiKeyByHash } from "../db/database.js";
import type { ApiKeyRecord } from "../types.js";

export interface ApiKeyAuthSnapshot {
  keyHash: string;
  apiKeyId: number;
  name: string;
  keyPreview: string;
  allowedModels: string[];
  fallbackModel: string;
  isActive: number;
  isDeleted: number;
  updatedAt: string;
  loadedAt: number;
}

const CACHE_CAPACITY = 512;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map<string, ApiKeyAuthSnapshot>();

function evictLru() {
  if (cache.size <= CACHE_CAPACITY) return;
  // Map iteration order is insertion order; the first entry is the oldest
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) {
    cache.delete(firstKey);
  }
}

function touchEntry(keyHash: string, entry: ApiKeyAuthSnapshot) {
  // Move to end of Map (most recently used)
  cache.delete(keyHash);
  cache.set(keyHash, entry);
}

function recordToSnapshot(record: ApiKeyRecord, keyHash: string): ApiKeyAuthSnapshot {
  let allowedModels: string[];
  try {
    allowedModels = JSON.parse(record.allowed_models);
    if (!Array.isArray(allowedModels)) allowedModels = [];
  } catch {
    allowedModels = [];
  }
  return {
    keyHash,
    apiKeyId: record.id,
    name: record.name,
    keyPreview: record.key_preview,
    allowedModels,
    fallbackModel: record.fallback_model,
    isActive: record.is_active,
    isDeleted: record.is_deleted,
    updatedAt: record.updated_at,
    loadedAt: Date.now(),
  };
}

export function getApiKeyAuthSnapshotByHash(keyHash: string): ApiKeyAuthSnapshot | null {
  const cached = cache.get(keyHash);
  if (cached) {
    const age = Date.now() - cached.loadedAt;
    if (age < CACHE_TTL_MS) {
      touchEntry(keyHash, cached);
      return cached;
    }
    // TTL expired — must refresh from DB
    cache.delete(keyHash);
    const record = getApiKeyByHash(keyHash);
    if (!record) {
      return null;
    }
    const snapshot = recordToSnapshot(record, keyHash);
    cache.set(keyHash, snapshot);
    evictLru();
    return snapshot;
  }

  // Cache miss — read from DB
  const record = getApiKeyByHash(keyHash);
  if (!record) {
    return null;
  }
  const snapshot = recordToSnapshot(record, keyHash);
  cache.set(keyHash, snapshot);
  evictLru();
  return snapshot;
}

export function upsertApiKeyAuthSnapshot(keyHash: string, record: ApiKeyRecord) {
  const snapshot = recordToSnapshot(record, keyHash);
  cache.set(keyHash, snapshot);
  evictLru();
}

export function invalidateApiKeyAuthSnapshot(keyHash: string) {
  cache.delete(keyHash);
}

export function invalidateApiKeyAuthSnapshotById(apiKeyId: number) {
  for (const [keyHash, entry] of cache) {
    if (entry.apiKeyId === apiKeyId) {
      cache.delete(keyHash);
      return;
    }
  }
}

/** For testing only */
export function clearApiKeyCache() {
  cache.clear();
}

/** For testing: get current cache size */
export function getApiKeyCacheSize(): number {
  return cache.size;
}

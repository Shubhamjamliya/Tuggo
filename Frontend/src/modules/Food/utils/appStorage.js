const STORAGE_NAMESPACE = 'food:v1'
const STORAGE_TYPES = {
  local: 'localStorage',
  session: 'sessionStorage',
}

const DEFAULT_META_VERSION = 1

function getStorage(type = 'local') {
  if (typeof window === 'undefined') return null
  const key = STORAGE_TYPES[type] || STORAGE_TYPES.local
  try {
    return window[key] || null
  } catch (_) {
    return null
  }
}

export function createStorageKey(scope, name) {
  return [STORAGE_NAMESPACE, scope, name].filter(Boolean).join(':')
}

export function readRawStorage(key, { storage = 'local' } = {}) {
  const target = getStorage(storage)
  if (!target) return null
  try {
    return target.getItem(key)
  } catch (_) {
    return null
  }
}

export function writeRawStorage(key, value, { storage = 'local' } = {}) {
  const target = getStorage(storage)
  if (!target) return false
  try {
    target.setItem(key, value)
    return true
  } catch (_) {
    return false
  }
}

export function removeStorageKey(key, { storage = 'local' } = {}) {
  const target = getStorage(storage)
  if (!target) return false
  try {
    target.removeItem(key)
    return true
  } catch (_) {
    return false
  }
}

export function readJSONStorage(key, { storage = 'local', fallback = null } = {}) {
  const raw = readRawStorage(key, { storage })
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch (_) {
    return fallback
  }
}

export function writeJSONStorage(key, value, { storage = 'local' } = {}) {
  return writeRawStorage(key, JSON.stringify(value), { storage })
}

export function writeScopedValue(scope, name, value, options = {}) {
  return writeJSONStorage(createStorageKey(scope, name), value, options)
}

export function readScopedValue(scope, name, options = {}) {
  return readJSONStorage(createStorageKey(scope, name), options)
}

export function removeScopedValue(scope, name, options = {}) {
  return removeStorageKey(createStorageKey(scope, name), options)
}

export function writeScopedCachedValue(scope, name, value, {
  storage = 'local',
  ttlMs = null,
  version = DEFAULT_META_VERSION,
} = {}) {
  return writeScopedValue(scope, name, {
    value,
    meta: {
      version,
      savedAt: Date.now(),
      expiresAt: Number.isFinite(ttlMs) ? Date.now() + ttlMs : null,
    },
  }, { storage })
}

export function readScopedCachedValue(scope, name, {
  storage = 'local',
  fallback = null,
  minVersion = DEFAULT_META_VERSION,
} = {}) {
  const key = createStorageKey(scope, name)
  const payload = readJSONStorage(key, { storage })
  if (!payload || typeof payload !== 'object' || !('meta' in payload)) {
    return fallback
  }

  const version = Number(payload?.meta?.version ?? DEFAULT_META_VERSION)
  if (version < minVersion) {
    removeStorageKey(key, { storage })
    return fallback
  }

  const expiresAt = Number(payload?.meta?.expiresAt)
  if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
    removeStorageKey(key, { storage })
    return fallback
  }

  return payload?.value ?? fallback
}

export function migrateLegacyJSONKey(legacyKey, scope, name, {
  storage = 'local',
  ttlMs = null,
  transform = (value) => value,
  removeLegacy = true,
} = {}) {
  const key = createStorageKey(scope, name)
  if (readRawStorage(key, { storage })) return readScopedCachedValue(scope, name, { storage })

  const legacy = readJSONStorage(legacyKey, { storage })
  if (legacy == null) return null

  const nextValue = transform(legacy)
  writeScopedCachedValue(scope, name, nextValue, { storage, ttlMs })
  if (removeLegacy) removeStorageKey(legacyKey, { storage })
  return nextValue
}

export function migrateLegacyRawKey(legacyKey, scope, name, {
  storage = 'local',
  ttlMs = null,
  transform = (value) => value,
  removeLegacy = true,
} = {}) {
  const key = createStorageKey(scope, name)
  if (readRawStorage(key, { storage })) return readScopedCachedValue(scope, name, { storage })

  const legacy = readRawStorage(legacyKey, { storage })
  if (legacy == null) return null

  const nextValue = transform(legacy)
  writeScopedCachedValue(scope, name, nextValue, { storage, ttlMs })
  if (removeLegacy) removeStorageKey(legacyKey, { storage })
  return nextValue
}

export function cleanupExpiredScopedEntries({ storage = 'local', prefix = STORAGE_NAMESPACE } = {}) {
  const target = getStorage(storage)
  if (!target) return 0
  const toRemove = []

  try {
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const payload = readJSONStorage(key, { storage })
      const expiresAt = Number(payload?.meta?.expiresAt)
      if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
        toRemove.push(key)
      }
    }

    toRemove.forEach((key) => target.removeItem(key))
    return toRemove.length
  } catch (_) {
    return 0
  }
}

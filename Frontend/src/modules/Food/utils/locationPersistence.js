/** Single writer for location-related persisted storage. */
import {
  readScopedCachedValue,
  readScopedValue,
  removeScopedValue,
  writeScopedCachedValue,
  writeScopedValue,
} from './appStorage'

const LOCATION_SCOPE = 'location'
const ZONE_SCOPE = 'zone'
const LOCATION_TTL_MS = 24 * 60 * 60 * 1000

const readLegacyLocation = () => {
  try {
    const raw = localStorage.getItem('userLocation')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
      return parsed
    }
  } catch (_) {}
  return null
}

const readLegacyDeliveryMode = () => {
  try {
    return localStorage.getItem('deliveryAddressMode') || null
  } catch (_) {
    return null
  }
}

const cleanupLegacyLocationKeys = () => {
  try {
    localStorage.removeItem('userLocation')
    localStorage.removeItem('userLat')
    localStorage.removeItem('userLng')
    localStorage.removeItem('deliveryAddressMode')
  } catch (_) {}
}

const migrateLegacyLocationState = () => {
  const cached = readScopedCachedValue(LOCATION_SCOPE, 'current')
  const mode = readScopedValue(LOCATION_SCOPE, 'mode')
  if (cached || mode) return

  const legacyLocation = readLegacyLocation()
  const legacyMode = readLegacyDeliveryMode()

  if (legacyLocation) {
    writeScopedCachedValue(LOCATION_SCOPE, 'current', legacyLocation, { ttlMs: LOCATION_TTL_MS })
  }
  if (legacyMode === 'saved' || legacyMode === 'current') {
    writeScopedValue(LOCATION_SCOPE, 'mode', legacyMode)
  }

  if (legacyLocation || legacyMode) {
    cleanupLegacyLocationKeys()
  }
}

migrateLegacyLocationState()

export function readStoredUserLocation() {
  return readScopedCachedValue(LOCATION_SCOPE, 'current', { fallback: null })
}

export function persistUserLocation(location, { mode } = {}) {
  if (!location?.latitude || !location?.longitude) return
  writeScopedCachedValue(LOCATION_SCOPE, 'current', location, { ttlMs: LOCATION_TTL_MS })
  if (mode === 'saved' || mode === 'current') {
    writeScopedValue(LOCATION_SCOPE, 'mode', mode)
  }

  // Keep legacy keys in sync until remaining readers are migrated.
  try {
    localStorage.setItem('userLocation', JSON.stringify(location))
    localStorage.setItem('userLat', String(location.latitude))
    localStorage.setItem('userLng', String(location.longitude))
    if (mode === 'saved' || mode === 'current') {
      localStorage.setItem('deliveryAddressMode', mode)
    }
  } catch (_) {}
}

export function clearStoredUserLocation() {
  removeScopedValue(LOCATION_SCOPE, 'current')
  cleanupLegacyLocationKeys()
}

export function persistDeliveryAddressMode(mode) {
  if (mode === 'saved' || mode === 'current') {
    writeScopedValue(LOCATION_SCOPE, 'mode', mode)
    try {
      localStorage.setItem('deliveryAddressMode', mode)
    } catch (_) {}
    return
  }

  removeScopedValue(LOCATION_SCOPE, 'mode')
  try {
    localStorage.removeItem('deliveryAddressMode')
  } catch (_) {}
}

export function readDeliveryAddressMode() {
  return readScopedValue(LOCATION_SCOPE, 'mode', { fallback: 'saved' }) || 'saved'
}

export function notifyLocationUpdated(location) {
  if (!location) return
  window.dispatchEvent(new CustomEvent('userLocationUpdated', { detail: { location } }))
}

export function notifyDeliveryModeUpdated(mode) {
  window.dispatchEvent(new CustomEvent('deliveryAddressModeUpdated', { detail: { mode } }))
}

export function readStoredZoneContext() {
  const zoneId = readScopedValue(ZONE_SCOPE, 'id', { fallback: null })
  const zoneStatus = readScopedValue(ZONE_SCOPE, 'status', { fallback: null })
  const zone = readScopedCachedValue(ZONE_SCOPE, 'data', { fallback: null })

  const location = readStoredUserLocation()
  const latitude = location?.latitude ?? null
  const longitude = location?.longitude ?? null

  return {
    zoneId,
    zoneStatus,
    zone,
    latitude,
    longitude,
  }
}

export function persistZoneContext({ zoneId = null, zone = null, status = null } = {}) {
  if (zoneId) {
    writeScopedValue(ZONE_SCOPE, 'id', zoneId)
    try {
      localStorage.setItem('userZoneId', zoneId)
    } catch (_) {}
  } else {
    removeScopedValue(ZONE_SCOPE, 'id')
    try {
      localStorage.removeItem('userZoneId')
    } catch (_) {}
  }

  if (status) {
    writeScopedValue(ZONE_SCOPE, 'status', status)
    try {
      localStorage.setItem('outOfService', status)
    } catch (_) {}
  } else {
    removeScopedValue(ZONE_SCOPE, 'status')
    try {
      localStorage.removeItem('outOfService')
    } catch (_) {}
  }

  if (zone) {
    writeScopedCachedValue(ZONE_SCOPE, 'data', zone, { ttlMs: LOCATION_TTL_MS })
    try {
      localStorage.setItem('userZone', JSON.stringify(zone))
    } catch (_) {}
  } else {
    removeScopedValue(ZONE_SCOPE, 'data')
    try {
      localStorage.removeItem('userZone')
    } catch (_) {}
  }
}

export function clearStoredZoneContext() {
  removeScopedValue(ZONE_SCOPE, 'id')
  removeScopedValue(ZONE_SCOPE, 'status')
  removeScopedValue(ZONE_SCOPE, 'data')
  try {
    localStorage.removeItem('userZoneId')
    localStorage.removeItem('userZone')
    localStorage.removeItem('outOfService')
  } catch (_) {}
}


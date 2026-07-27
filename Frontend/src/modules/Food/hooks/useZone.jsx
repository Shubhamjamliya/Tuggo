import { useState, useEffect, useCallback, useRef } from 'react'
import { zoneAPI } from '@food/api'
import { clearStoredZoneContext, persistZoneContext, readStoredZoneContext } from '@food/utils/locationPersistence'
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const ZONE_CACHE_TTL_MS = 30 * 1000
const zoneCache = new Map()
const zoneInFlight = new Map()
const OUT_OF_SERVICE_STATUSES = new Set(['OUT_OF_SERVICE', 'OUT_OF_RADIUS', 'OUT_OF_ZONE'])

const getServiceUnavailableMessage = (status) => {
  if (status === 'OUT_OF_RADIUS') return 'Service in this area is currently unavailable at the moment.'
  if (status === 'OUT_OF_ZONE' || status === 'OUT_OF_SERVICE') return 'Service is not available in this zone yet.'
  return ''
}

const roundCoord = (v, digits = 5) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const p = 10 ** digits
  return Math.round(n * p) / p
}

const zoneKeyFromCoords = (lat, lng) => {
  const rLat = roundCoord(lat, 5)
  const rLng = roundCoord(lng, 5)
  if (rLat === null || rLng === null) return null
  return `${rLat},${rLng}`
}

const applyZonePayload = (data, { setZoneId, setZone, setZoneStatus }) => {
  if (data?.status === 'IN_SERVICE' && data.zoneId) {
    setZoneId(data.zoneId)
    setZone(data.zone || null)
    setZoneStatus('IN_SERVICE')
    persistZoneContext({ zoneId: data.zoneId, zone: data.zone || null, status: 'IN_SERVICE' })
  } else {
    const status = data?.status || 'OUT_OF_SERVICE'
    setZoneId(null)
    setZone(data?.zone || null)
    setZoneStatus(status)
    persistZoneContext({ zoneId: null, zone: data?.zone || null, status })
  }
}

export function useZone(location) {
  const [zoneId, setZoneId] = useState(() => readStoredZoneContext().zoneId || null)
  const [zoneStatus, setZoneStatus] = useState(() => {
    const stored = readStoredZoneContext()
    if (stored.zoneId) return 'IN_SERVICE'
    if (stored.zoneStatus) return stored.zoneStatus
    return 'loading'
  })
  const [zone, setZone] = useState(() => readStoredZoneContext().zone || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const prevCoordsRef = useRef({ latitude: null, longitude: null })
  const debounceTimerRef = useRef(null)

  const detectZone = useCallback(async (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setZoneStatus('IDLE')
      setZoneId(null)
      setZone(null)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const key = zoneKeyFromCoords(lat, lng)
      const now = Date.now()
      if (key) {
        const cached = zoneCache.get(key)
        if (cached && now - cached.ts < ZONE_CACHE_TTL_MS) {
          applyZonePayload(cached.payload, { setZoneId, setZone, setZoneStatus })
          return
        }
      }

      const promise = (() => {
        if (key && zoneInFlight.has(key)) return zoneInFlight.get(key)
        const p = zoneAPI
          .detectZone(lat, lng)
          .then((response) => {
            if (!response?.data?.success) {
              throw new Error(response?.data?.message || 'Failed to detect zone')
            }
            return response.data.data
          })
          .finally(() => {
            if (key) zoneInFlight.delete(key)
          })
        if (key) zoneInFlight.set(key, p)
        return p
      })()

      const data = await promise
      if (key) zoneCache.set(key, { ts: now, payload: data })
      applyZonePayload(data, { setZoneId, setZone, setZoneStatus })
    } catch (err) {
      debugError('Error detecting zone:', err)
      setError(err.response?.data?.message || err.message || 'Failed to detect zone')
      setZoneStatus('OUT_OF_SERVICE')
      setZoneId(null)
      setZone(null)
      clearStoredZoneContext()
      persistZoneContext({ status: 'OUT_OF_SERVICE' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const rawLat = location?.latitude !== undefined ? location.latitude : location?.lat
    const rawLng = location?.longitude !== undefined ? location.longitude : location?.lng
    const lat = roundCoord(rawLat, 6)
    const lng = roundCoord(rawLng, 6)

    const coordThreshold = 0.0001
    const prevLat = prevCoordsRef.current.latitude
    const prevLng = prevCoordsRef.current.longitude
    const coordsChanged =
      prevLat === null ||
      prevLng === null ||
      Math.abs(prevLat - (lat || 0)) > coordThreshold ||
      Math.abs(prevLng - (lng || 0)) > coordThreshold

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      if (coordsChanged) {
        prevCoordsRef.current = { latitude: lat, longitude: lng }
        setZoneStatus('loading')
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = setTimeout(() => {
          detectZone(lat, lng)
        }, 350)
      }
    } else {
      const cachedZoneContext = readStoredZoneContext()
      if (cachedZoneContext.zoneId) {
        setZoneId(cachedZoneContext.zoneId)
        setZone(cachedZoneContext.zone || null)
        setZoneStatus(cachedZoneContext.zoneStatus || 'IN_SERVICE')
      } else {
        setZoneStatus('IDLE')
        setZoneId(null)
        setZone(null)
      }
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [location?.latitude, location?.longitude, detectZone])

  const refreshZone = useCallback(() => {
    const lat = location?.latitude
    const lng = location?.longitude
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      detectZone(lat, lng)
    }
  }, [location?.latitude, location?.longitude, detectZone])

  return {
    zoneId,
    zone,
    zoneStatus,
    loading,
    error,
    isInService: zoneStatus === 'IN_SERVICE',
    isOutOfService: OUT_OF_SERVICE_STATUSES.has(zoneStatus),
    isOutOfRadius: zoneStatus === 'OUT_OF_RADIUS',
    isOutOfZone: zoneStatus === 'OUT_OF_ZONE' || zoneStatus === 'OUT_OF_SERVICE',
    serviceUnavailableMessage: getServiceUnavailableMessage(zoneStatus),
    refreshZone,
  }
}

import { useState, useEffect, useRef, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MapPin, ArrowLeft } from "lucide-react"
import { adminAPI } from "@food/api"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { Loader } from "@googlemaps/js-api-loader"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const getZoneCenter = (zone) => {
  const lat = Number(zone?.centerPoint?.latitude)
  const lng = Number(zone?.centerPoint?.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng }
  }

  const coordinates = Array.isArray(zone?.coordinates) ? zone.coordinates : []
  const normalized = coordinates
    .map((coord) => ({
      lat: Number(coord?.latitude ?? coord?.lat),
      lng: Number(coord?.longitude ?? coord?.lng),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))

  if (!normalized.length) return null

  return {
    lat: normalized.reduce((sum, point) => sum + point.lat, 0) / normalized.length,
    lng: normalized.reduce((sum, point) => sum + point.lng, 0) / normalized.length,
  }
}

const getZoneRadiusMeters = (zone) => {
  if (!zone?.isRadiusEnabled) return 0
  const radius = Number(zone?.serviceRadius)
  if (!Number.isFinite(radius) || radius <= 0) return 0
  return zone.unit === "miles" ? radius * 1609.34 : radius * 1000
}

export default function ViewZone() {
  const navigate = useNavigate()
  const { id } = useParams()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const polygonRef = useRef(null)
  const radiusCircleRef = useRef(null)
  const pointMarkersRef = useRef([])

  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("")
  const [mapLoading, setMapLoading] = useState(true)
  const [zone, setZone] = useState(null)
  const [loading, setLoading] = useState(true)

  const zoneId = useMemo(() => zone?._id || null, [zone?._id])
  const coordinatesLength = useMemo(() => zone?.coordinates?.length || 0, [zone?.coordinates?.length])
  const radiusSignature = useMemo(
    () => `${zone?.centerPoint?.latitude || ""}:${zone?.centerPoint?.longitude || ""}:${zone?.serviceRadius || ""}:${zone?.isRadiusEnabled || false}:${zone?.unit || ""}`,
    [zone?.centerPoint?.latitude, zone?.centerPoint?.longitude, zone?.serviceRadius, zone?.isRadiusEnabled, zone?.unit],
  )

  useEffect(() => {
    fetchZone()
    loadGoogleMaps()
  }, [id])

  useEffect(() => {
    if (mapInstanceRef.current && !mapLoading) {
      const timer = setTimeout(() => {
        if (window.google && window.google.maps && mapInstanceRef.current) {
          window.google.maps.event.trigger(mapInstanceRef.current, "resize")
        }
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [mapLoading])

  const fetchZone = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getZoneById(id)
      if (response.data?.success && response.data.data?.zone) {
        setZone(response.data.data.zone)
      }
    } catch (error) {
      debugError("Error fetching zone:", error)
      alert("Failed to load zone")
      navigate("/admin/food/zone-setup")
    } finally {
      setLoading(false)
    }
  }

  const loadGoogleMaps = async () => {
    try {
      const apiKey = await getGoogleMapsApiKey()
      setGoogleMapsApiKey(apiKey || "loaded")

      let retries = 0
      const maxRetries = 50

      while (!window.google && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        retries++
      }

      if (window.google && window.google.maps) {
        setTimeout(() => {
          initializeMap(window.google)
        }, 100)
        return
      }

      if (apiKey) {
        const loader = new Loader({
          apiKey,
          version: "weekly",
          libraries: ["geometry"],
        })

        const google = await loader.load()
        setTimeout(() => {
          initializeMap(google)
        }, 100)
      } else {
        setMapLoading(false)
      }
    } catch (error) {
      debugError("Error loading Google Maps:", error)
      setMapLoading(false)
    }
  }

  const initializeMap = (google) => {
    if (!mapRef.current) {
      setTimeout(() => initializeMap(google), 300)
      return
    }

    const container = mapRef.current
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      setTimeout(() => initializeMap(google), 300)
      return
    }

    try {
      const initialLocation = { lat: 20.5937, lng: 78.9629 }
      const map = new google.maps.Map(container, {
        center: initialLocation,
        zoom: 5,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: google.maps.ControlPosition.TOP_RIGHT,
          mapTypeIds: [google.maps.MapTypeId.ROADMAP, google.maps.MapTypeId.SATELLITE],
        },
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        scrollwheel: true,
        gestureHandling: "greedy",
        disableDoubleClickZoom: false,
      })

      mapInstanceRef.current = map

      google.maps.event.addListenerOnce(map, "idle", () => {
        setMapLoading(false)
        setTimeout(() => {
          if (mapInstanceRef.current) {
            google.maps.event.trigger(mapInstanceRef.current, "resize")
            if (zone && zone.coordinates && zone.coordinates.length >= 3) {
              drawZoneGeometry(google, mapInstanceRef.current, zone)
            }
          }
        }, 200)
      })

      setTimeout(() => {
        setMapLoading(false)
      }, 2000)
    } catch (error) {
      debugError("Error initializing map:", error)
      setMapLoading(false)
    }
  }

  const clearRenderedGeometry = () => {
    if (polygonRef.current) {
      polygonRef.current.setMap(null)
      polygonRef.current = null
    }
    if (radiusCircleRef.current) {
      radiusCircleRef.current.setMap(null)
      radiusCircleRef.current = null
    }
    pointMarkersRef.current.forEach((marker) => marker?.setMap(null))
    pointMarkersRef.current = []
  }

  const drawZoneGeometry = (google, map, zoneDoc) => {
    const coordinates = Array.isArray(zoneDoc?.coordinates) ? zoneDoc.coordinates : []
    if (coordinates.length < 3) return

    try {
      const path = coordinates
        .map((coord) => {
          const lat = typeof coord === "object" ? coord.latitude || coord.lat : null
          const lng = typeof coord === "object" ? coord.longitude || coord.lng : null
          if (lat === null || lng === null) return null
          return new google.maps.LatLng(lat, lng)
        })
        .filter(Boolean)

      if (path.length < 3) return

      clearRenderedGeometry()

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#9333ea",
        strokeOpacity: 0.8,
        strokeWeight: 3,
        fillColor: "#9333ea",
        fillOpacity: 0.35,
        editable: false,
        draggable: false,
        clickable: false,
      })
      polygon.setMap(map)
      polygonRef.current = polygon

      const bounds = new google.maps.LatLngBounds()
      path.forEach((latLng) => bounds.extend(latLng))

      const center = getZoneCenter(zoneDoc)
      const radiusMeters = getZoneRadiusMeters(zoneDoc)
      if (center && radiusMeters > 0) {
        const circle = new google.maps.Circle({
          map,
          center,
          radius: radiusMeters,
          strokeColor: "#16a34a",
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: "#22c55e",
          fillOpacity: 0.1,
          clickable: false,
          zIndex: 0,
        })
        radiusCircleRef.current = circle
        const circleBounds = circle.getBounds()
        if (circleBounds) {
          bounds.union(circleBounds)
        }
      }

      map.fitBounds(bounds)

      pointMarkersRef.current = coordinates
        .map((coord, index) => {
          const lat = typeof coord === "object" ? coord.latitude || coord.lat : null
          const lng = typeof coord === "object" ? coord.longitude || coord.lng : null
          if (lat === null || lng === null) return null
          return new google.maps.Marker({
            position: { lat, lng },
            map,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#9333ea",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
            zIndex: 1000,
            title: `Point ${index + 1}`,
          })
        })
        .filter(Boolean)
    } catch (error) {
      debugError("Error drawing zone geometry:", error)
    }
  }

  useEffect(() => {
    if (zone && zone.coordinates && zone.coordinates.length >= 3 && mapInstanceRef.current && window.google && !mapLoading) {
      setTimeout(() => {
        if (mapInstanceRef.current) {
          drawZoneGeometry(window.google, mapInstanceRef.current, zone)
        }
      }, 500)
    }
  }, [zoneId, coordinatesLength, radiusSignature, mapLoading])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading zone...</p>
        </div>
      </div>
    )
  }

  if (!zone) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600">Zone not found</p>
          <button
            onClick={() => navigate("/admin/food/zone-setup")}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Zones
          </button>
        </div>
      </div>
    )
  }

  const center = getZoneCenter(zone)
  const radiusLabel = zone.isRadiusEnabled && zone.serviceRadius
    ? `${zone.serviceRadius} ${zone.unit === "miles" ? "mi" : "km"}`
    : "Disabled"

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate("/admin/food/zone-setup")}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">View Zone</h1>
              <p className="text-sm text-slate-600">{zone.name || zone.serviceLocation}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Zone Details</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Name</label>
                  <p className="text-sm text-slate-900">{zone.name || "N/A"}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Country</label>
                  <p className="text-sm text-slate-900">{zone.country || "N/A"}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Unit</label>
                  <p className="text-sm text-slate-900">{zone.unit || "kilometer"}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Radius</label>
                  <p className="text-sm text-slate-900">{radiusLabel}</p>
                </div>

                {center && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Center Point</label>
                    <p className="text-sm text-slate-900">Lat: {center.lat.toFixed(6)}</p>
                    <p className="text-sm text-slate-900">Lng: {center.lng.toFixed(6)}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Status</label>
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                    zone.isActive ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-800"
                  }`}>
                    {zone.isActive ? "Active" : "Inactive"}
                  </span>
                </div>

                {zone.coordinates && zone.coordinates.length > 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Points</label>
                    <p className="text-sm text-slate-900">{zone.coordinates.length}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Zone Map</h2>

              <div className="relative" style={{ height: "600px", minHeight: "600px" }}>
                <div
                  ref={mapRef}
                  className="w-full h-full rounded-lg"
                  style={{
                    width: "100%",
                    height: "600px",
                    minHeight: "600px",
                    backgroundColor: "#e5e7eb",
                    position: "relative",
                  }}
                />

                {mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg" style={{ zIndex: 10, pointerEvents: "none" }}>
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-slate-600">Loading map...</p>
                    </div>
                  </div>
                )}

                {!googleMapsApiKey && !mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg" style={{ zIndex: 10 }}>
                    <div className="text-center p-6">
                      <MapPin className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-sm text-slate-600">Google Maps API key not found</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

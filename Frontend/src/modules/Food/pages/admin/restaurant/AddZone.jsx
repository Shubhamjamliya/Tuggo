import { useState, useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MapPin, ArrowLeft, Save, X, Shapes, Search, LocateFixed } from "lucide-react"
import { adminAPI } from "@food/api"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { Loader } from "@googlemaps/js-api-loader"

const MIN_POINTS = 3
const MAX_POINTS = 10

const orderPointsRadially = (pts) => {
  const points = pts
    .map((p) => ({
      lat: typeof p.lat === "function" ? p.lat() : p.lat,
      lng: typeof p.lng === "function" ? p.lng() : p.lng,
    }))
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")

  if (points.length < 3) return points

  const cx = points.reduce((sum, p) => sum + p.lng, 0) / points.length
  const cy = points.reduce((sum, p) => sum + p.lat, 0) / points.length

  return [...points].sort(
    (a, b) =>
      Math.atan2(a.lat - cy, a.lng - cx) - Math.atan2(b.lat - cy, b.lng - cx),
  )
}

const normalizeCoordinate = (coord) => ({
  latitude: Number(coord?.latitude ?? coord?.lat ?? 0),
  longitude: Number(coord?.longitude ?? coord?.lng ?? 0),
})

const computeCenterPoint = (coords = []) => {
  const normalized = coords
    .map(normalizeCoordinate)
    .filter(
      (point) =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    )

  if (!normalized.length) return null

  return {
    latitude: Number(
      (
        normalized.reduce((sum, point) => sum + point.latitude, 0) /
        normalized.length
      ).toFixed(6),
    ),
    longitude: Number(
      (
        normalized.reduce((sum, point) => sum + point.longitude, 0) /
        normalized.length
      ).toFixed(6),
    ),
  }
}

const getDisplayCenterPoint = (savedCenterPoint, coords) => {
  const lat = Number(savedCenterPoint?.latitude)
  const lng = Number(savedCenterPoint?.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
    }
  }
  return computeCenterPoint(coords)
}

const toCircleRadiusMeters = (radiusValue, unit) => {
  const numeric = Number(radiusValue)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return unit === "miles" ? numeric * 1609.34 : numeric * 1000
}

export default function AddZone() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditMode = !!id && !window.location.pathname.includes("/view/")

  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const mapClickListenerRef = useRef(null)
  const drawPointsRef = useRef([])
  const isDrawingRef = useRef(false)
  const polygonRef = useRef(null)
  const circleRef = useRef(null)
  const pathMarkersRef = useRef([])
  const existingZonesPolygonsRef = useRef([])
  const autocompleteInputRef = useRef(null)
  const autocompleteRef = useRef(null)

  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("")
  const [mapLoading, setMapLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [existingZones, setExistingZones] = useState([])
  const [locationSearch, setLocationSearch] = useState("")
  const [coordinates, setCoordinates] = useState([])
  const [formData, setFormData] = useState({
    country: "India",
    zoneName: "",
    unit: "kilometer",
    isRadiusEnabled: false,
    serviceRadius: "",
    centerPoint: null,
  })

  const previewCenterPoint = getDisplayCenterPoint(formData.centerPoint, coordinates)

  useEffect(() => {
    fetchExistingZones()
    loadGoogleMaps()
    if (isEditMode && id) fetchZone()
  }, [id, isEditMode])

  useEffect(() => {
    if (formData.country === "India" && mapInstanceRef.current) {
      mapInstanceRef.current.setCenter({ lat: 20.5937, lng: 78.9629 })
      mapInstanceRef.current.setZoom(5)
    }
  }, [formData.country])

  useEffect(() => {
    let intervalId = null

    const initAutocomplete = () => {
      if (
        mapInstanceRef.current &&
        autocompleteInputRef.current &&
        window.google?.maps?.places &&
        !autocompleteRef.current
      ) {
        const autocomplete = new window.google.maps.places.Autocomplete(
          autocompleteInputRef.current,
          {
            componentRestrictions: { country: "in" },
          },
        )
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace()
          if (place.geometry?.location && mapInstanceRef.current) {
            mapInstanceRef.current.setCenter(place.geometry.location)
            mapInstanceRef.current.setZoom(15)
            setLocationSearch(place.formatted_address || place.name || "")
          }
        })
        autocompleteRef.current = autocomplete
        if (intervalId) clearInterval(intervalId)
      }
    }

    if (!mapLoading) {
      initAutocomplete()
      if (!autocompleteRef.current) {
        intervalId = setInterval(initAutocomplete, 500)
      }
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
      if (autocompleteRef.current) {
        if (window.google?.maps?.event) {
          window.google.maps.event.clearInstanceListeners(autocompleteRef.current)
        }
        document.querySelectorAll(".pac-container").forEach((el) => el.remove())
        autocompleteRef.current = null
      }
    }
  }, [mapLoading])

  useEffect(() => {
    if (
      isEditMode &&
      coordinates.length >= 3 &&
      mapInstanceRef.current &&
      window.google &&
      !mapLoading
    ) {
      setTimeout(() => {
        if (mapInstanceRef.current && window.google) {
          isDrawingRef.current = false
          setIsDrawing(false)
          drawEditablePolygon(window.google, mapInstanceRef.current, coordinates)
        }
      }, 500)
    }
  }, [isEditMode, coordinates.length, mapLoading])

  useEffect(() => {
    updateRadiusPreview()
  }, [
    formData.isRadiusEnabled,
    formData.serviceRadius,
    formData.unit,
    formData.centerPoint?.latitude,
    formData.centerPoint?.longitude,
    coordinates,
    mapLoading,
  ])

  const fetchExistingZones = async () => {
    try {
      const response = await adminAPI.getZones({ limit: 1000 })
      if (response.data?.success && response.data.data?.zones) {
        const zones = isEditMode && id
          ? response.data.data.zones.filter((zone) => zone._id !== id)
          : response.data.data.zones
        setExistingZones(zones)
      }
    } catch (_) {
      setExistingZones([])
    }
  }

  const fetchZone = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getZoneById(id)
      if (response.data?.success && response.data.data?.zone) {
        const zoneData = response.data.data.zone
        setFormData({
          country: zoneData.country || "India",
          zoneName: zoneData.name || zoneData.zoneName || "",
          unit: zoneData.unit || "kilometer",
          isRadiusEnabled: Boolean(zoneData.isRadiusEnabled),
          serviceRadius:
            zoneData.serviceRadius === null || zoneData.serviceRadius === undefined
              ? ""
              : String(zoneData.serviceRadius),
          centerPoint: zoneData.centerPoint || null,
        })
        if (Array.isArray(zoneData.coordinates) && zoneData.coordinates.length > 0) {
          setCoordinates(zoneData.coordinates)
        }
      }
    } catch (_) {
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
      while (!window.google && retries < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        retries += 1
      }

      if (window.google?.maps) {
        initializeMap(window.google)
        return
      }

      if (apiKey) {
        const loader = new Loader({
          apiKey,
          version: "weekly",
          libraries: ["places", "geometry"],
        })
        const google = await loader.load()
        initializeMap(google)
      } else {
        setMapLoading(false)
      }
    } catch (_) {
      setMapLoading(false)
    }
  }

  const renderVertexMarkers = (google, map, latLngs) => {
    pathMarkersRef.current.forEach((marker) => marker.setMap(null))
    pathMarkersRef.current = latLngs.map(
      (latLng, index) =>
        new google.maps.Marker({
          position: latLng,
          map,
          clickable: false,
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
        }),
    )
  }

  const syncCenterPointFromCoordinates = (coords) => {
    const nextCenterPoint = computeCenterPoint(coords)
    setFormData((prev) => ({ ...prev, centerPoint: nextCenterPoint }))
  }

  const renderDrawingPolygon = (google, map) => {
    const points = drawPointsRef.current
    if (polygonRef.current) {
      polygonRef.current.setMap(null)
      polygonRef.current = null
    }

    const ordered =
      points.length >= 3
        ? orderPointsRadially(points)
        : points.map((p) => ({ lat: p.lat(), lng: p.lng() }))

    if (ordered.length >= 2) {
      polygonRef.current = new google.maps.Polygon({
        paths: ordered,
        fillColor: "#9333ea",
        fillOpacity: 0.35,
        strokeColor: "#9333ea",
        strokeWeight: 2,
        clickable: false,
        editable: false,
        zIndex: 1,
      })
      polygonRef.current.setMap(map)
    }

    renderVertexMarkers(google, map, points)
    const nextCoordinates = ordered.map((point) => ({
      latitude: Number(point.lat.toFixed(6)),
      longitude: Number(point.lng.toFixed(6)),
    }))
    setCoordinates(nextCoordinates)
    syncCenterPointFromCoordinates(nextCoordinates)
  }

  const drawEditablePolygon = (google, map, coords) => {
    const path = coords.map(
      (coord) => new google.maps.LatLng(coord.latitude, coord.longitude),
    )
    if (polygonRef.current) {
      polygonRef.current.setMap(null)
      polygonRef.current = null
    }
    pathMarkersRef.current.forEach((marker) => marker.setMap(null))
    pathMarkersRef.current = []

    const polygon = new google.maps.Polygon({
      paths: path,
      strokeColor: "#9333ea",
      strokeOpacity: 0.8,
      strokeWeight: 3,
      fillColor: "#9333ea",
      fillOpacity: 0.35,
      editable: true,
      draggable: false,
      clickable: false,
    })
    polygon.setMap(map)
    polygonRef.current = polygon

    const sync = () => {
      const polygonPath = polygon.getPath()
      const nextCoordinates = []
      polygonPath.forEach((latLng) => {
        nextCoordinates.push({
          latitude: Number(latLng.lat().toFixed(6)),
          longitude: Number(latLng.lng().toFixed(6)),
        })
      })
      setCoordinates(nextCoordinates)
      syncCenterPointFromCoordinates(nextCoordinates)
    }

    const polygonPath = polygon.getPath()
    google.maps.event.addListener(polygonPath, "set_at", sync)
    google.maps.event.addListener(polygonPath, "insert_at", sync)
    google.maps.event.addListener(polygonPath, "remove_at", sync)

    const bounds = new google.maps.LatLngBounds()
    path.forEach((latLng) => bounds.extend(latLng))
    map.fitBounds(bounds)
  }

  const finishDrawing = () => {
    const google = window.google
    const map = mapInstanceRef.current
    if (!google || !map) return false

    const points = drawPointsRef.current
    if (points.length < MIN_POINTS) {
      alert(`Please click at least ${MIN_POINTS} points on the map.`)
      return false
    }

    const ordered = orderPointsRadially(points)
    const nextCoordinates = ordered.map((point) => ({
      latitude: Number(point.lat.toFixed(6)),
      longitude: Number(point.lng.toFixed(6)),
    }))
    setCoordinates(nextCoordinates)
    syncCenterPointFromCoordinates(nextCoordinates)
    drawEditablePolygon(google, map, nextCoordinates)
    return true
  }

  const toggleDrawingMode = () => {
    const google = window.google
    const map = mapInstanceRef.current
    if (!google || !map) {
      alert("Map is still loading.")
      return
    }

    if (isDrawing) {
      if (finishDrawing() === false) return
      isDrawingRef.current = false
      setIsDrawing(false)
      map.setOptions({ draggableCursor: null })
      existingZonesPolygonsRef.current.forEach((polygon) => polygon?.setOptions?.({ clickable: true }))
    } else {
      clearDrawing()
      drawPointsRef.current = []
      isDrawingRef.current = true
      setIsDrawing(true)
      map.setOptions({ draggableCursor: "crosshair" })
      existingZonesPolygonsRef.current.forEach((polygon) => polygon?.setOptions?.({ clickable: false }))
    }
  }

  const clearDrawing = () => {
    drawPointsRef.current = []
    if (polygonRef.current) {
      polygonRef.current.setMap(null)
      polygonRef.current = null
    }
    pathMarkersRef.current.forEach((marker) => marker.setMap(null))
    pathMarkersRef.current = []
    setCoordinates([])
    setFormData((prev) => ({ ...prev, centerPoint: null }))
  }

  const updateRadiusPreview = () => {
    if (!window.google || !mapInstanceRef.current) return

    if (circleRef.current) {
      circleRef.current.setMap(null)
      circleRef.current = null
    }

    if (!formData.isRadiusEnabled) return
    if (!previewCenterPoint) return

    const radiusMeters = toCircleRadiusMeters(formData.serviceRadius, formData.unit)
    if (radiusMeters <= 0) return

    circleRef.current = new window.google.maps.Circle({
      map: mapInstanceRef.current,
      center: {
        lat: previewCenterPoint.latitude,
        lng: previewCenterPoint.longitude,
      },
      radius: radiusMeters,
      strokeColor: "#16a34a",
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: "#22c55e",
      fillOpacity: 0.12,
      clickable: false,
      zIndex: 2,
    })
  }

  const initializeMap = (google) => {
    if (!mapRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: 20.5937, lng: 78.9629 },
      zoom: 5,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.TOP_RIGHT,
        mapTypeIds: [
          google.maps.MapTypeId.ROADMAP,
          google.maps.MapTypeId.SATELLITE,
        ],
      },
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      scrollwheel: true,
      gestureHandling: "greedy",
      disableDoubleClickZoom: false,
      clickableIcons: false,
    })

    mapInstanceRef.current = map

    mapClickListenerRef.current = google.maps.event.addListener(map, "click", (event) => {
      if (!isDrawingRef.current) return
      if (drawPointsRef.current.length >= MAX_POINTS) {
        alert(`You can add at most ${MAX_POINTS} points. Click \"Finish Drawing\" to complete.`)
        return
      }
      drawPointsRef.current.push(event.latLng)
      renderDrawingPolygon(google, map)
    })

    setMapLoading(false)

    if (isEditMode && coordinates.length >= 3) {
      setTimeout(() => {
        if (mapInstanceRef.current && window.google) {
          drawEditablePolygon(window.google, mapInstanceRef.current, coordinates)
        }
      }, 500)
    }
  }

  const drawExistingZonesOnMap = (google, map) => {
    if (!existingZones.length) return

    existingZonesPolygonsRef.current.forEach((polygon) => polygon?.setMap(null))
    existingZonesPolygonsRef.current = []

    existingZones.forEach((zone) => {
      if (!Array.isArray(zone.coordinates) || zone.coordinates.length < 3) return

      const path = zone.coordinates
        .map((coord) => {
          const lat = typeof coord === "object" ? coord.latitude ?? coord.lat : null
          const lng = typeof coord === "object" ? coord.longitude ?? coord.lng : null
          if (lat === null || lng === null) return null
          return new google.maps.LatLng(lat, lng)
        })
        .filter(Boolean)

      if (path.length < 3) return

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#3b82f6",
        strokeOpacity: 0.6,
        strokeWeight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 0.15,
        editable: false,
        draggable: false,
        clickable: !isDrawingRef.current,
        zIndex: 0,
      })

      polygon.setMap(map)
      existingZonesPolygonsRef.current.push(polygon)

      const radiusText = zone.isRadiusEnabled && zone.serviceRadius
        ? `<br/><small>Radius: ${zone.serviceRadius} ${zone.unit === "miles" ? "mi" : "km"}</small>`
        : ""

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px;">
            <strong>${zone.name || zone.zoneName || "Unnamed Zone"}</strong><br/>
            <small>Country: ${zone.country || "N/A"}</small>${radiusText}
          </div>
        `,
      })

      polygon.addListener("click", () => {
        infoWindow.setPosition(polygon.getPath().getAt(0))
        infoWindow.open(map)
      })
    })
  }

  useEffect(() => {
    if (!mapLoading && mapInstanceRef.current && existingZones.length > 0 && window.google) {
      drawExistingZonesOnMap(window.google, mapInstanceRef.current)
    }
  }, [existingZones, mapLoading])

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!formData.zoneName || !formData.country || coordinates.length < 3) return

    try {
      setLoading(true)
      const validCoordinates = coordinates.map(normalizeCoordinate)
      const centerPoint = getDisplayCenterPoint(formData.centerPoint, validCoordinates)

      const zoneData = {
        name: formData.zoneName,
        zoneName: formData.zoneName,
        country: formData.country,
        unit: formData.unit || "kilometer",
        coordinates: validCoordinates,
        centerPoint,
        isRadiusEnabled: Boolean(formData.isRadiusEnabled),
        serviceRadius:
          formData.serviceRadius === "" ? null : Number(formData.serviceRadius),
        isActive: true,
      }

      if (isEditMode && id) {
        await adminAPI.updateZone(id, zoneData)
        alert("Zone updated successfully!")
      } else {
        await adminAPI.createZone(zoneData)
        alert("Zone created successfully!")
      }
      navigate("/admin/food/zone-setup")
    } catch (error) {
      let errorMessage = "Failed to save zone. Please try again."
      if (error.code === "ERR_NETWORK" || error.message === "Network Error" || !error.response) {
        errorMessage = "Cannot connect to server."
      } else if (error.response) {
        errorMessage = error.response.data?.message || error.response.data?.error || error.message
      } else {
        errorMessage = error.message || errorMessage
      }
      alert(errorMessage)
    } finally {
      setLoading(false)
    }
  }

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
              <h1 className="text-2xl font-bold text-slate-900">
                {isEditMode ? "Edit Zone" : "Add New Zone"}
              </h1>
              <p className="text-sm text-slate-600">
                {isEditMode
                  ? "Update delivery zone and radius without redrawing every day"
                  : "Create a delivery zone and optional center radius for service control"}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Zone Details</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Country <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.country}
                      onChange={(e) => handleInputChange("country", e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="India">India</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Zone name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.zoneName}
                      onChange={(e) => handleInputChange("zoneName", e.target.value)}
                      placeholder="Enter zone name"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Unit <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.unit}
                      onChange={(e) => handleInputChange("unit", e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="kilometer">Kilometers (km)</option>
                      <option value="miles">Miles (mi)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Center Radius Control</h2>
                    <p className="text-sm text-slate-600 mt-1">
                      Use the zone center plus radius to expand or reduce service coverage without redrawing the polygon.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={formData.isRadiusEnabled}
                      onChange={(e) => handleInputChange("isRadiusEnabled", e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Enable radius
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Radius ({formData.unit === "miles" ? "mi" : "km"})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={formData.serviceRadius}
                      onChange={(e) => handleInputChange("serviceRadius", e.target.value)}
                      placeholder="Example: 5"
                      disabled={!formData.isRadiusEnabled}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-2">
                      <LocateFixed className="w-4 h-4" />
                      Auto center from polygon
                    </div>
                    {previewCenterPoint ? (
                      <div className="space-y-1 text-sm text-slate-600">
                        <p>Lat: <span className="font-medium text-slate-900">{previewCenterPoint.latitude}</span></p>
                        <p>Lng: <span className="font-medium text-slate-900">{previewCenterPoint.longitude}</span></p>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Draw the zone polygon to calculate the center.</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Customer service check will accept this zone when the location is inside the polygon or inside this radius.
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Draw Zone on Map</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleDrawingMode}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      isDrawing
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    <Shapes className="w-4 h-4" />
                    <span>{isDrawing ? "Finish Drawing" : "Start Drawing"}</span>
                  </button>
                  {coordinates.length > 0 && (
                    <button
                      type="button"
                      onClick={clearDrawing}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      <X className="w-4 h-4" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              {isDrawing && (
                <p className="text-sm text-slate-600 mb-4 bg-blue-50 p-3 rounded border border-blue-100">
                  Click on the map to add points ({MIN_POINTS}-{MAX_POINTS}), then click <b>Finish Drawing</b>.
                </p>
              )}

              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    ref={autocompleteInputRef}
                    type="text"
                    placeholder="Search location on map..."
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {coordinates.length > 0 && (
                  <p className="text-xs text-slate-600 mt-2">
                    Points drawn: <strong>{coordinates.length}</strong>
                    {coordinates.length < MIN_POINTS && (
                      <span className="text-red-600 ml-2">(Minimum {MIN_POINTS} points required)</span>
                    )}
                  </p>
                )}
              </div>

              <div className="relative" style={{ height: "600px" }}>
                <div ref={mapRef} className="w-full h-full rounded-lg" />
                {mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
                      <p className="text-slate-600">Loading map...</p>
                    </div>
                  </div>
                )}
                {!googleMapsApiKey && !mapLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100 rounded-lg">
                    <div className="text-center p-6">
                      <MapPin className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                      <p className="text-sm text-slate-600">Google Maps API key not found</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={() => navigate("/admin/food/zone-setup")}
              className="px-6 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || coordinates.length < MIN_POINTS || !formData.zoneName || !formData.country || isDrawing}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Zone</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { 
  GoogleMap, 
  Marker, 
  DirectionsService, 
  Polygon,
  Polyline,
  useJsApiLoader,
  OverlayView
} from '@react-google-maps/api';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { zoneAPI } from '@food/api';
import { useGoogleMapsApiKey } from '@food/utils/googleMapsApiKey';

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  inset: 0
};

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  scaleControl: false,
  streetViewControl: false,
  rotateControl: true,
  fullscreenControl: false,
  styles: [
    { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
    { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
    { featureType: "poi", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] }
  ]
};
const LIBRARIES = ['places', 'geometry'];

export const LiveMap = ({ onMapClick, onMapLoad, onPathReceived, onPolylineReceived, zoom = 12 }) => {
  const { riderLocation, activeOrder, tripStatus } = useDeliveryStore();
  const googleMapsApiKey = useGoogleMapsApiKey();
  
  const { isLoaded, loadError } = useJsApiLoader(
    {
      id: 'delivery-live-map',
      googleMapsApiKey: googleMapsApiKey || '__pending__',
      libraries: LIBRARIES,
    },
    [googleMapsApiKey]
  );

  const [directions, setDirections] = useState(null);
  const [baselineDirections, setBaselineDirections] = useState(null);
  const [baselineFailed, setBaselineFailed] = useState(false);
  const [map, setMapInternal] = useState(null);
  const [zones, setZones] = useState([]);
  const [lastDirectionsAt, setLastDirectionsAt] = useState(0);

  const handleMapLoad = (mapInstance) => {
    mapInstance.setOptions({
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      scaleControl: false,
      streetViewControl: false,
      rotateControl: true, // Enabled for front-view navigation
      fullscreenControl: false,
      tilt: 45, // 3D Perspective
    });
    setMapInternal(mapInstance);
    if (onMapLoad) onMapLoad(mapInstance);
  };

  useEffect(() => {
    setLastDirectionsAt(0);
    setDirections(null);
    setBaselineDirections(null);
    setBaselineFailed(false);
  }, [tripStatus, activeOrder?._id]);

  const parsePoint = useCallback((raw) => {
    if (!raw) return null;

    const nestedLocation = raw.location && typeof raw.location === 'object' ? raw.location : null;
    const locationCandidate = nestedLocation || raw;

    const coords = Array.isArray(locationCandidate?.coordinates)
      ? locationCandidate.coordinates
      : Array.isArray(locationCandidate?.location?.coordinates)
        ? locationCandidate.location.coordinates
        : null;

    if (coords?.length >= 2) {
      const lng = parseFloat(coords[0]);
      const lat = parseFloat(coords[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }

    const lat = parseFloat(
      locationCandidate?.lat ??
      locationCandidate?.latitude ??
      locationCandidate?.location?.lat ??
      locationCandidate?.location?.latitude
    );
    const lng = parseFloat(
      locationCandidate?.lng ??
      locationCandidate?.longitude ??
      locationCandidate?.location?.lng ??
      locationCandidate?.location?.longitude
    );

    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  }, []);

  const restaurantPoint = useMemo(
    () => parsePoint(activeOrder?.restaurantLocation) || parsePoint(activeOrder?.restaurantId) || parsePoint(activeOrder?.restaurant),
    [activeOrder?.restaurantLocation, activeOrder?.restaurantId, activeOrder?.restaurant, parsePoint],
  );
  const customerPoint = useMemo(
    () =>
      parsePoint(activeOrder?.customerLocation) ||
      parsePoint(activeOrder?.deliveryAddress) ||
      parsePoint(activeOrder?.customer_address) ||
      parsePoint(activeOrder?.user),
    [activeOrder?.customerLocation, activeOrder?.deliveryAddress, activeOrder?.customer_address, activeOrder?.user, parsePoint],
  );

  const targetLocation = useMemo(() => {
    if (!activeOrder) return null;
    if (tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') {
      return restaurantPoint;
    }
    if (tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP') {
      return customerPoint;
    }
    return null;
  }, [activeOrder, tripStatus, restaurantPoint, customerPoint]);

  const parsedRiderLocation = useMemo(() => {
    if (!riderLocation) return null;
    const lat = parseFloat(riderLocation.lat || riderLocation.latitude);
    const lng = parseFloat(riderLocation.lng || riderLocation.longitude);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng, heading: parseFloat(riderLocation.heading || 0) } : null;
  }, [riderLocation]);

  useEffect(() => { if (map) map.setZoom(zoom); }, [zoom, map]);

  const isOffCurrentRoute = useMemo(() => {
    if (!directions || !parsedRiderLocation || !window.google?.maps?.geometry) return false;
    const fullPath = directions.routes?.[0]?.overview_path;
    if (!fullPath?.length) return false;

    const riderLatLng = new window.google.maps.LatLng(
      parsedRiderLocation.lat,
      parsedRiderLocation.lng,
    );
    let minDistance = Infinity;
    for (let i = 0; i < fullPath.length; i += 1) {
      const distance = window.google.maps.geometry.spherical.computeDistanceBetween(
        riderLatLng,
        fullPath[i],
      );
      if (distance < minDistance) minDistance = distance;
    }
    return minDistance > 100;
  }, [directions, parsedRiderLocation]);

  const shouldUpdateRoute = useMemo(() => {
    const now = Date.now();
    if (!directions) return true;
    if (isOffCurrentRoute) return true;

    let throttleMs = 20000;
    if (parsedRiderLocation && targetLocation && window.google) {
      try {
        const p1 = new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng);
        const p2 = new window.google.maps.LatLng(targetLocation.lat, targetLocation.lng);
        const dist = window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
        if (dist > 2000) throttleMs = 60000;
        else if (dist > 500) throttleMs = 20000;
        else throttleMs = 5000;
      } catch (e) {}
    }
    return (now - lastDirectionsAt) >= throttleMs;
  }, [lastDirectionsAt, directions, parsedRiderLocation, targetLocation, isOffCurrentRoute]);

  useEffect(() => {
    if (directions && onPathReceived) {
      const path = directions.routes[0]?.overview_path;
      if (path) {
        const simplePath = path.map(p => ({
          lat: typeof p.lat === 'function' ? p.lat() : (p.lat || p.latitude),
          lng: typeof p.lng === 'function' ? p.lng() : (p.lng || p.longitude)
        }));
        onPathReceived(simplePath);
      }
    }
  }, [directions, onPathReceived]);

  const directionsCallback = useCallback((result, status) => {
    // Always update lastDirectionsAt to prevent infinite loop on failure
    setLastDirectionsAt(Date.now());
    if (status === 'OK' && result) {
      setDirections(result);
      const rawPolyline = result.routes?.[0]?.overview_polyline;
      const encodedPolyline =
        typeof rawPolyline === 'string' ? rawPolyline : rawPolyline?.points || '';
      if (encodedPolyline && onPolylineReceived) onPolylineReceived(encodedPolyline);
    }
  }, [onPolylineReceived]);

  const baselineDirectionsCallback = useCallback((result, status) => {
    if (status === 'OK' && result) {
      setBaselineDirections(result);
    } else {
      setBaselineFailed(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const response = await zoneAPI.getPublicZones();
        if (response?.data?.success && response.data.data?.zones) {
          const formattedZones = response.data.data.zones.map(zone => ({
            ...zone,
            paths: (zone.coordinates || []).map(coord => ({ lat: coord.latitude, lng: coord.longitude }))
          })).filter(z => z.paths.length >= 3);
          setZones(formattedZones);
        }
      } catch (err) {}
    })();
  }, []);

  const restaurantMarkerUrl = useMemo(() => {
    if (!activeOrder) return 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';
    return activeOrder.restaurantImage || activeOrder.restaurant?.logo || activeOrder.restaurant?.profileImage || 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';
  }, [activeOrder]);

  const customerMarkerUrl = useMemo(() => {
    if (!activeOrder) return 'https://cdn-icons-png.flaticon.com/512/1275/1275302.png';
    return activeOrder.customerImage || activeOrder.user?.logo || activeOrder.user?.profileImage || 'https://cdn-icons-png.flaticon.com/512/1275/1275302.png';
  }, [activeOrder]);

  const lastCenteredPosRef = useRef(null);
  const lastBoundsUpdateRef = useRef(0);
  useEffect(() => {
    if (!map || !window.google?.maps) return;

    const hasAnchors = restaurantPoint || customerPoint;
    if (!hasAnchors && !parsedRiderLocation) return;

    const now = Date.now();
    if (now - lastBoundsUpdateRef.current < 12000) return;
    lastBoundsUpdateRef.current = now;

    if (!hasAnchors && parsedRiderLocation) {
      map.panTo(parsedRiderLocation);
    } else {
      const bounds = new window.google.maps.LatLngBounds();
      if (restaurantPoint) bounds.extend(restaurantPoint);
      if (customerPoint) bounds.extend(customerPoint);
      if (parsedRiderLocation) bounds.extend(parsedRiderLocation);

      map.fitBounds(bounds, { top: 70, right: 70, bottom: 120, left: 70 });
    }

    if (parsedRiderLocation) {
      lastCenteredPosRef.current = parsedRiderLocation;
    }
  }, [map, parsedRiderLocation, restaurantPoint, customerPoint]);

  const { remainingPath, traveledPath } = useMemo(() => {
    if (!directions || !parsedRiderLocation || !window.google?.maps) return { remainingPath: [], traveledPath: [] };
    
    const fullPath = directions.routes[0].overview_path;
    if (!fullPath || fullPath.length === 0) return { remainingPath: [], traveledPath: [] };

    let closestIndex = 0;
    let minDistance = Infinity;
    const riderLatLng = new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng);

    for (let i = 0; i < fullPath.length; i++) {
      const distance = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, fullPath[i]);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    let startIndex = closestIndex;
    if (closestIndex < fullPath.length - 1) {
      const distToCurrent = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, fullPath[closestIndex]);
      const distToNext = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, fullPath[closestIndex + 1]);
      const segmentLen = window.google.maps.geometry.spherical.computeDistanceBetween(fullPath[closestIndex], fullPath[closestIndex + 1]);
      
      if (distToNext < segmentLen && distToNext < distToCurrent) {
        startIndex = closestIndex + 1;
      }
    }

    const riderPoint = { lat: parsedRiderLocation.lat, lng: parsedRiderLocation.lng };
    const toObj = (p) => ({
      lat: typeof p.lat === 'function' ? p.lat() : p.lat,
      lng: typeof p.lng === 'function' ? p.lng() : p.lng
    });

    const traveled = fullPath.slice(0, startIndex).map(toObj);
    traveled.push(riderPoint);

    const remaining = [riderPoint, ...fullPath.slice(startIndex).map(toObj)];

    return { remainingPath: remaining, traveledPath: traveled };
  }, [directions, parsedRiderLocation]);

  if (loadError) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-red-500 font-bold">Map Load Error</div>;
  if (!isLoaded) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50"><div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  const directionsServiceOptions = (parsedRiderLocation && targetLocation) ? {
    origin: parsedRiderLocation,
    destination: targetLocation,
    travelMode: 'DRIVING',
  } : null;

  const baselineServiceOptions = (restaurantPoint && customerPoint) ? {
    origin: restaurantPoint,
    destination: customerPoint,
    travelMode: 'DRIVING',
  } : null;

  const defaultCenter = { lat: 22.7196, lng: 75.8577 }; // Center on Indore as fallback

  return (
    <div className="absolute inset-0 z-0 text-gray-900 overflow-hidden flex flex-col">
      <GoogleMap
        onLoad={handleMapLoad}
        mapContainerStyle={mapContainerStyle}
        center={parsedRiderLocation || targetLocation || defaultCenter}
        zoom={zoom}
        heading={parsedRiderLocation?.heading || 0}
        tilt={45}
        onClick={(e) => onMapClick?.(e.latLng.lat(), e.latLng.lng())}
        options={mapOptions}
      >
        {directionsServiceOptions && shouldUpdateRoute && (
          <DirectionsService options={directionsServiceOptions} callback={directionsCallback} />
        )}

        {baselineServiceOptions && !baselineDirections && !baselineFailed && (
          <DirectionsService options={baselineServiceOptions} callback={baselineDirectionsCallback} />
        )}

        {traveledPath.length > 0 && (
          <Polyline 
            path={traveledPath} 
            options={{ 
              strokeColor: '#9ca3af', 
              strokeOpacity: 0.5, 
              strokeWeight: 4, 
              zIndex: 10,
              icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 },
                offset: '0',
                repeat: '10px'
              }]
            }} 
          />
        )}

        {remainingPath.length > 0 && (
          <Polyline 
            path={remainingPath} 
            options={{ 
              strokeColor: '#3b82f6', 
              strokeOpacity: 0.9, 
              strokeWeight: 8, 
              zIndex: 12 
            }} 
          />
        )}

        {parsedRiderLocation && (
          <OverlayView position={parsedRiderLocation} mapPaneName={OverlayView.MARKER_LAYER}>
            <div style={{ transform: `translate(-50%, -50%) rotate(${parsedRiderLocation.heading || 0}deg)`, transition: 'transform 0.5s linear' }} className="relative w-[72px] h-[72px]">
              <img src="/MapRider.png" alt="Rider" className="w-full h-full object-contain" />
            </div>
          </OverlayView>
        )}

        {restaurantPoint && (
          <Marker
            position={restaurantPoint}
            icon={{
              url: restaurantMarkerUrl,
              scaledSize: new window.google.maps.Size(44, 44),
              anchor: new window.google.maps.Point(22, 22)
            }}
          />
        )}

        {customerPoint && (
          <Marker
            position={customerPoint}
            icon={{
              url: customerMarkerUrl,
              scaledSize: new window.google.maps.Size(44, 44),
              anchor: new window.google.maps.Point(22, 22)
            }}
          />
        )}

        {zones.map((zone) => (
          <Polygon key={zone._id} paths={zone.paths} options={{ fillColor: "#22c55e", fillOpacity: 0.03, strokeColor: "#22c55e", strokeOpacity: 0.1, strokeWeight: 1, zIndex: 1 }} />
        ))}
      </GoogleMap>
    </div>
  );
};

export default LiveMap;

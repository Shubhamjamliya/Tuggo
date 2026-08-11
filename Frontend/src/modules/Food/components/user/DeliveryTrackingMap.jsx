import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  GoogleMap, 
  useJsApiLoader, 
  OverlayView, 
  DirectionsService, 
  Polyline
} from '@react-google-maps/api';
import bikeLogo from '@food/assets/bikelogo.png';
import useOrderLocationSubscription from '@food/hooks/useOrderLocationSubscription';
import { useGoogleMapsApiKey } from '@food/utils/googleMapsApiKey';
import { subscribeLocationUpdates } from '@food/utils/userSocketManager';
import { motion, AnimatePresence } from 'framer-motion';
import { Navigation } from 'lucide-react';

const MAP_LIBRARIES = Object.freeze(['geometry', 'places']);

const RIDER_BIKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
  <circle cx="30" cy="30" r="28" fill="white" stroke="#ff8100" stroke-width="4" />
  <g transform="translate(15, 15) scale(1.2)">
    <path d="M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65l-2.13 1.52c-.31.22-.5.57-.5.95V13h-4.4a2 2 0 00-1.92 1.45L6 20H2v2h4.5c1.07 0 1.97-.85 1.97-1.97V20l.4-1.2h3.13l.4 1.2c.4 1.2 1.5 2 2.77 2h.3c1.07 0 1.97-.85 1.97-1.97V20l-.4-1.2H14.1l-.33-1H18v-2h-2.17l-.67-2H18c1.1 0 2-.9 2-2V7h-1zM7 18h-.5C5.67 18 5 17.33 5 16.5S5.67 15 6.5 15H7v3zm8.5 0h-.5V15h.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" fill="#ff8100" />
  </g>
</svg>`;

const RESTAURANT_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const CUSTOMER_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

function normEncodedPolyline(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.points || value.encodedPath || '';
}

function distanceToPathMeters(path, riderLatLng) {
  if (!path?.length || !riderLatLng || !window.google?.maps?.geometry?.spherical) return Infinity;
  const rider = new window.google.maps.LatLng(riderLatLng.lat, riderLatLng.lng);
  let minDist = Infinity;
  for (const pt of path) {
    const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
    const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = window.google.maps.geometry.spherical.computeDistanceBetween(
      rider,
      new window.google.maps.LatLng(lat, lng),
    );
    if (d < minDist) minDist = d;
  }
  return minDist;
}

const OFF_ROUTE_THRESHOLD_M = 120;
const LIVE_ROUTE_RECALC_MS = 15000;

const debugLog = (...args) => {
  if (import.meta.env.DEV) console.log('[DeliveryTrackingMap]', ...args);
};

/**
 * Given a full route path (array of LatLng) and rider's current position,
 * returns the index of the closest path point to the rider.
 * Uses Google Maps geometry library (spherical).
 */
function findClosestPointIndex(path, riderLatLng) {
  if (!path || path.length === 0 || !riderLatLng) return 0;
  const geo = window.google?.maps?.geometry?.spherical;
  if (!geo) return 0;

  let minDist = Infinity;
  let closestIdx = 0;

  for (let i = 0; i < path.length; i++) {
    const pt = path[i];
    const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
    const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
    const dist = geo.computeDistanceBetween(
      new window.google.maps.LatLng(lat, lng),
      new window.google.maps.LatLng(riderLatLng.lat, riderLatLng.lng)
    );
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }
  return closestIdx;
}

/**
 * Normalise a path point to a plain {lat, lng} object
 * (handles both Google LatLng objects and plain objects).
 */
function normPt(pt) {
  if (!pt) return null;
  const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
  const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function calcHeading(lat1, lon1, lat2, lon2) {
  const l1 = Number(lat1);
  const ln1 = Number(lon1);
  const l2 = Number(lat2);
  const ln2 = Number(lon2);
  if (!Number.isFinite(l1) || !Number.isFinite(ln1) || !Number.isFinite(l2) || !Number.isFinite(ln2)) {
    return 0;
  }
  const lat1Rad = (l1 * Math.PI) / 180;
  const lat2Rad = (l2 * Math.PI) / 180;
  const deltaLonRad = ((ln2 - ln1) * Math.PI) / 180;

  const y = Math.sin(deltaLonRad) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLonRad);
  
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function getHeadingFromRoutePath(path, riderLocation) {
  if (!path || path.length < 2 || !riderLocation) return null;
  const idx = findClosestPointIndex(path, riderLocation);
  let ptA, ptB;
  if (idx < path.length - 1) {
    ptA = path[idx];
    ptB = path[idx + 1];
  } else if (idx > 0) {
    ptA = path[idx - 1];
    ptB = path[idx];
  } else {
    return null;
  }
  const normA = normPt(ptA);
  const normB = normPt(ptB);
  if (!normA || !normB) return null;
  return calcHeading(normA.lat, normA.lng, normB.lat, normB.lng);
}

function resolveRiderHeading(dataHeading, prevPos, newLat, newLng, routePath) {
  const rawHead = Number(dataHeading);
  let head = Number.isFinite(rawHead) && rawHead !== 0 ? rawHead : null;

  // If payload heading is missing/0, calculate heading from previous location if moved > 1.5m
  if (head === null && prevPos && Number.isFinite(prevPos.lat) && Number.isFinite(prevPos.lng)) {
    const geo = window.google?.maps?.geometry?.spherical;
    let dist = Infinity;
    if (geo && window.google?.maps?.LatLng) {
      dist = geo.computeDistanceBetween(
        new window.google.maps.LatLng(prevPos.lat, prevPos.lng),
        new window.google.maps.LatLng(newLat, newLng)
      );
    } else {
      const dLat = (newLat - prevPos.lat) * 111000;
      const dLng = (newLng - prevPos.lng) * 111000 * Math.cos((newLat * Math.PI) / 180);
      dist = Math.sqrt(dLat * dLat + dLng * dLng);
    }

    if (dist > 1.5) {
      head = calcHeading(prevPos.lat, prevPos.lng, newLat, newLng);
    } else if (Number.isFinite(prevPos.heading) && prevPos.heading !== 0) {
      head = prevPos.heading;
    }
  }

  // Fallback to route path orientation if heading is still null or 0
  if ((head === null || head === 0) && routePath && routePath.length > 1) {
    const pathHead = getHeadingFromRoutePath(routePath, { lat: newLat, lng: newLng });
    if (Number.isFinite(pathHead)) {
      head = pathHead;
    }
  }

  return head ?? prevPos?.heading ?? 0;
}

const DeliveryTrackingMapInner = ({
  orderId,
  orderTrackingIds = [],
  restaurantCoords,
  customerCoords,
  order = null,
  onEtaUpdate = null
}) => {
  const [map, setMap] = useState(null);
  const [riderLocation, setRiderLocation] = useState(null);
  const [currentEta, setCurrentEta] = useState(null);
  /**
   * fullRoutePath — the decoded overview_path from the baseline Directions call.
   * We store it as plain [{lat,lng}] so it's React-state-safe.
   */
  const [fullRoutePath, setFullRoutePath] = useState(null);
  const fullRoutePathRef = useRef(fullRoutePath);
  useEffect(() => {
    fullRoutePathRef.current = fullRoutePath;
  }, [fullRoutePath]);

  /**
   * cloudPolyline — encoded polyline coming from the driver's real-time Firebase push.
   * When present, we decode it and use it as the fullRoutePath instead.
   */
  const [cloudPolyline, setCloudPolyline] = useState(null);
  const [liveRouteRequestKey, setLiveRouteRequestKey] = useState(0);

  const [smoothLocation, setSmoothLocation] = useState(null);
  const interpStateRef = useRef({ lastPos: null, nextPos: null, startTime: 0, durationMs: 1500 });
  const lastUpdateAtRef = useRef(0);
  const lastSmoothSetRef = useRef(0);
  const baselineRequestedRef = useRef(false);
  const lastEncodedPolylineRef = useRef('');
  const lastLiveRouteAtRef = useRef(0);
  const liveRouteOriginRef = useRef(null);

  const googleMapsApiKey = useGoogleMapsApiKey();

  const { isLoaded, loadError } = useJsApiLoader(
    {
      id: "delivery-tracking-map",
      googleMapsApiKey: googleMapsApiKey || "__pending__",
      libraries: MAP_LIBRARIES,
    },
    [googleMapsApiKey]
  );

  if (!googleMapsApiKey) {
    return (
      <div className="w-full h-full bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-center px-4 text-center">
        <p className="text-sm text-gray-600">Loading map configuration...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="w-full h-full bg-red-50 border border-red-200 rounded-2xl flex items-center justify-center px-4 text-center">
        <p className="text-sm text-red-700">Google Map load failed. Please verify Maps API key and allowed localhost referrers.</p>
      </div>
    );
  }

  const trackingIds = useMemo(() => {
    const ids = [orderId, ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : [])]
      .map(id => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [orderId, orderTrackingIds]);

  useOrderLocationSubscription(trackingIds, { enabled: trackingIds.length > 0 });

  // 1. Initial State from Order Payload
  useEffect(() => {
    const loc = order?.deliveryState?.currentLocation;
    if (loc && !riderLocation) {
      const lat = typeof loc.lat === 'number' ? loc.lat : (Array.isArray(loc.coordinates) ? Number(loc.coordinates[1]) : null);
      const lng = typeof loc.lng === 'number' ? loc.lng : (Array.isArray(loc.coordinates) ? Number(loc.coordinates[0]) : null);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const rawHead = loc.bearing || loc.heading;
        const heading = resolveRiderHeading(rawHead, null, lat, lng, fullRoutePathRef.current);
        setRiderLocation({ lat, lng, heading });
      }
    }
  }, [order, riderLocation]);

  // Align initial rider heading once fullRoutePath is available
  useEffect(() => {
    if (!fullRoutePath || fullRoutePath.length < 2) return;
    setRiderLocation((prev) => {
      if (!prev) return prev;
      const currentHead = prev.heading || 0;
      if (currentHead === 0) {
        const pathHead = getHeadingFromRoutePath(fullRoutePath, prev);
        if (Number.isFinite(pathHead) && pathHead !== 0) {
          if (interpStateRef.current?.nextPos) {
            interpStateRef.current.nextPos.heading = pathHead;
          }
          return { ...prev, heading: pathHead };
        }
      }
      return prev;
    });
  }, [fullRoutePath]);

  // 2. Live location via shared user socket (single connection, no Firebase)
  useEffect(() => {
    if (!trackingIds.length) return undefined;

    const applyLocationPayload = (data) => {
      const dataOrderId =
        data?.orderId || data?.order_id || data?.trackingId || data?.order?.id || data?.order?._id;
      const matchedId = dataOrderId
        ? trackingIds.find((id) => String(id) === String(dataOrderId))
        : trackingIds.length === 1
          ? trackingIds[0]
          : null;
      const lat = Number(
        data?.lat ?? data?.boy_lat ?? data?.location?.lat ?? data?.location?.coordinates?.[1],
      );
      const lng = Number(
        data?.lng ?? data?.boy_lng ?? data?.location?.lng ?? data?.location?.coordinates?.[0],
      );

      if (!data || !matchedId || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const prevPos = interpStateRef.current?.nextPos || riderLocation;
      const rawHeading = data?.heading ?? data?.bearing ?? data?.location?.heading;
      const heading = resolveRiderHeading(rawHeading, prevPos, lat, lng, fullRoutePathRef.current);

      const nextPos = {
        lat,
        lng,
        heading,
      };
      const now = Date.now();
      const delta = Math.max(300, Math.min(now - (lastUpdateAtRef.current || now), 4000));
      lastUpdateAtRef.current = now;

      interpStateRef.current = {
        lastPos: interpStateRef.current.nextPos || nextPos,
        nextPos,
        startTime: now,
        durationMs: delta,
      };

      setRiderLocation(nextPos);

      if (data?.polyline) {
        const encoded = normEncodedPolyline(data.polyline);
        if (encoded && encoded !== lastEncodedPolylineRef.current) {
          lastEncodedPolylineRef.current = encoded;
          setCloudPolyline(encoded);
          debugLog('📡 Route polyline updated from rider');
        }
      }
      if (data?.eta) {
        setCurrentEta(data.eta);
        onEtaUpdate?.(data.eta);
      }
    };

    return subscribeLocationUpdates(applyLocationPayload);
  }, [trackingIds, onEtaUpdate]);

  // 3. Smooth Animation Loop (60 FPS Glide)
  useEffect(() => {
    let frame;
    const update = () => {
      const { lastPos, nextPos, startTime, durationMs } = interpStateRef.current;
      if (lastPos && nextPos) {
        const duration = Math.max(600, durationMs || 1500);
        const elapsed = Date.now() - startTime;
        const raw = Math.min(elapsed / duration, 1);
        const progress = raw * raw * (3 - 2 * raw); // easeInOut

        const lat = lastPos.lat + (nextPos.lat - lastPos.lat) * progress;
        const lng = lastPos.lng + (nextPos.lng - lastPos.lng) * progress;

        // Shortest-path heading interpolation
        let lastHead = lastPos.heading || 0;
        let nextHead = nextPos.heading || 0;
        if (Math.abs(nextHead - lastHead) > 180) {
          if (nextHead > lastHead) lastHead += 360;
          else nextHead += 360;
        }
        const heading = lastHead + (nextHead - lastHead) * progress;

        const now = Date.now();
        if (now - lastSmoothSetRef.current >= 33 || raw >= 1) {
          lastSmoothSetRef.current = now;
          setSmoothLocation({ lat, lng, heading: heading % 360 });
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);

  // 4. When cloudPolyline updates: decode & replace fullRoutePath
  useEffect(() => {
    if (!cloudPolyline || !isLoaded || !window.google?.maps?.geometry?.encoding) return;
    try {
      const encoded = normEncodedPolyline(cloudPolyline);
      if (!encoded) return;
      const decoded = window.google.maps.geometry.encoding.decodePath(encoded);
      const plain = decoded.map(normPt).filter(Boolean);
      if (plain.length > 1) {
        setFullRoutePath(plain);
        debugLog(`🗺️ Rider polyline applied: ${plain.length} points`);
      }
    } catch (e) {
      debugLog('Cloud polyline decode error:', e);
    }
  }, [cloudPolyline, isLoaded]);

  const displayRiderLocation = smoothLocation || riderLocation;

  const tripStatus = order?.status || order?.orderStatus || 'pending';
  const isOrderPickedUp = ['picked_up', 'out_for_delivery', 'delivered'].includes(
    tripStatus.toLowerCase(),
  );

  const routeDestination = useMemo(() => {
    if (isOrderPickedUp) return customerCoords || null;
    return restaurantCoords || null;
  }, [isOrderPickedUp, customerCoords, restaurantCoords]);

  const isRiderOffRoute = useMemo(() => {
    if (!fullRoutePath?.length || !displayRiderLocation || !isLoaded) return false;
    return distanceToPathMeters(fullRoutePath, displayRiderLocation) > OFF_ROUTE_THRESHOLD_M;
  }, [fullRoutePath, displayRiderLocation, isLoaded]);

  // Recalculate rider → destination when driver leaves the current polyline
  useEffect(() => {
    if (!isRiderOffRoute || !displayRiderLocation || !routeDestination) return undefined;
    const now = Date.now();
    if (now - lastLiveRouteAtRef.current < LIVE_ROUTE_RECALC_MS) return undefined;

    lastLiveRouteAtRef.current = now;
    liveRouteOriginRef.current = {
      lat: displayRiderLocation.lat,
      lng: displayRiderLocation.lng,
    };
    setLiveRouteRequestKey((key) => key + 1);
    debugLog('🔁 Rider off-route — requesting fresh directions');
    return undefined;
  }, [isRiderOffRoute, displayRiderLocation, routeDestination]);

  useEffect(() => {
    baselineRequestedRef.current = false;
    lastEncodedPolylineRef.current = '';
    lastLiveRouteAtRef.current = 0;
    setCloudPolyline(null);
    setFullRoutePath(null);
  }, [orderId, isOrderPickedUp]);

  // 5. Smart camera: fit bounds
  const lastCameraUpdateRef = useRef({ time: 0, status: null });
  useEffect(() => {
    if (!map || !restaurantCoords || !customerCoords || !isLoaded) return;

    const now = Date.now();
    const statusChanged = lastCameraUpdateRef.current.status !== isOrderPickedUp;
    const timeSinceLastUpdate = now - lastCameraUpdateRef.current.time;
    if (!statusChanged && timeSinceLastUpdate < 15000) return;

    lastCameraUpdateRef.current = { time: now, status: isOrderPickedUp };

    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend(restaurantCoords);
    bounds.extend(customerCoords);
    if (riderLocation) bounds.extend(riderLocation);

    map.fitBounds(bounds, { top: 100, bottom: 120, left: 60, right: 60 });
    debugLog(`[Camera] Focusing on ${isOrderPickedUp ? 'Delivery' : 'Pickup'} leg`);
  }, [map, riderLocation, restaurantCoords, customerCoords, isOrderPickedUp, isLoaded]);

  // 6. Baseline Directions callback — stores the overview_path as fullRoutePath
  const baselineDirectionsCallback = useCallback((result, status) => {
    if (status === 'OK' && result) {
      const rawPath = result.routes?.[0]?.overview_path || [];
      const plain = rawPath.map(normPt).filter(Boolean);
      if (plain.length > 1) {
        setFullRoutePath(plain);
        debugLog(`✅ Baseline route stored: ${plain.length} points`);
      }
      // Also extract ETA from baseline if no real-time ETA yet
      const durationText = result?.routes?.[0]?.legs?.[0]?.duration?.text;
      if (durationText && !currentEta) {
        setCurrentEta(durationText);
        if (onEtaUpdate) onEtaUpdate(durationText);
      }
    } else if (status !== 'OK') {
      console.error('[DeliveryTrackingMap] Baseline DirectionsService failed:', status);
    }
  }, [currentEta, onEtaUpdate]);

  const baselineDirectionsOptions = useMemo(() => {
    if (!restaurantCoords || !customerCoords) return null;
    if (fullRoutePath?.length) return null;
    return {
      origin: restaurantCoords,
      destination: customerCoords,
      travelMode: 'DRIVING',
    };
  }, [
    restaurantCoords?.lat,
    restaurantCoords?.lng,
    customerCoords?.lat,
    customerCoords?.lng,
    fullRoutePath?.length,
  ]);

  const liveRiderDirectionsOptions = useMemo(() => {
    const origin = liveRouteOriginRef.current;
    if (!origin || !routeDestination || !isRiderOffRoute) return null;
    return {
      origin,
      destination: routeDestination,
      travelMode: 'DRIVING',
    };
  }, [
    routeDestination?.lat,
    routeDestination?.lng,
    isRiderOffRoute,
    liveRouteRequestKey,
  ]);

  const liveDirectionsCallback = useCallback((result, status) => {
    if (status !== 'OK' || !result) return;
    const rawPath = result.routes?.[0]?.overview_path || [];
    const plain = rawPath.map(normPt).filter(Boolean);
    if (plain.length > 1) {
      setFullRoutePath(plain);
      debugLog(`✅ Live off-route path: ${plain.length} points`);
    }
    const durationText = result?.routes?.[0]?.legs?.[0]?.duration?.text;
    if (durationText) {
      setCurrentEta(durationText);
      onEtaUpdate?.(durationText);
    }
  }, [onEtaUpdate]);

  /**
   * SPLIT POLYLINE LOGIC:
   * Given the full route path and the rider's current position, split into:
   *   - traveledPath: restaurant → nearest point to rider (dashed grey)
   *   - remainingPath: nearest point → destination (solid colored)
   */
  const { traveledPath, remainingPath } = useMemo(() => {
    if (!fullRoutePath || fullRoutePath.length < 2) {
      return { traveledPath: [], remainingPath: [] };
    }
    if (!displayRiderLocation || !isLoaded || !window.google?.maps?.geometry) {
      // No rider yet: show everything as remaining
      return { traveledPath: [], remainingPath: fullRoutePath };
    }

    const splitIdx = findClosestPointIndex(fullRoutePath, displayRiderLocation);

    // traveledPath: start → splitIdx (inclusive) + rider's exact position
    const traveled = [
      ...fullRoutePath.slice(0, splitIdx + 1),
      { lat: displayRiderLocation.lat, lng: displayRiderLocation.lng }
    ];

    // remainingPath: rider's exact position → end
    const remaining = [
      { lat: displayRiderLocation.lat, lng: displayRiderLocation.lng },
      ...fullRoutePath.slice(splitIdx + 1)
    ];

    return { traveledPath: traveled, remainingPath: remaining };
  }, [fullRoutePath, displayRiderLocation, isLoaded]);

  // Route color by phase
  const remainingColor = isOrderPickedUp ? '#3b82f6' : '#22c55e';

  const center = useMemo(() => {
    if (isOrderPickedUp) return customerCoords || { lat: 0, lng: 0 };
    return restaurantCoords || { lat: 0, lng: 0 };
  }, [isOrderPickedUp, restaurantCoords, customerCoords]);

  if (!isLoaded) return <div className="w-full h-full bg-gray-100 animate-pulse" />;

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl shadow-inner border border-gray-100">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={15}
        onLoad={setMap}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          scaleControl: true,
          streetViewControl: false,
          rotateControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] }
          ]
        }}
      >
        {/* Initial restaurant → customer route when no rider polyline yet */}
        {!fullRoutePath && baselineDirectionsOptions && !baselineRequestedRef.current && (
          <DirectionsService
            options={baselineDirectionsOptions}
            callback={(r, s) => {
              baselineRequestedRef.current = true;
              baselineDirectionsCallback(r, s);
            }}
          />
        )}

        {/* Rider deviated — recalculate from current rider position */}
        {liveRiderDirectionsOptions && (
          <DirectionsService
            key={`live-route-${liveRouteRequestKey}`}
            options={liveRiderDirectionsOptions}
            callback={liveDirectionsCallback}
          />
        )}

        {/* ── TRAVELED PATH: dashed grey (already covered by driver) ── */}
        {traveledPath.length > 1 && (
          <Polyline
            path={traveledPath}
            options={{
              strokeColor: '#9ca3af',
              strokeOpacity: 0,           // hide solid stroke
              strokeWeight: 6,
              zIndex: 6,
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',  // vertical line = dash segment
                    strokeOpacity: 0.85,
                    strokeWeight: 5,
                    scale: 4,
                  },
                  offset: '0',
                  repeat: '14px',
                }
              ]
            }}
          />
        )}

        {/* ── REMAINING PATH: solid colored (driver's upcoming route) ── */}
        {remainingPath.length > 1 && (
          <Polyline
            path={remainingPath}
            options={{
              strokeColor: remainingColor,
              strokeOpacity: 0.95,
              strokeWeight: 6,
              zIndex: 8,
            }}
          />
        )}

        {/* ── RESTAURANT PIN ── */}
        <OverlayView position={restaurantCoords} mapPaneName={OverlayView.MARKER_LAYER}>
          <div className="relative -translate-x-1/2 -translate-y-full mb-1 group">
            {!isOrderPickedUp && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <motion.div
                  animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-16 h-16 rounded-full border-4 border-primary/50"
                />
              </div>
            )}
            <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-primary overflow-hidden group-hover:scale-110 transition-transform">
              <img
                src={order?.restaurantLogo || order?.restaurantId?.logo || order?.restaurantId?.profileImage || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`}
                alt="Restaurant"
                className="w-full h-full object-contain rounded-full bg-gray-50"
                onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`; }}
              />
            </div>
            <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-primary -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
          </div>
        </OverlayView>

        {/* ── CUSTOMER PIN ── */}
        <OverlayView position={customerCoords} mapPaneName={OverlayView.MARKER_LAYER}>
          <div className="relative -translate-x-1/2 -translate-y-full mb-1 group">
            {isOrderPickedUp && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <motion.div
                  animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-16 h-16 rounded-full border-4 border-green-500/50"
                />
              </div>
            )}
            <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-green-500 overflow-hidden group-hover:scale-110 transition-transform">
              <img
                src={order?.customerImage || order?.userId?.profileImage || order?.userId?.avatar || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`}
                alt="Me"
                className="w-full h-full object-contain rounded-full bg-gray-50"
                onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`; }}
              />
            </div>
            <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-green-500 -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
          </div>
        </OverlayView>

        {/* ── RIDER MARKER ── */}
        {displayRiderLocation && (
          <OverlayView
            position={displayRiderLocation}
            mapPaneName={OverlayView.MARKER_LAYER}
          >
            <div
              style={{
                transform: `translate(-50%, -50%) rotate(${displayRiderLocation.heading || 0}deg)`,
                transition: 'transform 0.2s linear',
                willChange: 'transform',
              }}
              className="relative w-16 h-16"
            >
              <img
                src="/MapRider.png"
                alt="Rider"
                className="w-full h-full object-contain drop-shadow-2xl"
                onError={(e) => { e.target.src = bikeLogo; }}
              />
            </div>
          </OverlayView>
        )}
      </GoogleMap>

      {/* LIVE ARRIVAL BADGE */}
      <AnimatePresence>
        {riderLocation && currentEta && (
          <motion.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="absolute top-4 left-4 z-[150] pointer-events-none"
          >
            <div className="bg-primary/95 backdrop-blur-xl rounded-2xl p-3 shadow-[0_10px_30px_rgba(249,115,22,0.4)] border border-orange-400/50 flex flex-col min-w-[90px] group overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
              <div className="flex flex-col z-10">
                <span className="text-[9px] text-white/80 font-black uppercase tracking-[0.2em] mb-0.5">Arrival</span>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-white leading-none tracking-tighter">
                    {currentEta}
                  </span>
                  <div className="flex items-center gap-1.5 opacity-80">
                    <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    <Navigation className="w-3 h-3 text-white rotate-45" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DeliveryTrackingMap = (props) => {
  const googleMapsApiKey = useGoogleMapsApiKey();
  if (!googleMapsApiKey) {
    return (
      <div className="w-full h-full bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-center px-4 text-center">
        <p className="text-sm text-gray-600">Loading map configuration...</p>
      </div>
    );
  }
  return <DeliveryTrackingMapInner {...props} googleMapsApiKey={googleMapsApiKey} />;
};

export default DeliveryTrackingMap;


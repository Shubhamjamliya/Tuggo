/**
 * Haversine formula to calculate the great-circle distance between two points on a sphere.
 * Returns distance in meters.
 */
export const parseLatLng = (raw) => {
  if (!raw) return null;

  let lat = Number(raw.lat ?? raw.latitude);
  let lng = Number(raw.lng ?? raw.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const coords = raw.coordinates || raw.location?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      lng = Number(coords[0]);
      lat = Number(coords[1]);
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const aLat = Number(lat1);
  const aLng = Number(lon1);
  const bLat = Number(lat2);
  const bLng = Number(lon2);

  if (!Number.isFinite(aLat) || !Number.isFinite(aLng) || !Number.isFinite(bLat) || !Number.isFinite(bLng)) {
    return Infinity;
  }

  const earthRadiusMeters = 6371e3;
  const phi1 = (aLat * Math.PI) / 180;
  const phi2 = (bLat * Math.PI) / 180;
  const deltaPhi = ((bLat - aLat) * Math.PI) / 180;
  const deltaLambda = ((bLng - aLng) * Math.PI) / 180;

  const haversine =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return earthRadiusMeters * arc;
};

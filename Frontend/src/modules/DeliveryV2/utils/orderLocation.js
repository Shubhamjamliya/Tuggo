import { parseLatLng } from '@/modules/DeliveryV2/hooks/proximity.utils';

/**
 * Format full address from various address and order structures.
 */
function cleanText(val) {
  if (val == null) return '';
  const s = String(val).trim();
  return s === 'undefined' || s === 'null' ? '' : s;
}

/**
 * Extract restaurant display details from an order object.
 */
export function getRestaurantDisplayInfo(order) {
  if (!order) {
    return {
      name: 'Restaurant',
      address: 'Address not available',
      shortAddress: 'Restaurant Location',
      coords: null,
      mapsUrl: null,
      phone: '',
    };
  }

  const restId = typeof order.restaurantId === 'object' && order.restaurantId !== null ? order.restaurantId : {};
  const restLoc = order.restaurantLocation || restId.location || {};

  const name =
    cleanText(order.restaurantName) ||
    cleanText(order.restaurant_name) ||
    cleanText(restId.restaurantName) ||
    cleanText(restId.name) ||
    cleanText(order.restaurant?.restaurantName) ||
    cleanText(order.restaurant?.name) ||
    'Restaurant';

  // Area and city
  const area = cleanText(restLoc.area) || cleanText(restId.area);
  const city = cleanText(restLoc.city) || cleanText(restId.city);
  const areaCity = [area, city].filter(Boolean).join(', ');

  // Full address
  const fullAddress =
    cleanText(order.restaurantAddress) ||
    cleanText(order.restaurant_address) ||
    cleanText(restLoc.formattedAddress) ||
    cleanText(restLoc.address) ||
    cleanText(restId.location?.formattedAddress) ||
    cleanText(restId.location?.address) ||
    cleanText(restId.addressLine1) ||
    cleanText(restId.address) ||
    areaCity ||
    'Address not available';

  // Short address (e.g. Area, City or first line of address)
  const shortAddress =
    areaCity ||
    (fullAddress !== 'Address not available'
      ? fullAddress.split(',').slice(0, 2).join(', ').trim()
      : 'Restaurant Location');

  // Parse coords
  const coords =
    parseLatLng(order.restaurantLocation) ||
    parseLatLng(restId.location) ||
    parseLatLng(order.restaurant_location) ||
    parseLatLng({
      lat: order.restaurantLat ?? order.restaurant_lat,
      lng: order.restaurantLng ?? order.restaurant_lng,
    });

  let mapsUrl = null;
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${coords.lat},${coords.lng}`,
    )}`;
  } else if (fullAddress && fullAddress !== 'Address not available') {
    mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${name}, ${fullAddress}`,
    )}`;
  }

  const phone = cleanText(order.restaurantPhone) || cleanText(restId.phone) || cleanText(order.restaurant_phone) || '';

  return {
    name,
    address: fullAddress,
    shortAddress,
    coords,
    mapsUrl,
    phone,
  };
}

/**
 * Extract customer / delivery user display details from an order object.
 */
export function getCustomerDisplayInfo(order) {
  if (!order) {
    return {
      name: 'Customer',
      address: 'Location not available',
      shortAddress: 'Customer Location',
      coords: null,
      mapsUrl: null,
      phone: '',
    };
  }

  const deliveryAddress =
    (typeof order.deliveryAddress === 'object' && order.deliveryAddress !== null ? order.deliveryAddress : null) ||
    (typeof order.address === 'object' && order.address !== null ? order.address : {}) ||
    {};

  const userObj = typeof order.userId === 'object' && order.userId !== null ? order.userId : (order.user || {});

  const name =
    cleanText(order.customerName) ||
    cleanText(order.userName) ||
    cleanText(deliveryAddress.fullName) ||
    cleanText(deliveryAddress.name) ||
    cleanText(userObj.name) ||
    'Customer';

  const phone =
    cleanText(order.customerPhone) ||
    cleanText(order.userPhone) ||
    cleanText(deliveryAddress.phone) ||
    cleanText(userObj.phone) ||
    '';

  // Address parts from schema
  const addressParts = [
    cleanText(deliveryAddress.street),
    cleanText(deliveryAddress.additionalDetails),
    cleanText(deliveryAddress.landmark),
    cleanText(deliveryAddress.area),
    cleanText(deliveryAddress.city),
    cleanText(deliveryAddress.state),
    cleanText(deliveryAddress.zipCode || deliveryAddress.pincode),
  ].filter(Boolean);

  const parsedPartsString = addressParts.join(', ');

  // Direct address fields
  const rawAddress =
    cleanText(order.customerAddress) ||
    cleanText(order.customer_address) ||
    cleanText(deliveryAddress.formattedAddress) ||
    cleanText(deliveryAddress.address) ||
    cleanText(order.address?.formattedAddress) ||
    cleanText(order.address) ||
    parsedPartsString;

  // Resolve coords
  const coords =
    parseLatLng(order.customerLocation) ||
    parseLatLng(order.deliveryLocation) ||
    parseLatLng(order.customer_location) ||
    parseLatLng(deliveryAddress.location) ||
    parseLatLng(deliveryAddress) ||
    parseLatLng({
      lat: order.customerLat ?? order.customer_lat,
      lng: order.customerLng ?? order.customer_lng,
    });

  const fullAddress =
    rawAddress ||
    (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
      ? `Lat ${coords.lat.toFixed(5)}, Lng ${coords.lng.toFixed(5)}`
      : 'Location not available');

  // Short address for compact cards
  const areaCity = [cleanText(deliveryAddress.area), cleanText(deliveryAddress.city)].filter(Boolean).join(', ');
  const streetPart = cleanText(deliveryAddress.street);
  const shortAddress =
    areaCity ||
    streetPart ||
    (fullAddress !== 'Location not available'
      ? fullAddress.split(',').slice(0, 2).join(', ').trim()
      : 'Customer Location');

  let mapsUrl = null;
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${coords.lat},${coords.lng}`,
    )}`;
  } else if (fullAddress && fullAddress !== 'Location not available') {
    mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  }

  return {
    name,
    address: fullAddress,
    shortAddress,
    coords,
    mapsUrl,
    phone,
  };
}

/**
 * Extract order bill amount and payment status (COD vs PAID) for rider display.
 */
export function getOrderPaymentInfo(order) {
  if (!order) {
    return {
      totalAmount: 0,
      formattedTotal: '₹0.00',
      isCod: false,
      isPaid: true,
      paymentMethod: 'online',
      paymentLabel: 'PAID',
      paymentStatusText: 'Pre-paid Online',
      collectionNotice: 'Do not collect cash from customer',
    };
  }

  // Extract raw order total value
  const rawTotal =
    order.pricing?.total ??
    order.total ??
    order.orderAmount ??
    order.order_amount ??
    order.pricing?.grandTotal ??
    order.amounts?.total ??
    0;

  const totalAmount = Number(rawTotal) || 0;
  const formattedTotal = `₹${totalAmount.toFixed(2)}`;

  // Determine payment method and status
  const method = String(
    order.paymentMethod ||
    order.payment?.method ||
    order.paymentMode ||
    order.payment_method ||
    ''
  ).toLowerCase().trim();

  const paymentStatus = String(
    order.payment?.status ||
    order.paymentStatus ||
    order.payment_status ||
    ''
  ).toLowerCase().trim();

  const isCod =
    method === 'cash' ||
    method === 'cod' ||
    method === 'cash_on_delivery' ||
    paymentStatus === 'cod_pending';

  const isPaid = !isCod;

  return {
    totalAmount,
    formattedTotal,
    isCod,
    isPaid,
    paymentMethod: method || (isCod ? 'cod' : 'online'),
    paymentLabel: isCod ? 'COD' : 'PAID',
    paymentStatusText: isCod ? 'Cash on Delivery' : 'Pre-paid Online',
    collectionNotice: isCod
      ? `Collect ₹${totalAmount.toFixed(2)} cash from customer`
      : 'Online Paid — Do NOT collect cash',
  };
}


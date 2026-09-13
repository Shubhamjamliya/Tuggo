import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, MapPin, FastForward, Clock, Phone, ChefHat, ChevronDown, Store, ExternalLink, Banknote, CreditCard } from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { getHaversineDistance } from '@/modules/DeliveryV2/utils/geo';
import { getOrderMongoId, getOrderDisplayId, isSameOrder } from '@food/utils/orderDispatchId';
import { getRestaurantDisplayInfo, getCustomerDisplayInfo, getOrderPaymentInfo } from '@/modules/DeliveryV2/utils/orderLocation';

/**
 * NewOrderModal - Ported to Original 1:1 Theme with Slider Accept.
 * Matches the Zomato/Swiggy style Green Header + White Card.
 */
export const NewOrderModal = ({ order, queuedOrders = [], onSelectOrder, onAccept, onReject, onMinimize }) => {
  const { riderLocation } = useDeliveryStore();
  const [timeLeft, setTimeLeft] = useState(60);
  const orderKey = getOrderMongoId(order) || getOrderDisplayId(order);

  const restaurantInfo = useMemo(() => getRestaurantDisplayInfo(order), [order]);
  const customerInfo = useMemo(() => getCustomerDisplayInfo(order), [order]);
  const paymentInfo = useMemo(() => getOrderPaymentInfo(order), [order]);

  useEffect(() => {
    setTimeLeft(60);
  }, [orderKey]);

  useEffect(() => {
    if (timeLeft <= 0) {
      onReject();
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, onReject]);

  const { pickup, drop, total } = useMemo(() => {
    const unknown = {
      pickup: { distanceKm: '??', etaMins: '??' },
      drop: { distanceKm: '??', etaMins: '??' },
      total: { distanceKm: '??', etaMins: '??' },
    };
    if (!order) return unknown;

    const etaFromMeters = (meters, extraMins = 0) =>
      Math.max(1, Math.ceil(meters / 416) + extraMins);

    const fmtKm = (km) => (km != null && Number.isFinite(km) ? km.toFixed(1) : '??');
    const fmtMins = (mins) => (mins != null && Number.isFinite(mins) ? mins : '??');

    let pickupDistKm = null;
    let pickupEta = null;
    const rawPickup = order.pickupDistanceKm ?? order.distanceKm;
    if (rawPickup != null) {
      pickupDistKm = Number(rawPickup);
      const rawEta = order.estimatedTime || order.duration || order.eta;
      pickupEta =
        rawEta && rawEta > 0 ? Math.ceil(rawEta) : etaFromMeters(pickupDistKm * 1000, 5);
    } else if (riderLocation && restaurantInfo?.coords) {
      const distM = getHaversineDistance(
        riderLocation.lat,
        riderLocation.lng,
        restaurantInfo.coords.lat,
        restaurantInfo.coords.lng,
      );
      pickupDistKm = distM / 1000;
      pickupEta = etaFromMeters(distM, order.prepTime || 5);
    }

    let dropDistKm = null;
    let dropEta = null;
    const rawDrop = order.dropDistanceKm ?? order.deliveryDistanceKm;
    if (rawDrop != null) {
      dropDistKm = Number(rawDrop);
      dropEta = order.dropEta ? Math.ceil(order.dropEta) : etaFromMeters(dropDistKm * 1000, 0);
    } else if (restaurantInfo?.coords && customerInfo?.coords) {
      const distM = getHaversineDistance(
        restaurantInfo.coords.lat,
        restaurantInfo.coords.lng,
        customerInfo.coords.lat,
        customerInfo.coords.lng,
      );
      dropDistKm = distM / 1000;
      dropEta = etaFromMeters(distM, 0);
    }

    const totalKm =
      pickupDistKm != null && dropDistKm != null ? pickupDistKm + dropDistKm : null;
    const totalEta =
      pickupEta != null && dropEta != null ? pickupEta + dropEta : null;

    return {
      pickup: { distanceKm: fmtKm(pickupDistKm), etaMins: fmtMins(pickupEta) },
      drop: { distanceKm: fmtKm(dropDistKm), etaMins: fmtMins(dropEta) },
      total: { distanceKm: fmtKm(totalKm), etaMins: fmtMins(totalEta) },
    };
  }, [order, riderLocation, restaurantInfo, customerInfo]);

  if (!order) return null;

  useEffect(() => {
    console.log('[DeliveryPopupTrace] NewOrderModal mounted', {
      popupOrderId: orderKey,
      displayId: getOrderDisplayId(order),
      queuedCount: queuedOrders.length,
    });

    return () => {
      console.log('[DeliveryPopupTrace] NewOrderModal unmounted', {
        popupOrderId: orderKey,
        displayId: getOrderDisplayId(order),
      });
    };
  }, [orderKey, order, queuedOrders.length]);

  const bonus = order.deliveryBonusAmount || 0;
  const earnings = order.earnings || order.riderEarning || (order.orderAmount ? order.orderAmount * 0.1 : 0);
  const baseEarnings = Math.max(0, earnings - bonus);

  const restaurantName = restaurantInfo.name;
  const restaurantAddress = restaurantInfo.address;
  const restaurantMapsLink = restaurantInfo.mapsUrl;

  const customerName =
    customerInfo.name && customerInfo.name !== 'Customer'
      ? customerInfo.name
      : 'Customer Drop';
  const customerAddress = customerInfo.address;
  const customerMapsLink = customerInfo.mapsUrl;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-1000 bg-black/60 flex items-end justify-center p-0"
    >
      <motion.div 
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[3rem] overflow-hidden shadow-[0_-20px_60px_rgba(0,0,0,0.5)] flex flex-col pt-1 sm:pt-2"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center pb-1.5 pt-1 bg-white relative z-10 rounded-t-3xl sm:rounded-t-[3rem] -mb-1">
          <button onClick={onMinimize} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
             <ChevronDown className="w-6 h-6 text-gray-400 stroke-3" />
          </button>
        </div>

        {/* Header Ribbon (Old Green Style) */}
        <div 
          className="p-4 sm:p-8 flex justify-between items-center text-white border-b border-white/10"
          style={{ background: 'linear-gradient(33deg, #15498b 0%, #000000 100%)' }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-white/80 text-[10px] font-bold uppercase tracking-widest">Incoming Request</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                paymentInfo.isCod
                  ? 'bg-amber-400/25 text-amber-300 border border-amber-400/40'
                  : 'bg-emerald-400/25 text-emerald-300 border border-emerald-400/40'
              }`}>
                {paymentInfo.paymentLabel}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <h2 className="text-2xl sm:text-4xl font-bold tracking-tighter">₹{Number(earnings || 0).toFixed(2)}</h2>
              {bonus > 0 && (
                <p className="text-white/70 text-xs font-semibold mb-1">
                  (₹{Number(baseEarnings).toFixed(0)} + ₹{Number(bonus).toFixed(0)} Bonus)
                </p>
              )}
            </div>
            <p className="text-white/75 text-xs font-semibold mt-1">
              Order Value: <span className="font-bold text-white">₹{paymentInfo.totalAmount.toFixed(2)}</span>
            </p>
          </div>
          <div className="bg-white/20 border border-white/30 rounded-2xl sm:rounded-3xl px-3 sm:px-6 py-2 sm:py-3 text-white font-bold text-lg sm:text-2xl shadow-inner tabular-nums">
            {timeLeft}s
          </div>
        </div>

        {queuedOrders.length > 1 && (
          <div className="px-4 sm:px-6 py-3 bg-gray-50 border-b border-gray-100">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
              {queuedOrders.length} orders available — tap to switch
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {queuedOrders.map((queuedOrder, index) => {
                const queuedId = getOrderMongoId(queuedOrder) || getOrderDisplayId(queuedOrder);
                const isActive = isSameOrder(queuedOrder, order);
                const qEarnings =
                  queuedOrder.earnings ||
                  queuedOrder.riderEarning ||
                  queuedOrder.pricing?.deliveryFee ||
                  0;
                const label =
                  getOrderDisplayId(queuedOrder) ||
                  `Order ${index + 1}`;
                const qRest = getRestaurantDisplayInfo(queuedOrder);
                const qCust = getCustomerDisplayInfo(queuedOrder);
                const qPayment = getOrderPaymentInfo(queuedOrder);

                return (
                  <button
                    key={queuedId || `order-${index}`}
                    type="button"
                    onClick={() => onSelectOrder?.(queuedOrder)}
                    className={`shrink-0 rounded-2xl p-3 border text-left transition-all min-w-[210px] max-w-[260px] ${
                      isActive
                        ? 'bg-gray-900 text-white border-gray-900 shadow-lg ring-2 ring-blue-400/40'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80 truncate">
                        {label}
                      </span>
                      <div className="text-right shrink-0">
                        <span className="block text-sm font-black text-green-500">
                          ₹{Number(qEarnings || 0).toFixed(0)}
                        </span>
                        <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${
                          qPayment.isCod
                            ? (isActive ? 'bg-amber-400/30 text-amber-300' : 'bg-amber-100 text-amber-800')
                            : (isActive ? 'bg-emerald-400/30 text-emerald-300' : 'bg-emerald-100 text-emerald-800')
                        }`}>
                          {qPayment.paymentLabel} · ₹{Math.round(qPayment.totalAmount)}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <div className="flex items-center gap-1.5 truncate">
                        <Store className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-green-400' : 'text-green-600'}`} />
                        <span className="truncate font-semibold">{qRest.name}</span>
                        {qRest.shortAddress && qRest.shortAddress !== qRest.name && (
                          <span className={`text-[10px] truncate opacity-70`}>({qRest.shortAddress})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-blue-500'}`} />
                        <span className="truncate font-medium opacity-90">{qCust.shortAddress || qCust.address}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Info Body */}
        <div className="p-4 sm:p-8 pb-6 sm:pb-12 space-y-5 sm:space-y-10 overflow-y-auto max-h-[78vh]">
          <div className="flex gap-3 sm:gap-6">
            <div className="flex flex-col items-center gap-1.5 mt-2 py-1">
              <div className="w-5 h-5 rounded-full bg-green-500 border-4 border-green-50 shadow-lg shadow-green-500/20" />
              <div className="w-0.5 h-16 bg-dashed border-l-2 border-gray-100" />
              <div className="w-5 h-5 rounded-full bg-blue-500 border-4 border-blue-50 shadow-lg shadow-blue-500/20" />
            </div>
            <div className="flex-1 space-y-5 sm:space-y-8">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest text-green-600">
                    <ChefHat className="w-4 h-4" />
                    <span>Restaurant Pickup</span>
                  </div>
                  {restaurantMapsLink && (
                    <a
                      href={restaurantMapsLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-green-600 hover:text-green-700 active:scale-95 transition-transform"
                    >
                      <span>Map</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <p className="text-gray-950 font-bold text-base sm:text-xl leading-tight">{restaurantName}</p>
                <p className="text-gray-500 text-sm font-medium leading-relaxed mt-0.5">{restaurantAddress}</p>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest text-blue-600">
                    <MapPin className="w-4 h-4" />
                    <span>Customer Drop</span>
                  </div>
                  {customerMapsLink && (
                    <a
                      href={customerMapsLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-700 active:scale-95 transition-transform"
                    >
                      <span>Map</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <p className="text-gray-950 font-bold text-base sm:text-xl leading-tight">{customerName}</p>
                <p className="text-gray-500 text-sm font-medium leading-relaxed line-clamp-2 mt-0.5">{customerAddress}</p>
              </div>
            </div>
          </div>

          {/* Order Bill & Payment Mode Card */}
          <div className={`p-3.5 sm:p-4 rounded-2xl border flex items-center justify-between gap-3 ${
            paymentInfo.isCod
              ? 'bg-amber-50/90 border-amber-200'
              : 'bg-emerald-50/90 border-emerald-200'
          }`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${
                paymentInfo.isCod ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'
              }`}>
                {paymentInfo.isCod ? <Banknote className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    paymentInfo.isCod ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'
                  }`}>
                    {paymentInfo.paymentLabel}
                  </span>
                  <span className="text-xs font-bold text-gray-900 truncate">
                    {paymentInfo.paymentStatusText}
                  </span>
                </div>
                <p className={`text-[11px] font-semibold mt-0.5 truncate ${
                  paymentInfo.isCod ? 'text-amber-800' : 'text-emerald-800'
                }`}>
                  {paymentInfo.collectionNotice}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Order Bill</span>
              <span className="text-base sm:text-lg font-black text-gray-950">
                ₹{paymentInfo.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

           <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
             <div className="p-3 sm:p-4 bg-green-50 rounded-2xl border border-green-100 flex items-center gap-2.5 sm:gap-3">
               <MapPin className="w-5 h-5 text-green-600" />
               <div className="flex flex-col">
                  <span className="text-[10px] text-green-600/80 font-bold uppercase tracking-widest">To Restaurant</span>
                  <span className="text-sm font-bold text-gray-900">{pickup.distanceKm} KM</span>
               </div>
             </div>
             <div className="p-3 sm:p-4 bg-green-50 rounded-2xl border border-green-100 flex items-center gap-2.5 sm:gap-3">
               <Clock className="w-5 h-5 text-green-600" />
               <div className="flex flex-col">
                  <span className="text-[10px] text-green-600/80 font-bold uppercase tracking-widest">Pickup Time</span>
                  <span className="text-sm font-bold text-gray-900">{pickup.etaMins} MINS</span>
               </div>
             </div>
             <div className="p-3 sm:p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-2.5 sm:gap-3">
               <MapPin className="w-5 h-5 text-blue-600" />
               <div className="flex flex-col">
                  <span className="text-[10px] text-blue-600/80 font-bold uppercase tracking-widest">To Customer</span>
                  <span className="text-sm font-bold text-gray-900">{drop.distanceKm} KM</span>
               </div>
             </div>
             <div className="p-3 sm:p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-2.5 sm:gap-3">
               <Clock className="w-5 h-5 text-blue-600" />
               <div className="flex flex-col">
                  <span className="text-[10px] text-blue-600/80 font-bold uppercase tracking-widest">Drop Time</span>
                  <span className="text-sm font-bold text-gray-900">{drop.etaMins} MINS</span>
               </div>
             </div>
          </div>
          {total.distanceKm !== '??' && (
            <p className="text-center text-[11px] font-semibold text-gray-500">
              Total trip ~ {total.distanceKm} KM · ~ {total.etaMins} MINS
            </p>
          )}

        {/* Action Area */}
          <div className="space-y-4 sm:space-y-6 pt-1 sm:pt-2">
            <ActionSlider 
              key={orderKey}
              label="Slide to Accept" 
              onConfirm={() => onAccept(order)} 
              color="bg-black"
              successLabel="Order Accepted ✓"
            />

            <div className="flex justify-between items-center px-4 pt-2">
              <button 
                onClick={onMinimize}
                className="text-gray-400 font-bold text-[10px] uppercase tracking-widest hover:text-gray-600 transition-colors active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={onReject}
                className="text-gray-400 font-bold text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors active:scale-95"
              >
                Pass this task
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChefHat, MapPin, Phone, 
  ChevronDown, ChevronUp, Package, 
  Navigation, CheckCircle2, Camera, Loader2, Image as ImageIcon, FastForward
} from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { toast } from 'sonner';

import { parseLatLng } from '@/modules/DeliveryV2/hooks/proximity.utils';

/**
 * PickupActionModal - Unified White/Green Theme with Slider Actions.
 * Includes Bill Upload feature prior to pickup.
 */
export const PickupActionModal = ({ 
  order, 
  status, 
  isWithinRange, 
  distanceToTarget,
  eta,
  onReachedPickup, 
  onPickedUp,
  onMinimize
}) => {
  const [showItems, setShowItems] = useState(false);
  const [pickupOtp, setPickupOtp] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [isSkippedOtp, setIsSkippedOtp] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);

  if (!order) return null;

  const isAtPickup = status === 'REACHED_PICKUP';
  const restaurantName = order.restaurantName || order.restaurant_name || order.restaurantId?.restaurantName || order.restaurant?.restaurantName || 'Restaurant';
  const restaurantAddress = order.restaurantAddress || order.restaurant_address || order.restaurantLocation?.address || order.restaurantId?.address || 'Address not available';
  const restaurantPhone = order.restaurantPhone || order.restaurant_phone || order.restaurantId?.phone || '';
  const restaurantCoords =
    parseLatLng(order.restaurantLocation) ||
    parseLatLng(order.restaurantId?.location) ||
    parseLatLng(order.restaurant_location);

  const openRestaurantInMaps = () => {
    if (restaurantCoords) {
      const { lat, lng } = restaurantCoords;
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
        '_blank',
      );
      return;
    }
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurantAddress)}`,
      '_blank',
    );
  };

  const distanceLabel = Number.isFinite(distanceToTarget)
    ? `${(distanceToTarget / 1000).toFixed(1)} km • ${eta || '--'} min to Store`
    : 'Locating your position...';
  const items = order.items || [];
  const restaurantLogo = order.restaurantImage || order.restaurant?.logo || order.restaurant?.profileImage || order.restaurantId?.profileImage || order.restaurantId?.logo || 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';

  return (
    <div className="fixed inset-0 z-110 p-0 sm:p-4 flex items-end justify-center">
      {/* Background Dim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/40 -z-10"
      />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-6 sm:pb-12 max-h-[84vh] overflow-y-auto"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center pb-2 sm:pb-4 pt-1">
          <button onClick={onMinimize} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
             <ChevronDown className="w-6 h-6 text-gray-400 stroke-3" />
          </button>
        </div>

        {/* Restaurant Header */}
        <div className="flex items-start justify-between mb-5 sm:mb-8 pb-3 sm:pb-4 border-b border-gray-50">
          <div className="flex gap-3 sm:gap-4">
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-black/5 overflow-hidden border border-gray-100">
              <img src={restaurantLogo} alt="Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h3 className="text-gray-950 text-lg sm:text-xl font-bold">{restaurantName}</h3>
              <p className="text-blue-600 text-[11px] font-black uppercase tracking-widest mt-0.5">
                ORDER #{order.order_id || order.orderId || order._id}
              </p>
              <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 mt-1.5">
                {isAtPickup ? (
                  <span className="text-green-600">Reached Location √</span>
                ) : (
                  <span className="text-orange-500">
                    {distanceLabel}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {restaurantPhone && (
              <button
                onClick={() => window.location.href = `tel:${restaurantPhone}`}
                className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100"
              >
                <Phone className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={openRestaurantInMaps}
              className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-lg"
            >
              <Navigation className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Sliders */}
          <div className="space-y-4 sm:space-y-6">
          {!isAtPickup ? (
            <div>
              <p className={`text-center text-[10px] font-bold uppercase tracking-widest mb-3 transition-colors ${
                isWithinRange ? 'text-green-600' : 'text-orange-500 animate-pulse'
              }`}>
                {isWithinRange ? 'Ready - Swipe to confirm arrival' : 'Get closer to restaurant'}
              </p>
              <ActionSlider 
                key="action-reach"
                label="Slide to Reach" 
                successLabel="Reached!"
                disabled={!isWithinRange}
                onConfirm={onReachedPickup}
                color="bg-green-600"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-center text-[10px] font-bold uppercase tracking-widest mb-3 text-green-600">
                  {isSkippedOtp
                    ? "OTP Bypassed — Swipe to pick up"
                    : otpRequested
                    ? "Enter OTP & Swipe to pick up"
                    : "Request OTP from restaurant or Skip"}
                </p>

                {/* Step 1: Request OTP or Skip OTP buttons */}
                <div className="flex gap-2.5 mb-3">
                  <button
                    onClick={async () => {
                      const orderId = order.order_id || order.orderId || order._id || order.orderMongoId;
                      if (!orderId) { toast.error('Order ID missing'); return; }
                      setIsRequestingOtp(true);
                      try {
                        const { deliveryAPI } = await import('@food/api');
                        await deliveryAPI.requestPickupOtp(orderId);
                        setOtpRequested(true);
                        setIsSkippedOtp(false);
                        toast.success('OTP sent to restaurant! Ask them for the code.');
                      } catch (err) {
                        toast.error(err?.response?.data?.error || 'Failed to send OTP to restaurant');
                      } finally {
                        setIsRequestingOtp(false);
                      }
                    }}
                    disabled={isRequestingOtp}
                    className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl text-white font-black text-xs sm:text-sm uppercase tracking-widest shadow-lg active:scale-95 transition-all disabled:opacity-60 ${otpRequested ? 'bg-orange-400' : 'bg-orange-500'}`}
                  >
                    {isRequestingOtp ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /><span>Sending...</span></>
                    ) : (
                      <span>{otpRequested ? '🔔 Resend' : '🔔 Request OTP'}</span>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setIsSkippedOtp(true);
                      setPickupOtp('');
                      toast.info('OTP Step Bypassed! Slide to Pick Up');
                    }}
                    className={`px-4 py-3.5 rounded-2xl border-2 font-black text-xs uppercase tracking-widest flex items-center gap-1.5 active:scale-95 transition-all ${
                      isSkippedOtp
                        ? 'bg-amber-500 border-amber-500 text-white shadow-lg'
                        : 'bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <FastForward className="w-4 h-4" />
                    <span>{isSkippedOtp ? 'Skipped ✓' : 'Skip OTP'}</span>
                  </button>
                </div>

                {/* Step 2: OTP input + Slider — visible when OTP requested and not skipped */}
                {otpRequested && !isSkippedOtp && (
                  <>
                    <div className="mb-4 px-2">
                      <input
                        type="number"
                        placeholder="Enter 4-digit Pickup OTP"
                        value={pickupOtp}
                        onChange={e => setPickupOtp(e.target.value.slice(0, 4))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-center text-lg font-black tracking-[0.25em] outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
                      />
                    </div>
                    <ActionSlider
                      key="action-pickup"
                      label="Slide to Pick Up"
                      successLabel="Picked Up!"
                      disabled={pickupOtp.length !== 4}
                      onConfirm={() => onPickedUp(null, pickupOtp)}
                      color="bg-orange-500"
                    />
                  </>
                )}

                {/* Step 2 (Skipped): Direct Pickup Slider if OTP is skipped */}
                {isSkippedOtp && (
                  <ActionSlider
                    key="action-pickup-skipped"
                    label="Slide to Pick Up (Bypass OTP)"
                    successLabel="Picked Up!"
                    disabled={false}
                    onConfirm={() => onPickedUp(null, 'SKIP')}
                    color="bg-amber-600"
                  />
                )}
              </div>
            </div>
          )}

          {/* Delivery Instructions (User Note) */}
          {order?.note && (
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3.5 sm:p-4 flex gap-3 items-start">
              <ChefHat className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mb-1.5">User Instructions</p>
                <p className="text-sm font-bold text-gray-800 leading-snug">"{order.note}"</p>
              </div>
            </div>
          )}

          {/* Collapsible Order Summary */}
          <button 
            onClick={() => setShowItems(!showItems)}
            className="w-full flex items-center justify-between p-3.5 sm:p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3 text-gray-900 font-bold text-xs uppercase tracking-widest">
              <Package className="w-5 h-5 text-gray-400" />
              <span>Order Details ({items.length || 0})</span>
            </div>
            {showItems ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>

          {showItems && (
            <div className="overflow-hidden space-y-2 px-1">
              {items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 border-b border-gray-50 last:border-0">
                  <span className="text-gray-700 text-sm font-bold">{item.name || 'Item Name'}</span>
                  <span className="text-green-600 font-bold bg-green-50 px-2.5 py-1 rounded-lg text-xs">x{item.quantity || 1}</span>
                </div>
              ))}
            </div>
          )}


        </div>
      </motion.div>
    </div>
  );
};

export default PickupActionModal;

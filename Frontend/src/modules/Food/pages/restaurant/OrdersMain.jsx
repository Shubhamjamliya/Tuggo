import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  checkOnboardingStatus,
  isRestaurantOnboardingComplete,
} from "@food/utils/onboardingUtils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Printer,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  X,
  AlertCircle,
  Loader2,
  Calendar,
  Clock,
  Users,
  MessageSquare,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import notificationSound from "@food/assets/audio/restaurant-order-ring.wav";
import { restaurantAPI, diningAPI } from "@food/api";
import { useAuthStore } from "@/core/auth/auth.store";
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications";
import useRestaurantLenis from "@food/hooks/useRestaurantLenis";
import usePaginatedRestaurantOrders, {
  RESTAURANT_ORDERS_PAGE_SIZE,
  RESTAURANT_ORDER_TAB_STATUS,
} from "@food/hooks/usePaginatedRestaurantOrders";
import RestaurantOrdersPagination from "@food/components/restaurant/RestaurantOrdersPagination";
import RestaurantBentoGrid from "@food/components/restaurant/RestaurantBentoGrid";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ResendNotificationButton from "@food/components/restaurant/ResendNotificationButton";
import { loadBusinessSettings } from "@food/utils/businessSettings";
const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };

const STORAGE_KEY = "restaurant_online_status";
const DESKTOP_ORDER_ALERT_QUERY = "(min-width: 768px)";

// Top filter tabs
const filterTabs = [
  { id: "new", label: "New" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "out-for-delivery", label: "Out for delivery" },
  { id: "scheduled", label: "Scheduled" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "dead", label: "Dead Orders" },
  { id: "all", label: "All" },
];

const allOrdersStatusPriority = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  out_for_delivery: 4,
  scheduled: 5,
  delivered: 6,
  completed: 6,
  cancelled: 7,
  dead: 8,
};

const getAllOrdersTimestamp = (order) =>
  order?.cancelledAt ||
  order?.deliveredAt ||
  order?.updatedAt ||
  order?.createdAt ||
  new Date().toISOString();

const transformOrderForList = (order) => ({
  orderId: order.orderId || order._id,
  mongoId: order._id,
  status: order.status || "pending",
  customerName: order.userId?.name || order.customerName || "Customer",
  type: "Home Delivery",
  tableOrToken: null,
  timePlaced: new Date(getAllOrdersTimestamp(order)).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ),
  eta: null,
  itemsSummary:
    order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") ||
    "No items",
  photoUrl: order.items?.[0]?.image || null,
  photoAlt: order.items?.[0]?.name || "Order",
  paymentMethod: order.paymentMethod || order.payment?.method || null,
  deliveryPartnerId: order.deliveryPartnerId || null,
  dispatchStatus: order.dispatch?.status || null,
  preparingTimestamp: order.tracking?.preparing?.timestamp
    ? new Date(order.tracking.preparing.timestamp)
    : new Date(order.createdAt || Date.now()),
  initialETA: order.estimatedDeliveryTime || 30,
  sortTimestamp: new Date(getAllOrdersTimestamp(order)).getTime(),
  scheduledAt: order.scheduledAt || null,
  restaurantNote: order.restaurantNote || null,
});

// Completed Orders List Component
function CompletedOrders({ onSelectOrder, refreshToken = 0 }) {
  const { orders: rawOrders, meta, page, loading, setPage } = usePaginatedRestaurantOrders({
    status: RESTAURANT_ORDER_TAB_STATUS.completed,
    refreshToken,
  });

  const orders = rawOrders.map((order) => ({
    orderId: order.orderId || order._id,
    mongoId: order._id,
    status: order.status || "delivered",
    customerName: order.userId?.name || order.customerName || "Customer",
    type: "Home Delivery",
    tableOrToken: null,
    timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    deliveredAt: order.deliveredAt || order.updatedAt || order.createdAt,
    itemsSummary:
      order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") ||
      "No items",
    photoUrl: order.items?.[0]?.image || null,
    photoAlt: order.items?.[0]?.name || "Order",
    amount: order.pricing?.total || order.total || 0,
    paymentMethod: order.paymentMethod || order.payment?.method || null,
  }));

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Completed orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Completed orders</h2>
        <span className="text-xs text-gray-500">{meta.total} total</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No completed orders yet
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => {
            const deliveredDate = order.deliveredAt
              ? new Date(order.deliveredAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
              : "N/A";

            return (
              <div
                key={order.orderId || order.mongoId}
                className="restaurant-bento-card w-full p-3 mb-2.5 lg:mb-0 h-full transition-all">
                <button
                  type="button"
                  onClick={() =>
                    onSelectOrder?.({
                      orderId: order.orderId,
                      status: "Delivered",
                      customerName: order.customerName,
                      type: order.type,
                      tableOrToken: order.tableOrToken,
                      timePlaced: deliveredDate,
                      itemsSummary: order.itemsSummary,
                      paymentMethod: order.paymentMethod,
                    })
                  }
                  className="w-full text-left flex gap-3 items-stretch">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0 my-auto border border-gray-100">
                    {order.photoUrl ? (
                      <img
                        src={order.photoUrl}
                        alt={order.photoAlt}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-1">
                        <span className="text-[9px] font-medium text-gray-400 text-center leading-tight">
                          {order.photoAlt}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-between min-h-[80px]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-bold text-slate-900 leading-none">
                          Order #{order.orderId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium capitalize">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-600">
                          <span className="h-1 w-1 rounded-full bg-emerald-500" />
                          Delivered
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium">
                          {deliveredDate}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {order.itemsSummary}
                      </p>
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <p className="text-[11px] text-gray-500">
                          {order.type}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] text-gray-500">
                          Amount
                        </span>
                        <span className="text-xs font-medium text-black">
                          ₹{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

// Cancelled Orders List Component
function CancelledOrders({ onSelectOrder, refreshToken = 0 }) {
  const { orders: rawOrders, meta, page, loading, setPage } = usePaginatedRestaurantOrders({
    status: RESTAURANT_ORDER_TAB_STATUS.cancelled,
    refreshToken,
  });

  const orders = rawOrders.map((order) => ({
    orderId: order.orderId || order._id,
    mongoId: order._id,
    status: order.status || "cancelled",
    customerName: order.userId?.name || order.customerName || "Customer",
    type: "Home Delivery",
    tableOrToken: null,
    timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    cancelledAt: order.cancelledAt || order.updatedAt || order.createdAt,
    cancelledBy: order.cancelledBy || "unknown",
    cancellationReason: order.cancellationReason || "No reason provided",
    itemsSummary:
      order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") ||
      "No items",
    photoUrl: order.items?.[0]?.image || null,
    photoAlt: order.items?.[0]?.name || "Order",
    amount: order.pricing?.total || order.total || 0,
    paymentMethod: order.paymentMethod || order.payment?.method || null,
    restaurantNote: order.restaurantNote || null,
  }));

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Cancelled orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Cancelled orders</h2>
        <span className="text-xs text-gray-500">{meta.total} total</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No cancelled orders yet
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => {
            const cancelledDate = order.cancelledAt
              ? new Date(order.cancelledAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
              : "N/A";

            const cancelledByText =
              order.cancelledBy === "user"
                ? "Cancelled by User"
                : order.cancelledBy === "restaurant"
                  ? "Cancelled by Restaurant"
                  : "Cancelled";

            return (
              <div
                key={order.orderId || order.mongoId}
                className="restaurant-bento-card w-full p-3 mb-2.5 lg:mb-0 h-full transition-all">
                <button
                  type="button"
                  onClick={() =>
                    onSelectOrder?.({
                      orderId: order.orderId,
                      status: "Cancelled",
                      customerName: order.customerName,
                      type: order.type,
                      tableOrToken: order.tableOrToken,
                      timePlaced: cancelledDate,
                      itemsSummary: order.itemsSummary,
                      paymentMethod: order.paymentMethod,
                    })
                  }
                  className="w-full text-left flex gap-3 items-stretch">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0 my-auto border border-gray-100">
                    {order.photoUrl ? (
                      <img
                        src={order.photoUrl}
                        alt={order.photoAlt}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-1">
                        <span className="text-[9px] font-medium text-gray-400 text-center leading-tight">
                          {order.photoAlt}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-between min-h-[80px]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-bold text-slate-900 leading-none">
                          Order #{order.orderId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium capitalize">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${order.cancelledBy === "user"
                              ? "border-orange-200 bg-orange-50 text-orange-600"
                              : "border-rose-200 bg-rose-50 text-rose-600"
                            }`}>
                          <span
                            className={`h-1 w-1 rounded-full ${order.cancelledBy === "user"
                                ? "bg-orange-500"
                                : "bg-rose-500"
                              }`}
                          />
                          {cancelledByText}
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium">
                          {cancelledDate}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {order.itemsSummary}
                      </p>
                      {order.cancellationReason && (
                        <p className="text-[10px] text-red-600 mt-1 line-clamp-1">
                          Reason: {order.cancellationReason}
                        </p>
                      )}
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <p className="text-[11px] text-gray-500">
                          {order.type}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] text-gray-500">
                          Amount
                        </span>
                        <span className="text-xs font-medium text-black">
                          ₹{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

// Dead Orders List Component
function DeadOrders({ onSelectOrder, refreshToken = 0 }) {
  const { orders: rawOrders, meta, page, loading, setPage } = usePaginatedRestaurantOrders({
    status: RESTAURANT_ORDER_TAB_STATUS.dead,
    refreshToken,
  });

  const orders = rawOrders.map((order) => ({
    orderId: order.orderId || order._id,
    mongoId: order._id,
    status: "dead",
    customerName: order.userId?.name || order.customerName || "Customer",
    type: "Home Delivery",
    tableOrToken: null,
    timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    cancelledAt: order.cancelledAt || order.updatedAt || order.createdAt,
    cancellationReason:
      order.cancellationReason ||
      "Auto-killed: Order was not delivered within 1 hour",
    itemsSummary:
      order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") ||
      "No items",
    photoUrl: order.items?.[0]?.image || null,
    photoAlt: order.items?.[0]?.name || "Order",
    amount: order.pricing?.total || order.total || 0,
    paymentMethod: order.paymentMethod || order.payment?.method || null,
  }));

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Dead orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Dead orders</h2>
        <span className="text-xs text-gray-500">{meta.total} total</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No dead orders found
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => {
            const cancelledDate = order.cancelledAt
              ? new Date(order.cancelledAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
              : "N/A";

            return (
              <div
                key={order.orderId || order.mongoId}
                className="restaurant-bento-card w-full p-3 mb-2.5 lg:mb-0 h-full transition-all">
                <button
                  type="button"
                  onClick={() =>
                    onSelectOrder?.({
                      orderId: order.orderId,
                      status: "Dead",
                      customerName: order.customerName,
                      type: order.type,
                      tableOrToken: order.tableOrToken,
                      timePlaced: cancelledDate,
                      itemsSummary: order.itemsSummary,
                      paymentMethod: order.paymentMethod,
                    })
                  }
                  className="w-full text-left flex gap-3 items-stretch">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0 my-auto border border-gray-100">
                    {order.photoUrl ? (
                      <img
                        src={order.photoUrl}
                        alt={order.photoAlt}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-1">
                        <span className="text-[9px] font-medium text-gray-400 text-center leading-tight">
                          {order.photoAlt}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-between min-h-[80px]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-bold text-slate-900 leading-none">
                          Order #{order.orderId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium capitalize">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border border-zinc-200 bg-zinc-100 text-zinc-600">
                          <span className="h-1 w-1 rounded-full bg-zinc-500" />
                          Dead Order
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium">
                          {cancelledDate}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {order.itemsSummary}
                      </p>
                      {order.cancellationReason && (
                        <p className="text-[10px] text-red-600 mt-1 line-clamp-1">
                          Reason: {order.cancellationReason}
                        </p>
                      )}
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <p className="text-[11px] text-gray-500">
                          {order.type}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] text-gray-500">
                          Amount
                        </span>
                        <span className="text-xs font-medium text-black">
                          ₹{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

// Table Bookings List Component
function TableBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const handleStatusUpdate = async (bookingId, newStatus) => {
    try {
      const response = await diningAPI.updateBookingStatusRestaurant(bookingId, newStatus);
      if (response.data.success) {
        setBookings(prev => prev.map(b =>
          b._id === bookingId ? { ...b, status: newStatus } : b
        ));
        toast.success(`Booking ${newStatus === 'accepted' ? 'accepted' : 'declined'}`);
      }
    } catch (error) {
      debugError("Error updating booking status:", error);
      toast.error("Failed to update booking status");
    }
  };

  useEffect(() => {
    let isMounted = true;

    const fetchBookings = async () => {
      try {
        const res = await restaurantAPI.getCurrentRestaurant();
        const restaurant =
          res.data?.data?.restaurant || res.data?.restaurant || res.data?.data;
        const restaurantId = restaurant?._id || restaurant?.id;

        if (restaurantId) {
          const response = await diningAPI.getRestaurantBookings(restaurant);
          if (isMounted && response.data.success) {
            setBookings(response.data.data);
          }
        }
      } catch (error) {
        debugError("Error fetching table bookings:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchBookings();
    const interval = setInterval(fetchBookings, 8000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await restaurantAPI.getCurrentRestaurant();
      const restaurant = res.data?.data?.restaurant || res.data?.restaurant || res.data?.data;
      const response = await diningAPI.getRestaurantBookings(restaurant);
      if (response.data.success) {
        setBookings(response.data.data);
        toast.success("Bookings refreshed");
      }
    } catch {
      toast.error("Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  if (loading)
    return (
      <div className="text-center py-10 text-gray-400">Loading bookings...</div>
    );

  return (
    <div className="pt-1 pb-6 px-1">
      <div className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="text-base font-semibold text-black">Table Bookings</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="text-[10px] font-black text-primary uppercase tracking-widest hover:opacity-80 transition-opacity"
          >
            Refresh
          </button>
          <span className="text-xs text-gray-500 font-medium">({bookings.length})</span>
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
          <p className="text-gray-400 text-sm">No table bookings yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div
              key={booking._id}
              className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm transition-all hover:border-gray-300">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-gray-900">
                    {booking.user?.name}
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    {booking.user?.phone || "No phone"}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase shadow-sm ${String(booking.status || '').toLowerCase() === "pending"
                      ? "bg-amber-50 text-amber-600 border border-amber-100"
                      : ["accepted", "confirmed"].includes(String(booking.status || '').toLowerCase())
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        : String(booking.status || '').toLowerCase() === "checked-in"
                          ? "bg-orange-100 text-orange-700"
                          : String(booking.status || '').toLowerCase() === "completed"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-rose-100 text-rose-700"
                    }`}>
                  {String(booking.status || '').toLowerCase() === "pending" ? "APPROVAL REQD" :
                    ["accepted", "confirmed"].includes(String(booking.status || '').toLowerCase()) ? "CONFIRMED" :
                      booking.status}
                </span>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span>
                    {new Date(booking.date).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span>{booking.timeSlot}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-gray-400" />
                  <span>{booking.guests} Guests</span>
                </div>
              </div>

              {booking.specialRequest && (
                <div className="mt-3 p-2 bg-blue-50/50 rounded-lg border border-blue-100/50">
                  <p className="text-[10px] text-blue-700 italic flex items-start gap-1">
                    <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">
                      {booking.specialRequest}
                    </span>
                  </p>
                </div>
              )}

              {String(booking.status || '').toLowerCase() === 'pending' && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => handleStatusUpdate(booking._id, 'accepted')}
                    className="flex-1 py-2 bg-emerald-600 text-white text-[11px] font-black rounded-xl hover:bg-emerald-700 transition-colors uppercase tracking-widest shadow-sm"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleStatusUpdate(booking._id, 'cancelled')}
                    className="flex-1 py-2 bg-white border border-rose-200 text-slate-600 text-[11px] font-black rounded-xl hover:bg-slate-50 transition-colors uppercase tracking-widest"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// New Orders List Component
function NewOrders({ onSelectOrder }) {
  const pollMs =
    typeof window !== "undefined" && window.restaurantSocketConnected
      ? 45000
      : 15000;
  const { orders: rawOrders, meta, page, loading, setPage } =
    usePaginatedRestaurantOrders({
      status: RESTAURANT_ORDER_TAB_STATUS.new,
      enablePoll: true,
      pollMs,
    });

  const orders = rawOrders
    .map(transformOrderForList)
    .sort((a, b) => b.sortTimestamp - a.sortTimestamp);

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">New orders</h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-black">New orders</h2>
          <span className="text-xs text-gray-500">({meta.total})</span>
        </div>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No new orders found
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

function AllOrders({ onSelectOrder, onCancel }) {
  const navigate = useNavigate();
  const pollMs =
    typeof window !== "undefined" && window.restaurantSocketConnected
      ? 45000
      : 15000;
  const { orders: rawOrders, meta, page, loading, setPage } =
    usePaginatedRestaurantOrders({
      status: RESTAURANT_ORDER_TAB_STATUS.all,
      enablePoll: true,
      pollMs,
    });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [markingReadyOrderIds, setMarkingReadyOrderIds] = useState({});
  const [orderOverrides, setOrderOverrides] = useState({});

  useEffect(() => {
    const countdownIntervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(countdownIntervalId);
  }, []);

  const orders = rawOrders
    .map(transformOrderForList)
    .map((order) => {
      const key = order.mongoId || order.orderId;
      return orderOverrides[key] ? { ...order, ...orderOverrides[key] } : order;
    })
    .sort((a, b) => {
      const priorityDiff =
        (allOrdersStatusPriority[a.status] ?? 999) -
        (allOrdersStatusPriority[b.status] ?? 999);
      if (priorityDiff !== 0) return priorityDiff;
      return b.sortTimestamp - a.sortTimestamp;
    });

  const handleMarkReady = async ({ orderId, mongoId }) => {
    const orderKey = mongoId || orderId;
    if (!orderKey || markingReadyOrderIds[orderKey]) return;

    try {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: true }));
      await restaurantAPI.markOrderReady(orderKey);
      setOrderOverrides((prev) => ({
        ...prev,
        [orderKey]: {
          status: "ready",
          eta: null,
          sortTimestamp: Date.now(),
        },
      }));
      toast.success("Order marked as ready");
    } catch (error) {
      debugError("Error marking order as ready from All orders:", error);
      toast.error(
        error.response?.data?.message || "Failed to mark order as ready",
      );
    } finally {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: false }));
    }
  };

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">All orders</h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-black">All orders</h2>
          <span className="text-xs text-gray-500">({meta.total})</span>
        </div>
        <button
          onClick={() => navigate('/food/restaurant/orders/all')}
          className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
        >
          Full History
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders found
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => {
            const normalizedStatus = String(order.status || "").toLowerCase();
            let etaDisplay = order.eta;

            if (normalizedStatus === "preparing" && order.preparingTimestamp) {
              const elapsedMs = currentTime - order.preparingTimestamp;
              const elapsedMinutes = Math.floor(elapsedMs / 60000);
              const remainingMinutes = Math.max(
                0,
                order.initialETA - elapsedMinutes,
              );

              if (remainingMinutes <= 0) {
                const remainingSeconds = Math.max(
                  0,
                  Math.floor(order.initialETA * 60 - elapsedMs / 1000),
                );
                etaDisplay =
                  remainingSeconds > 0 ? `${remainingSeconds} secs` : "0 mins";
              } else {
                etaDisplay = `${remainingMinutes} mins`;
              }
            }

            return (
              <OrderCard
                key={order.orderId || order.mongoId}
                {...order}
                eta={etaDisplay}
                onSelect={onSelectOrder}
                onCancel={
                  normalizedStatus === "preparing" ? onCancel : undefined
                }
                onMarkReady={
                  normalizedStatus === "preparing" ? handleMarkReady : undefined
                }
                isMarkingReady={Boolean(
                  markingReadyOrderIds[order.mongoId || order.orderId],
                )}
              />
            );
          })}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

// Search Results Component
function SearchResults({ query, results, isLoading, onSelectOrder }) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-gray-500 text-sm">Searching for "{query}"...</p>
      </div>
    );
  }

  const transformedResults = (results || []).map(transformOrderForList);

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-semibold text-black">Search results for</h2>
        <span className="bg-gray-200 px-2 py-0.5 rounded text-sm text-gray-700 italic">"{query}"</span>
        <span className="text-xs text-gray-500 font-medium ml-1">({transformedResults.length})</span>
      </div>

      {transformedResults.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-gray-300" />
          </div>
          <p className="text-gray-900 font-bold mb-1">No results found</p>
          <p className="text-gray-500 text-xs">Try searching for a different order ID or customer name</p>
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {transformedResults.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </RestaurantBentoGrid>
      )}
    </div>
  );
}

// Scheduled Orders Component
function ScheduledOrders({ onSelectOrder, refreshToken }) {
  const navigate = useNavigate();
  const { orders: rawOrders, meta, page, loading, setPage } =
    usePaginatedRestaurantOrders({
      status: RESTAURANT_ORDER_TAB_STATUS.scheduled,
      refreshToken,
    });

  const orders = rawOrders
    .map(transformOrderForList)
    .sort((a, b) => {
      const timeA = new Date(a.scheduledAt || 0).getTime();
      const timeB = new Date(b.scheduledAt || 0).getTime();
      return timeA - timeB;
    });

  if (loading) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-black">Scheduled orders</h2>
          <span className="text-xs text-gray-500">({meta.total})</span>
        </div>
        <button
          onClick={() => navigate("/food/restaurant/orders/all")}
          className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1">
          Full History
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm italic">
          No scheduled orders found
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

// Helper to calculate initial countdown based on popup display time (3 minutes window)
const getInitialCountdown = (order) => {
  // Always return 180 seconds (3 minutes) when the popup is shown, 
  // so orders queued behind others don't run out of time in the background.
  return 180;
}

export default function OrdersMain() {
  const navigate = useNavigate();
  useRestaurantLenis();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [activeFilter, setActiveFilter] = useState("new");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const contentRef = useRef(null);
  const filterBarRef = useRef(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);
  const mouseStartX = useRef(0);
  const mouseEndX = useRef(0);
  const isMouseDown = useRef(false);

  /**
   * Extract the best available order ID to use for API calls.
   * Prefers the MongoDB _id (most reliable), then orderMongoId / mongoId,
   * then falls back to the short orderId string.
   */
  const resolveOrderActionId = (orderLike) => {
    if (!orderLike) return null;
    const raw =
      orderLike._id ||
      orderLike.orderMongoId ||
      orderLike.mongoId ||
      orderLike.orderId ||
      orderLike.order_id ||
      orderLike.id ||
      null;
    const id = String(raw || '').trim();
    return id || null;
  };

  // New order popup states
  const [showNewOrderPopup, setShowNewOrderPopup] = useState(false);
  const [popupOrder, setPopupOrder] = useState(null); // Store order for popup (from Socket.IO or API)
  const [isMuted, setIsMuted] = useState(false);
  const [isDesktopView, setIsDesktopView] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(DESKTOP_ORDER_ALERT_QUERY).matches
      : false,
  );
  const [prepTime, setPrepTime] = useState(11);
  const [countdown, setCountdown] = useState(180); // 3 minutes in seconds
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(true);
  const [showRejectPopup, setShowRejectPopup] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showCancelPopup, setShowCancelPopup] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [acceptSwipeProgress, setAcceptSwipeProgress] = useState(0);
  const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);
  const audioRef = useRef(null);
  const shownOrdersRef = useRef(new Set()); // Track orders already shown in popup
  const acceptSliderRef = useRef(null);
  const acceptSwipeStartXRef = useRef(0);
  const acceptSwipeActiveRef = useRef(false);
  const [restaurantStatus, setRestaurantStatus] = useState({
    isActive: null,
    rejectionReason: null,
    onboarding: null,
    isLoading: true,
  });
  const [isReverifying, setIsReverifying] = useState(false);
  const audioUnlockedRef = useRef(false);
  const isDesktopViewRef = useRef(isDesktopView);
  const showNewOrderPopupRef = useRef(showNewOrderPopup);
  useEffect(() => {
    showNewOrderPopupRef.current = showNewOrderPopup;
  }, [showNewOrderPopup]);
  const isMutedRef = useRef(isMuted);
  const newOrderRef = useRef(null);
  // Refs to always have latest popup order & dismiss helper available in event listeners
  const popupOrderRef = useRef(null);
  const cancelDismissRef = useRef(null);

  // Pending counts for tabs
  const [pendingBookingsCount, setPendingBookingsCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [pendingDiningRequest, setPendingDiningRequest] = useState(null);

  // Fetch pending counts and settings
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchCounts = async () => {
      try {
        // Fetch current restaurant data
        const resRes = await restaurantAPI.getCurrentRestaurant();
        const restaurantData = resRes.data?.data?.restaurant || resRes.data?.restaurant || resRes.data?.data;

        if (restaurantData?._id || restaurantData?.id) {
          // 1. Fetch bookings
          const res = await diningAPI.getRestaurantBookings(restaurantData);
          if (res.data.success) {
            const bookings = Array.isArray(res.data.data) ? res.data.data : [];
            const pending = bookings.filter(b => String(b.status).toLowerCase() === 'pending').length;

            // If new pending booking found, maybe show toast
            if (pending > pendingBookingsCount) {
              toast.info(`New table booking request! Check the "Table Booking" tab.`);
              // Optional: Play sound
              if (audioRef.current && !isMutedRef.current) {
                audioRef.current.play().catch(() => { });
              }
            }
            setPendingBookingsCount(pending);
          }

          // 2. Fetch pending dining request (for restaurant's own request to enable/update dining)
          const requestRes = await restaurantAPI.getPendingDiningRequest();
          if (requestRes.data.success && requestRes.data.data) {
            setPendingDiningRequest(requestRes.data.data);
          } else {
            setPendingDiningRequest(null);
          }
        }

        // 3. Fetch pending orders
        const ordersRes = await restaurantAPI.getOrders({ page: 1, limit: 100 });
        if (ordersRes.data.success) {
          const orders = Array.isArray(ordersRes.data.data?.orders) ? ordersRes.data.data.orders : [];
          const pending = orders.filter(o =>
            String(o.status).toLowerCase() === 'pending' ||
            String(o.status).toLowerCase() === 'created' ||
            String(o.status).toLowerCase() === 'confirmed'
          ).length;
          setPendingOrdersCount(pending);
        }
      } catch (error) {
        // Non-blocking
      }
    };

    fetchCounts();
    const interval = setInterval(() => {
      if (isAuthenticated) fetchCounts();
    }, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Global search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Global search listener
  useEffect(() => {
    const handleSearch = (event) => {
      const { query, results, isLoading } = event.detail;
      setSearchQuery(query || "");
      setSearchResults(results || []);
      setIsSearching(isLoading || false);
    };

    window.addEventListener("restaurantSearchUpdated", handleSearch);
    return () =>
      window.removeEventListener("restaurantSearchUpdated", handleSearch);
  }, []);

  const markOrderAsShown = (orderLike) => {
    const keys = [
      orderLike?.orderMongoId,
      orderLike?.orderId,
      orderLike?._id,
      orderLike?.id,
    ]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);

    for (const k of keys) shownOrdersRef.current.add(k);
  };

  const hasOrderBeenShown = (orderLike) => {
    const keys = [
      orderLike?.orderMongoId,
      orderLike?.orderId,
      orderLike?._id,
      orderLike?.id,
    ]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);

    return keys.some((k) => shownOrdersRef.current.has(k));
  };

  const getOrderActionIds = (orderLike) => {
    const ids = [
      orderLike?.orderMongoId,
      orderLike?._id,
      orderLike?.orderId,
      orderLike?.order_id,
      orderLike?.id,
    ];
    return ids
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);
  };

  const doOrdersMatch = (order1, order2) => {
    if (!order1 || !order2) return false;
    const ids1 = getOrderActionIds(order1);
    const ids2 = getOrderActionIds(order2);
    return ids1.some((id) => ids2.includes(id));
  };
  const normalizeOrderStatusValue = (value) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_");

  const isUserCancelledStatus = (statusValue) =>
    normalizeOrderStatusValue(statusValue) === "cancelled_by_user";

  const isAnyCancelledStatus = (statusValue) => {
    const normalized = normalizeOrderStatusValue(statusValue);
    return (
      normalized === "cancelled" ||
      normalized === "cancelled_by_user" ||
      normalized === "cancelled_by_restaurant" ||
      normalized === "cancelled_by_admin"
    );
  };

  const getPopupOrderTotal = (orderLike) => {
    if (!orderLike) return 0;

    const directTotal = Number(orderLike.total);
    if (Number.isFinite(directTotal) && directTotal > 0) return directTotal;

    const pricingTotal = Number(orderLike.pricing?.total);
    if (Number.isFinite(pricingTotal) && pricingTotal > 0) return pricingTotal;

    const amountDue = Number(orderLike.payment?.amountDue);
    if (Number.isFinite(amountDue) && amountDue > 0) return amountDue;

    const items = Array.isArray(orderLike.items) ? orderLike.items : [];
    const itemsTotal = items.reduce((sum, item) => {
      const price = Number(item?.price || 0);
      const qty = Number(item?.quantity || 0);
      return sum + (Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) ? qty : 0);
    }, 0);

    return Number.isFinite(itemsTotal) ? itemsTotal : 0;
  };

  // Restaurant notifications hook for real-time orders
  const { newOrder, orderQueue, clearNewOrder, isConnected } = useRestaurantNotifications();

  const rejectReasons = [
    "Restaurant is too busy",
    "Item not available",
    "Outside delivery area",
    "Kitchen closing soon",
    "Technical issue",
    "Other reason",
  ];

  // Fetch restaurant verification status
  useEffect(() => {
    const fetchRestaurantStatus = async () => {
      if (!isAuthenticated) return;
      try {
        const response = await restaurantAPI.getCurrentRestaurant();
        const restaurant =
          response?.data?.data?.restaurant || response?.data?.restaurant;
        if (restaurant) {
          setRestaurantStatus({
            isActive: restaurant.isActive,
            status: restaurant.status,
            approvedAt: restaurant.approvedAt,
            pendingUpdateReason: restaurant.pendingUpdateReason,
            rejectionReason: restaurant.rejectionReason || null,
            onboarding: restaurant.onboarding || null,
            isLoading: false,
          });

          // Check if onboarding is incomplete and redirect if needed
          if (!isRestaurantOnboardingComplete(restaurant)) {
            // Onboarding is incomplete, redirect to onboarding page
            const incompleteStep = await checkOnboardingStatus();
            if (incompleteStep) {
              navigate(`/food/restaurant/onboarding?step=${incompleteStep}`, {
                replace: true,
              });
              return;
            }
          }
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (
          error.code !== "ERR_NETWORK" &&
          error.code !== "ECONNABORTED" &&
          !error.message?.includes("timeout")
        ) {
          debugError("Error fetching restaurant status:", error);
        }
        // Set loading to false so UI doesn't stay in loading state
        setRestaurantStatus((prev) => ({ ...prev, isLoading: false }));
      }
    };

    fetchRestaurantStatus();

    // Listen for restaurant profile updates
    const handleProfileRefresh = () => {
      fetchRestaurantStatus();
    };

    window.addEventListener("restaurantProfileRefresh", handleProfileRefresh);

    return () => {
      window.removeEventListener(
        "restaurantProfileRefresh",
        handleProfileRefresh,
      );
    };
  }, [navigate, isAuthenticated]);

  // Handle reverify (resubmit for approval)
  const handleReverify = async () => {
    try {
      setIsReverifying(true);
      await restaurantAPI.reverify();

      // Refresh restaurant status
      const response = await restaurantAPI.getCurrentRestaurant();
      const restaurant =
        response?.data?.data?.restaurant || response?.data?.restaurant;
      if (restaurant) {
        setRestaurantStatus({
          isActive: restaurant.isActive,
          rejectionReason: restaurant.rejectionReason || null,
          onboarding: restaurant.onboarding || null,
          isLoading: false,
        });
      }

      // Trigger profile refresh event
      window.dispatchEvent(new Event("restaurantProfileRefresh"));

      alert(
        "Restaurant reverified successfully! Verification will be done in 24 hours.",
      );
    } catch (error) {
      // Don't log network/timeout errors (backend might be down)
      if (
        error.code !== "ERR_NETWORK" &&
        error.code !== "ECONNABORTED" &&
        !error.message?.includes("timeout")
      ) {
        debugError("Error reverifying restaurant:", error);
      }

      // Handle 401 Unauthorized errors (token expired/invalid)
      if (error.response?.status === 401) {
        const errorMessage =
          error.response?.data?.message ||
          "Your session has expired. Please login again.";
        alert(errorMessage);
        // The axios interceptor should handle redirecting to login
        // But if it doesn't, we can manually redirect
        if (!error.response?.data?.message?.includes("inactive")) {
          // Only redirect if it's not an "inactive" error (which we handle differently)
          setTimeout(() => {
            window.location.href = "/restaurant/login";
          }, 1500);
        }
      } else {
        // Other errors (400, 500, etc.)
        const errorMessage =
          error.response?.data?.message ||
          "Failed to reverify restaurant. Please try again.";
        alert(errorMessage);
      }
    } finally {
      setIsReverifying(false);
    }
  };

  // Show new order popup when real order notification arrives
  // Queue-aware: if a popup is already open, mark order as shown and let
  // the queue handle it when the current popup is dismissed.
  useEffect(() => {
    if (newOrder) {
      debugLog("?? New order (queue head) changed:", newOrder);

      if (isAnyCancelledStatus(newOrder?.status || newOrder?.orderStatus)) {
        clearNewOrder();
        return;
      }

      const scheduledAt = newOrder.scheduledAt
        ? new Date(newOrder.scheduledAt).getTime()
        : null;
      const isFutureScheduled =
        scheduledAt && scheduledAt > Date.now() + 30 * 60000;

      if (isFutureScheduled) {
        toast.info(
          `New scheduled order received for ${new Date(scheduledAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`,
        );
        clearNewOrder(); // remove from queue so next order can be shown
        requestOrdersRefresh();
        return;
      }

      if (!hasOrderBeenShown(newOrder)) {
        markOrderAsShown(newOrder);
        if (!showNewOrderPopupRef.current) {
          // Popup is free — show it immediately
          setPopupOrder(newOrder);
          setShowNewOrderPopup(true);
          setCountdown(getInitialCountdown(newOrder));
        }
        // If popup is already open, the queue will auto-show this order
        // once the current popup is dismissed (via clearNewOrder → dequeue).
        requestOrdersRefresh();
      }
    }
  }, [newOrder]);

  // Keep popupOrderRef in sync so the cancel event listener always has the latest value
  useEffect(() => {
    popupOrderRef.current = popupOrder;
  }, [popupOrder]);

  // Keep cancelDismissRef pointing to the latest dismiss function
  useEffect(() => {
    cancelDismissRef.current = (payload) => {
      const currentPopupOrder = popupOrderRef.current;
      const currentNewOrder = newOrderRef.current;
      const activePopupOrder = currentPopupOrder || currentNewOrder;

      // We always want to mark the cancelled order as shown
      markOrderAsShown(payload);

      // If there is an active popup and it's NOT the order that was just cancelled, do NOT close it!
      if (activePopupOrder && payload && !doOrdersMatch(activePopupOrder, payload)) {
        debugLog("?? Ignoring cancellation event because popup is showing a different order");
        return;
      }

      // Mark as shown so checkOrdersToPopup never re-opens it
      if (activePopupOrder) markOrderAsShown(activePopupOrder);

      setShowNewOrderPopup(false);
      setPopupOrder(null);
      clearNewOrder();
      setCountdown(180);
      setPrepTime(11);
      requestOrdersRefresh();
    };
  });

  // Register cancel listener ONCE on mount using stable refs — no stale closures
  useEffect(() => {
    const onRestaurantOrderStatusUpdate = (event) => {
      const payload = event?.detail || {};
      const payloadStatus = payload?.orderStatus || payload?.status;
      const updatedBy = payload?.updatedBy;

      const normalizedStatus = normalizeOrderStatusValue(payloadStatus);

      // --- ADMIN ACCEPTANCE LOGIC ---
      if (
        (normalizedStatus === "confirmed" || normalizedStatus === "preparing") &&
        updatedBy === "ADMIN"
      ) {
        if (cancelDismissRef.current) {
          cancelDismissRef.current(payload);
        }
        toast.success("Order assigned by admin to you");
        return;
      }

      if (!isAnyCancelledStatus(payloadStatus)) return;

      // Use ref-based dismiss so we always act on latest state
      if (cancelDismissRef.current) {
        cancelDismissRef.current(payload);
      }

      if (isUserCancelledStatus(normalizedStatus)) {
        toast.info("Order canceled by user");
      } else {
        toast.info("Order cancelled");
      }
    };

    window.addEventListener("restaurantOrderStatusUpdate", onRestaurantOrderStatusUpdate);
    return () => {
      window.removeEventListener("restaurantOrderStatusUpdate", onRestaurantOrderStatusUpdate);
    };
  }, []); // Empty deps — registered once, uses refs internally

  // Keep refs in sync to avoid stale state inside one-time event handlers.
  useEffect(() => {
    showNewOrderPopupRef.current = showNewOrderPopup;
  }, [showNewOrderPopup]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isDesktopViewRef.current = isDesktopView;
  }, [isDesktopView]);

  useEffect(() => {
    newOrderRef.current = newOrder;
  }, [newOrder]);

  // Initialize audio object for popup loop
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(notificationSound);
      audioRef.current.preload = "auto";
    }

    const desktopMediaQuery = window.matchMedia(DESKTOP_ORDER_ALERT_QUERY);
    const handleDesktopViewChange = (event) => setIsDesktopView(event.matches);

    setIsDesktopView(desktopMediaQuery.matches);
    desktopMediaQuery.addEventListener("change", handleDesktopViewChange);

    return () => {
      desktopMediaQuery.removeEventListener("change", handleDesktopViewChange);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);

  // Best-effort unlock for popup buzzer so it can keep playing when tab is backgrounded.
  useEffect(() => {
    const unlockAudio = async () => {
      if (audioUnlockedRef.current || !audioRef.current) return;
      try {
        audioRef.current.muted = true;
        await audioRef.current.play();
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.muted = false;
        audioRef.current.volume = 1;
        audioUnlockedRef.current = true;

        // If an order popup is already open, start buzzing immediately after unlock.
        if (
          showNewOrderPopupRef.current &&
          isDesktopViewRef.current &&
          !isMutedRef.current
        ) {
          audioRef.current.loop = true;
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => { });
        }
      } catch (_) {
        audioRef.current.muted = false;
      }
    };

    window.addEventListener("pointerdown", unlockAudio, {
      once: true,
      passive: true,
    });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  const [ordersRefreshToken, setOrdersRefreshToken] = useState(0);
  const requestOrdersRefresh = () => setOrdersRefreshToken((t) => t + 1);

  // Check for confirmed orders that haven't been shown in popup yet, or scheduled orders whose time has come
  useEffect(() => {
    const checkOrdersToPopup = async () => {
      // Skip if popup is already showing or Socket.IO order exists
      if (showNewOrderPopupRef.current || newOrderRef.current) return;

      try {
        const response = await restaurantAPI.getOrders();
        if (response.data?.success && response.data.data?.orders) {
          const now = Date.now();

          // Find orders that should trigger the popup
          const targetOrders = response.data.data.orders.filter((order) => {
            if (hasOrderBeenShown(order)) return false;

            const isConfirmed = order.status === "confirmed";
            const isCreatedScheduled =
              order.status === "created" && order.scheduledAt;

            if (isConfirmed && !order.scheduledAt) return true; // ordinary confirmed fallback

            if (
              order.scheduledAt &&
              (order.status === "created" || order.status === "confirmed")
            ) {
              const scheduledTime = new Date(order.scheduledAt).getTime();
              // Show popup if scheduled time is <= 30 mins from now
              if (scheduledTime <= now + 30 * 60000) return true;
            }

            return false;
          });

          // Show the most recent matching order in popup
          if (
            targetOrders.length > 0 &&
            !showNewOrderPopupRef.current &&
            !newOrderRef.current
          ) {
            const orderToPopup = targetOrders[0];
            const orderId = orderToPopup.orderId || orderToPopup._id;

            // Transform order to match newOrder format (include payment so COD shows correctly)
            const orderForPopup = {
              orderId: orderToPopup.orderId,
              orderMongoId: orderToPopup._id,
              restaurantId: orderToPopup.restaurantId,
              restaurantName: orderToPopup.restaurantName,
              items: orderToPopup.items || [],
              total: orderToPopup.pricing?.total || 0,
              customerAddress: orderToPopup.address,
              status: orderToPopup.status,
              createdAt: orderToPopup.createdAt,
              scheduledAt: orderToPopup.scheduledAt,
              estimatedDeliveryTime: orderToPopup.estimatedDeliveryTime || 30,
              note: orderToPopup.note || "",
              sendCutlery: orderToPopup.sendCutlery,
              paymentMethod:
                orderToPopup.paymentMethod ||
                orderToPopup.payment?.method ||
                null,
              payment: orderToPopup.payment,
            };

            debugLog("?? Found order ready for popup:", orderForPopup);
            markOrderAsShown({ orderId, _id: orderToPopup._id });
            setPopupOrder(orderForPopup);
            setShowNewOrderPopup(true);
            setCountdown(getInitialCountdown(orderForPopup)); // Calculate relative to createdAt
          }
        }
      } catch (error) {
        if (error.response?.status !== 401) {
          debugError("Error checking orders to popup:", error);
        }
      }
    };

    // Check once on mount, and then every minute
    checkOrdersToPopup();
    const intervalId = setInterval(checkOrdersToPopup, 60000);

    return () => clearInterval(intervalId);
  }, [ordersRefreshToken]);

  // Ring continuously for a new order on desktop only. Switching to a mobile
  // viewport, accepting/rejecting the order, or unmounting stops the sound.
  useEffect(() => {
    if (showNewOrderPopup && isDesktopView && !isMuted) {
      if (audioRef.current) {
        audioRef.current.loop = true;
        audioRef.current.muted = false;
        audioRef.current.volume = 1;
        audioRef.current.currentTime = 0;
        audioRef.current
          .play()
          .catch((err) => debugLog("Audio play failed:", err));
      }
    } else if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [showNewOrderPopup, isDesktopView, isMuted]);

  useEffect(() => {
    if (showNewOrderPopup && countdown > 0) {
      const timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    } else if (showNewOrderPopup && countdown === 0) {
      // Auto-reject when timer hits zero
      const orderToReject = popupOrder || newOrder;
      const orderId = resolveOrderActionId(orderToReject);

      if (orderId && !isAcceptingOrder) {
        debugLog("?? Timer expired. Auto-rejecting order:", orderId);
        restaurantAPI.rejectOrder(orderId, "No response from restaurant (Auto-rejected)")
          .then(() => {
            toast.info("Order auto-rejected due to no response");
            requestOrdersRefresh();
            setShowNewOrderPopup(false);
            setPopupOrder(null);
            clearNewOrder();
            setCountdown(180);
          })
          .catch((err) => {
            debugError("Auto-reject failed:", err);
            setShowNewOrderPopup(false);
          });
      } else {
        setShowNewOrderPopup(false);
      }
    }
  }, [showNewOrderPopup, countdown, popupOrder, newOrder, isAcceptingOrder]);

  useEffect(() => {
    if (!showNewOrderPopup) {
      setAcceptSwipeProgress(0);
      setIsAcceptingOrder(false);
      acceptSwipeActiveRef.current = false;
      acceptSwipeStartXRef.current = 0;
    }
  }, [showNewOrderPopup]);

  // Removed the 2.5s delay on cancellation; it is now handled instantly via socket event

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (acceptSwipeActiveRef.current) {
        handleAcceptSwipeMove(event.clientX);
      }
    };

    const handleTouchMove = (event) => {
      if (acceptSwipeActiveRef.current && event.touches[0]) {
        // Prevent page scroll while swiping the slider
        if (typeof event.preventDefault === "function") event.preventDefault();
        handleAcceptSwipeMove(event.touches[0].clientX);
      }
    };

    const handlePointerEnd = () => {
      if (acceptSwipeActiveRef.current) {
        handleAcceptSwipeEnd();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handlePointerEnd);
    // passive: false is required to allow preventDefault() during swipe
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handlePointerEnd);
    window.addEventListener("touchcancel", handlePointerEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handlePointerEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handlePointerEnd);
      window.removeEventListener("touchcancel", handlePointerEnd);
    };
  }, [isAcceptingOrder]);

  // Format countdown time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getAcceptSliderMetrics = () => {
    const sliderWidth = acceptSliderRef.current?.offsetWidth || 320;
    const handleWidth = 56;
    const horizontalPadding = 8;
    const maxTravel = Math.max(
      sliderWidth - handleWidth - horizontalPadding * 2,
      1,
    );
    return { maxTravel };
  };

  const triggerSwipeAccept = () => {
    if (isAcceptingOrder) return;
    setAcceptSwipeProgress(1);
    setTimeout(() => {
      handleAcceptOrder();
    }, 160);
  };

  const handleAcceptSwipeStart = (clientX) => {
    if (isAcceptingOrder) return;
    acceptSwipeStartXRef.current = clientX;
    acceptSwipeActiveRef.current = true;
  };

  const handleAcceptSwipeMove = (clientX) => {
    if (!acceptSwipeActiveRef.current || isAcceptingOrder) return;
    const deltaX = Math.max(clientX - acceptSwipeStartXRef.current, 0);
    const { maxTravel } = getAcceptSliderMetrics();
    setAcceptSwipeProgress(Math.min(deltaX / maxTravel, 1));
  };

  const handleAcceptSwipeEnd = () => {
    if (!acceptSwipeActiveRef.current || isAcceptingOrder) return;
    acceptSwipeActiveRef.current = false;

    if (acceptSwipeProgress >= 0.45) {
      triggerSwipeAccept();
      return;
    }

    setAcceptSwipeProgress(0);
  };

  // Handle accept order
  const handleAcceptOrder = async () => {
    if (isAcceptingOrder) return;
    setIsAcceptingOrder(true);

    // Use popupOrder (from Socket.IO or API fallback) or newOrder (from hook)
    const orderToAccept = popupOrder || newOrder;

    // Ensure this order can't re-trigger fallback popup by using a different id key.
    markOrderAsShown(orderToAccept);

    // Accept order via API if we have a real order
    let orderId = resolveOrderActionId(orderToAccept);
    if (!orderId) {
      try {
        const latest = await restaurantAPI.getOrders({ page: 1, limit: 20 });
        const orders = latest?.data?.data?.orders || [];
        const target = orders.find((o) => {
          const s = String(o?.status || o?.orderStatus || "").toLowerCase();
          return s === "confirmed" || s === "created";
        });
        orderId = resolveOrderActionId(target);
      } catch (_) {
        // keep empty orderId and show existing error below
      }
    }

    if (orderId) {
      try {
        const response = await restaurantAPI.acceptOrder(orderId, prepTime);
        debugLog("? Order accepted:", orderId);
        toast.success("Order accepted successfully");
        requestOrdersRefresh();
      } catch (error) {
        debugError("? Error accepting order:", error);
        const errorMessage =
          error.response?.data?.message ||
          error.message ||
          "Failed to accept order. Please try again.";

        // Show specific error message
        if (error.response?.status === 400) {
          toast.error(errorMessage);
        } else if (error.response?.status === 404) {
          toast.error(
            "Order not found. It may have been cancelled or already processed.",
          );
        } else {
          toast.error(errorMessage);
        }
        setIsAcceptingOrder(false);
        setAcceptSwipeProgress(0);
        return;
      }
    } else {
      toast.error("Unable to accept this order: order id missing");
      setIsAcceptingOrder(false);
      setAcceptSwipeProgress(0);
      return;
    }

    setShowNewOrderPopup(false);
    setPopupOrder(null);
    clearNewOrder();
    setCountdown(180);
    setPrepTime(11);
    setAcceptSwipeProgress(0);
    setIsAcceptingOrder(false);

    // Note: PreparingOrders component will automatically refresh orders via its own useEffect
    // No need to manually refresh here as the component polls every 10 seconds
  };

  // Handle reject order
  const handleRejectClick = () => {
    setShowRejectPopup(true);
  };

  const handleRejectConfirm = async () => {
    if (!rejectReason) return;

    // Use popupOrder (from Socket.IO or API fallback) or newOrder (from hook)
    const orderToReject = popupOrder || newOrder;

    // Reject order via API if we have a real order
    if (orderToReject?.orderMongoId || orderToReject?.orderId) {
      try {
        const orderId = orderToReject.orderMongoId || orderToReject.orderId;
        await restaurantAPI.rejectOrder(orderId, rejectReason);
        debugLog("? Order rejected:", orderId);
        requestOrdersRefresh();
      } catch (error) {
        debugError("? Error rejecting order:", error);
        alert("Failed to reject order. Please try again.");
        return;
      }
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setShowRejectPopup(false);
    setShowNewOrderPopup(false);
    setPopupOrder(null);
    clearNewOrder();
    setRejectReason("");
    setCountdown(180);
    setPrepTime(11);
  };

  const handleRejectCancel = () => {
    setShowRejectPopup(false);
    setShowNewOrderPopup(false);
    setPopupOrder(null);
    clearNewOrder();
    setRejectReason("");
    setCountdown(180);
  };

  // Handle cancel order (for preparing orders)
  const handleCancelClick = (order) => {
    setOrderToCancel(order);
    setShowCancelPopup(true);
  };

  const handleCancelConfirm = async () => {
    if (!cancelReason.trim() || !orderToCancel) return;

    try {
      const orderId = orderToCancel.mongoId || orderToCancel.orderId;
      await restaurantAPI.rejectOrder(orderId, cancelReason.trim());
      toast.success("Order cancelled successfully");
      requestOrdersRefresh();
      setShowCancelPopup(false);
      setOrderToCancel(null);
      setCancelReason("");
    } catch (error) {
      debugError("? Error cancelling order:", error);
      toast.error(error.response?.data?.message || "Failed to cancel order");
    }
  };

  const handleCancelPopupClose = () => {
    setShowCancelPopup(false);
    setOrderToCancel(null);
    setCancelReason("");
  };

  // Toggle mute
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      if (!isMuted) {
        audioRef.current.pause();
      } else {
        audioRef.current.muted = false;
        audioRef.current.volume = 1;
        audioRef.current.currentTime = 0;
        audioRef.current
          .play()
          .catch((err) => debugLog("Audio play failed:", err));
      }
    }
  };

  // Handle Thermal Printer Web Print
  const handlePrint = async () => {
    const orderToPrint = popupOrder || newOrder;
    if (!orderToPrint) {
      debugWarn("No order data available for PDF generation");
      return;
    }

    try {
      toast.info("Preparing thermal receipt...");

      // Load settings
      let settings = {};
      try {
        settings = await loadBusinessSettings() || {};
      } catch (err) {
        debugWarn("Could not load business settings", err);
      }

      // Load restaurant details
      let restaurant = {};
      try {
        const resData = await restaurantAPI.getCurrentRestaurant();
        restaurant = resData?.data?.data?.restaurant || resData?.data?.restaurant || {};
      } catch (err) {
        debugWarn("Could not load restaurant details", err);
      }

      const pricing = orderToPrint.pricing || {};
      const itemsTotal = orderToPrint.items?.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0) || 0;
      const subtotal = pricing.subtotal || itemsTotal;
      const tax = pricing.tax || 0;
      const deliveryFee = pricing.deliveryFee || 0;
      const platformFee = pricing.platformFee || 0;
      const total = pricing.total || orderToPrint.total || (subtotal + tax + deliveryFee + platformFee);

      const rawPay = (orderToPrint.paymentMethod || orderToPrint.payment?.method || "").toLowerCase().trim();
      const isCod = rawPay === "cash" || rawPay === "cod";

      const itemsHtml = (orderToPrint.items || []).map(item => `
        <div class="item-row">
          <div class="item-qty">${item.quantity}x</div>
          <div class="item-name">${item.name}</div>
          <div class="item-price">Rs.${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</div>
        </div>
      `).join('');

      const orderDate = orderToPrint.createdAt ? new Date(orderToPrint.createdAt).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

      const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            @page { margin: 0; }
            body {
              font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
              width: 80mm;
              margin: 0;
              padding: 5mm;
              padding-bottom: 10mm;
              font-size: 12px;
              color: #000;
              box-sizing: border-box;
            }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .divider { border-bottom: 1px dashed #000; margin: 8px 0; }
            .flex-between { display: flex; justify-content: space-between; }
            .item-row { display: flex; margin-bottom: 5px; }
            .item-qty { width: 15%; font-weight: bold; }
            .item-name { width: 55%; padding-right: 5px; }
            .item-price { width: 30%; text-align: right; }
            h1 { font-size: 16px; margin: 5px 0; }
            h2 { font-size: 14px; margin: 5px 0; }
            p { margin: 3px 0; }
          </style>
        </head>
        <body>
          <div class="center">
            <h1>${restaurant.restaurantName || orderToPrint.restaurantName || "Restaurant"}</h1>
            ${restaurant.address?.street ? `<p>${restaurant.address.street}, ${restaurant.address.city || ''}</p>` : ''}
            <p>FSSAI: ${restaurant.fssaiNumber || restaurant.fssai || "N/A"}</p>
          </div>
          
          <div class="divider"></div>
          
          <p class="bold">Order ID: #${orderToPrint.orderId || orderToPrint._id}</p>
          <p>Date: ${orderDate}</p>
          <p>Payment: <span class="bold">${isCod ? 'Cash on Delivery' : 'Paid Online'}</span></p>
          
          <div class="divider"></div>
          
          <p class="bold">Customer Details:</p>
          <p>${orderToPrint.customerName || "Customer"}</p>
          ${orderToPrint.customerAddress ? `<p>${[orderToPrint.customerAddress.street, orderToPrint.customerAddress.city].filter(Boolean).join(', ')}</p>` : ''}
          
          <div class="divider"></div>
          
          <div class="item-row bold" style="margin-bottom: 8px;">
            <div class="item-qty">Qty</div>
            <div class="item-name">Item</div>
            <div class="item-price">Total</div>
          </div>
          
          ${itemsHtml}
          
          <div class="divider"></div>
          
          <div class="flex-between">
            <span>Item Total:</span>
            <span>Rs.${subtotal.toFixed(2)}</span>
          </div>
          <div class="flex-between">
            <span>Taxes:</span>
            <span>Rs.${tax.toFixed(2)}</span>
          </div>
          ${deliveryFee > 0 ? `
          <div class="flex-between">
            <span>Delivery Fee:</span>
            <span>Rs.${deliveryFee.toFixed(2)}</span>
          </div>` : ''}
          ${platformFee > 0 ? `
          <div class="flex-between">
            <span>Platform Fee:</span>
            <span>Rs.${platformFee.toFixed(2)}</span>
          </div>` : ''}
          
          <div class="divider"></div>
          
          <div class="flex-between bold" style="font-size: 14px;">
            <span>GRAND TOTAL:</span>
            <span>Rs.${total.toFixed(2)}</span>
          </div>
          
          <div class="divider"></div>
          
          ${(orderToPrint.note || orderToPrint.restaurantNote) ? `
            <p class="bold">Notes:</p>
            ${orderToPrint.note ? `<p>User: ${orderToPrint.note}</p>` : ''}
            ${orderToPrint.restaurantNote ? `<p>Restaurant: ${orderToPrint.restaurantNote}</p>` : ''}
            <div class="divider"></div>
          ` : ''}
          
          <div class="center" style="margin-top: 15px;">
            <p class="bold">Thank you for ordering!</p>
            <p style="font-size: 10px;">Powered by ${settings.companyName || "Tuggo Food Delivery"}</p>
          </div>
        </body>
        </html>
      `;

      // Create a hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      iframe.contentWindow.document.open();
      iframe.contentWindow.document.write(receiptHtml);
      iframe.contentWindow.document.close();

      // Wait for content to load and then print
      iframe.onload = () => {
        setTimeout(() => {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          // Remove the iframe after printing dialog closes (or short delay)
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 2000);
        }, 200);
      };

    } catch (error) {
      debugError("? Error preparing thermal print:", error);
      toast.error("Failed to prepare thermal receipt.");
    }
  };

  // Handle swipe gestures with smooth animations
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchEndX.current = e.touches[0].clientX;
    isSwiping.current = false;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping.current) {
      const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current);
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current);

      // Determine if this is a horizontal swipe
      if (deltaX > deltaY && deltaX > 10) {
        isSwiping.current = true;
      }
    }

    if (isSwiping.current) {
      touchEndX.current = e.touches[0].clientX;
    }
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current) {
      touchStartX.current = 0;
      touchEndX.current = 0;
      return;
    }

    const swipeDistance = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;
    const swipeVelocity = Math.abs(swipeDistance);

    if (swipeVelocity > minSwipeDistance && !isTransitioning) {
      const currentIndex = filterTabs.findIndex(
        (tab) => tab.id === activeFilter,
      );
      let newIndex = currentIndex;

      if (swipeDistance > 0 && currentIndex < filterTabs.length - 1) {
        // Swipe left - go to next filter (right side)
        newIndex = currentIndex + 1;
      } else if (swipeDistance < 0 && currentIndex > 0) {
        // Swipe right - go to previous filter (left side)
        newIndex = currentIndex - 1;
      }

      if (newIndex !== currentIndex) {
        setIsTransitioning(true);

        // Smooth transition with animation
        setTimeout(() => {
          setActiveFilter(filterTabs[newIndex].id);
          scrollToFilter(newIndex);

          // Reset transition state after animation
          setTimeout(() => {
            setIsTransitioning(false);
          }, 300);
        }, 50);
      }
    }

    // Reset touch positions
    touchStartX.current = 0;
    touchEndX.current = 0;
    touchStartY.current = 0;
    isSwiping.current = false;
  };

  // Scroll filter bar to show active button with smooth animation
  const scrollToFilter = (index) => {
    if (filterBarRef.current) {
      const buttons = filterBarRef.current.querySelectorAll("button");
      if (buttons[index]) {
        const button = buttons[index];
        const container = filterBarRef.current;
        const buttonLeft = button.offsetLeft;
        const buttonWidth = button.offsetWidth;
        const containerWidth = container.offsetWidth;
        const scrollLeft = buttonLeft - containerWidth / 2 + buttonWidth / 2;

        container.scrollTo({
          left: scrollLeft,
          behavior: "smooth",
        });
      }
    }
  };

  // Scroll to active filter on change with smooth animation
  useEffect(() => {
    const index = filterTabs.findIndex((tab) => tab.id === activeFilter);
    if (index >= 0) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        scrollToFilter(index);
      });
    }
  }, [activeFilter]);

  const handleSelectOrder = (order) => {
    setSelectedOrder(order);
    setIsSheetOpen(true);
  };

  const renderContent = () => {
    if (searchQuery.trim() !== "") {
      return (
        <SearchResults
          query={searchQuery}
          results={searchResults}
          isLoading={isSearching}
          onSelectOrder={handleSelectOrder}
        />
      );
    }

    switch (activeFilter) {
      case "new":
        return (
          <NewOrders
            onSelectOrder={handleSelectOrder}
          />
        );
      case "all":
        return (
          <AllOrders
            onSelectOrder={handleSelectOrder}
            onCancel={handleCancelClick}
          />
        );
      case "preparing":
        return (
          <PreparingOrders
            onSelectOrder={handleSelectOrder}
            onCancel={handleCancelClick}
            refreshToken={ordersRefreshToken}
            onStatusChanged={requestOrdersRefresh}
          />
        );
      case "ready":
        return (
          <ReadyOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "out-for-delivery":
        return (
          <OutForDeliveryOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "scheduled":
        return (
          <ScheduledOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "completed":
        return (
          <CompletedOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "cancelled":
        return (
          <CancelledOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "dead":
        return (
          <DeadOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      default:
        return <EmptyState />;
    }
  };

  return (
    <div className="restaurant-page min-h-full bg-gray-100">
      {/* Profile Update Pending Banner */}
      <AnimatePresence>
        {!restaurantStatus.isLoading &&
          restaurantStatus.status === 'pending' &&
          (restaurantStatus.approvedAt || (restaurantStatus.pendingUpdateReason && restaurantStatus.pendingUpdateReason !== 'New Registration')) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="px-4 mt-3"
            >
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
                <div className="bg-amber-100 p-2 rounded-xl flex-shrink-0">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-900">{restaurantStatus.pendingUpdateReason || "Update Pending"}</p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    Your restaurant <strong>{restaurantStatus.pendingUpdateReason || "profile update"}</strong> is pending approval. Please wait for admin response. You are currently continuing operations with your existing details/location.
                  </p>
                </div>
              </div>
            </motion.div>
          )
        }
      </AnimatePresence>

      {/* Top Filter Bar - Sticky below navbar */}
      <div className="sticky top-0 z-40 pb-0 bg-gray-100">
        <div
          ref={filterBarRef}
          className="flex gap-2 overflow-x-auto scrollbar-hide bg-transparent rounded-full px-3 py-1 mt-1"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            WebkitOverflowScrolling: "touch",
          }}>
          <style>{`
            .scrollbar-hide::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          {filterTabs.map((tab, index) => {
            const isActive = activeFilter === tab.id;

            return (
              <motion.button
                key={tab.id}
                onClick={() => {
                  if (!isTransitioning) {
                    setIsTransitioning(true);
                    setActiveFilter(tab.id);
                    scrollToFilter(index);
                    setTimeout(() => setIsTransitioning(false), 300);
                  }
                }}
                className={`shrink-0 px-6 py-3.5 rounded-full font-medium text-sm whitespace-nowrap relative overflow-hidden ${isActive ? "text-white" : "bg-white text-black"
                  }`}
                animate={{
                  scale: isActive ? 1.05 : 1,
                  opacity: isActive ? 1 : 0.7,
                }}
                transition={{
                  duration: 0.3,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
                whileTap={{ scale: 0.95 }}>
                {isActive && (
                  <motion.div
                    layoutId="activeFilterBackground"
                    className="absolute inset-0 bg-primary rounded-full -z-10"
                    initial={false}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 30,
                    }}
                  />
                )}
                <div className="flex items-center gap-2 relative z-10">
                  <span className="flex items-center gap-1.5">
                    {tab.label}
                    {tab.id === 'table-booking' && pendingBookingsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-black animate-bounce">
                        {pendingBookingsCount}
                      </span>
                    )}
                    {tab.id === 'all' && pendingOrdersCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black">
                        {pendingOrdersCount}
                      </span>
                    )}
                  </span>
                  {((tab.id === 'table-booking' && pendingBookingsCount > 0) ||
                    (tab.id === 'all' && pendingOrdersCount > 0)) && (
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                    )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div
        ref={contentRef}
        className="px-4 pb-24 content-scroll"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={(e) => {
          mouseStartX.current = e.clientX;
          mouseEndX.current = e.clientX;
          isMouseDown.current = true;
          isSwiping.current = false;
        }}
        onMouseMove={(e) => {
          if (isMouseDown.current) {
            if (!isSwiping.current) {
              const deltaX = Math.abs(e.clientX - mouseStartX.current);
              if (deltaX > 10) {
                isSwiping.current = true;
              }
            }
            if (isSwiping.current) {
              mouseEndX.current = e.clientX;
            }
          }
        }}
        onMouseUp={() => {
          if (isMouseDown.current && isSwiping.current) {
            const swipeDistance = mouseStartX.current - mouseEndX.current;
            const minSwipeDistance = 50;

            if (
              Math.abs(swipeDistance) > minSwipeDistance &&
              !isTransitioning
            ) {
              const currentIndex = filterTabs.findIndex(
                (tab) => tab.id === activeFilter,
              );
              let newIndex = currentIndex;

              if (swipeDistance > 0 && currentIndex < filterTabs.length - 1) {
                newIndex = currentIndex + 1;
              } else if (swipeDistance < 0 && currentIndex > 0) {
                newIndex = currentIndex - 1;
              }

              if (newIndex !== currentIndex) {
                setIsTransitioning(true);
                setTimeout(() => {
                  setActiveFilter(filterTabs[newIndex].id);
                  scrollToFilter(newIndex);
                  setTimeout(() => setIsTransitioning(false), 300);
                }, 50);
              }
            }
          }

          isMouseDown.current = false;
          isSwiping.current = false;
          mouseStartX.current = 0;
          mouseEndX.current = 0;
        }}
        onMouseLeave={() => {
          isMouseDown.current = false;
          isSwiping.current = false;
        }}>
        <style>{`
          .content-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .content-scroll::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        {/* Verification Pending Card - Show if onboarding is complete (all 4 steps) and restaurant is not active */}
        {!restaurantStatus.isLoading &&
          !restaurantStatus.isActive &&
          restaurantStatus.onboarding?.completedSteps === 4 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className={`mt-4 mb-4 rounded-2xl shadow-sm px-6 py-4 ${restaurantStatus.rejectionReason
                  ? "bg-white border border-red-200"
                  : "bg-white border border-yellow-200"
                }`}>
              {restaurantStatus.rejectionReason ? (
                <>
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 rounded-full p-2 bg-red-100">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-red-600 mb-2">
                        Denied Verification
                      </h3>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                        <p className="text-xs font-semibold text-red-800 mb-2">
                          Reason for Rejection:
                        </p>
                        <div className="text-xs text-red-700 space-y-1">
                          {restaurantStatus.rejectionReason
                            .split("\n")
                            .filter((line) => line.trim()).length > 1 ? (
                            <ul className="space-y-1 list-disc list-inside">
                              {restaurantStatus.rejectionReason
                                .split("\n")
                                .map(
                                  (point, index) =>
                                    point.trim() && (
                                      <li key={index}>{point.trim()}</li>
                                    ),
                                )}
                            </ul>
                          ) : (
                            <p className="text-red-700">
                              {restaurantStatus.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 mb-3">
                    Please correct the above issues and click "Reverify" to
                    resubmit your request for approval.
                  </p>
                  <button
                    onClick={handleReverify}
                    disabled={isReverifying}
                    className="w-full px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {isReverifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      "Reverify"
                    )}
                  </button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    Verification Done in 24 Hours
                  </h3>
                  <p className="text-sm text-gray-600">
                    Your account is under verification. You'll be notified once
                    approved.
                  </p>
                </>
              )}
            </motion.div>
          )}

        {/* Dining Approval Pending Card */}
        {pendingDiningRequest && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 mb-4 rounded-2xl shadow-sm px-6 py-4 bg-white border border-blue-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-full bg-blue-100">
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <h3 className="text-base font-bold text-gray-900">
                Dining Activation Request Pending
              </h3>
            </div>
            <p className="text-sm text-gray-600">
              Your request to {pendingDiningRequest.requestedSettings?.isEnabled ? "enable" : "update"} dining services is being reviewed by our team. You'll be notified via SMS/Dashboard once it's approved.
            </p>
            <div className="mt-3 flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase tracking-widest">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              Under Review
            </div>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={activeFilter}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}>
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Audio element */}
      <audio
        ref={audioRef}
        src={notificationSound}
        preload="auto"
        playsInline
      />

      {/* New Order Popup */}
      <AnimatePresence>
        {showNewOrderPopup && (
          <>
            <motion.div
              className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 pb-[110px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}>
              <motion.div
                className="restaurant-modal-panel max-w-md max-h-[85vh] bg-white rounded-[2rem] shadow-2xl overflow-hidden p-1 flex flex-col"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="px-4 py-2.5 bg-white border-b border-gray-200 flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900">
                        {(popupOrder || newOrder)?.orderId || "#Order"}
                      </h3>
                      {orderQueue.length > 1 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500 text-white animate-pulse">
                          +{orderQueue.length - 1} more
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(popupOrder || newOrder)?.restaurantName || "Restaurant"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePrint}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      aria-label="Print">
                      <Printer className="w-5 h-5 text-gray-700" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="px-4 pt-3 pb-3 flex-1 overflow-y-auto min-h-0">
                  {/* Scheduled Indicator */}
                  {(popupOrder || newOrder)?.scheduledAt && (
                    <div className="mb-3 bg-green-50 border border-green-200 rounded-lg p-2.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-green-600" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-green-800 uppercase tracking-wider">
                          Scheduled Order
                        </p>
                        <p className="text-sm font-semibold text-green-900 mt-0.5">
                          For{" "}
                          {new Date(
                            (popupOrder || newOrder).scheduledAt,
                          ).toLocaleString("en-US", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Customer info */}
                  <div className="mb-2">
                    <h4 className="text-sm font-semibold text-gray-900">
                      {(popupOrder || newOrder)?.items?.[0]?.name ||
                        "New Order"}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {(popupOrder || newOrder)?.createdAt
                        ? new Date(
                          (popupOrder || newOrder).createdAt,
                        ).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                        : "Just now"}
                    </p>
                  </div>

                  {/* Restaurant Note */}
                  {(popupOrder || newOrder)?.restaurantNote && (
                    <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-blue-600" />
                        <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">
                          Note for Restaurant
                        </p>
                      </div>
                      <p className="text-sm font-medium text-blue-900">
                        {(popupOrder || newOrder).restaurantNote}
                      </p>
                    </div>
                  )}

                  {/* Details Accordion */}
                  <div className="mb-2">
                    <button
                      onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                      className="w-full flex items-center justify-between py-1.5 border-b border-gray-200">
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-gray-700"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <span className="text-sm font-semibold text-gray-900">
                          Details
                        </span>
                        <span className="text-xs text-gray-500">
                          {(popupOrder || newOrder)?.items?.length || 0} item
                          {(popupOrder || newOrder)?.items?.length !== 1
                            ? "s"
                            : ""}
                        </span>
                      </div>
                      {isDetailsExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-600" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-600" />
                      )}
                    </button>

                    <AnimatePresence>
                      {isDetailsExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden">
                          <div className="py-3 space-y-3">
                            {(popupOrder || newOrder)?.items?.map(
                              (item, index) => (
                                <div
                                  key={index}
                                  className="flex items-start gap-3">
                                  <div
                                    className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${item.isVeg ? "bg-green-500" : "bg-red-500"}`}></div>
                                  <div className="flex-1">
                                    <div className="flex items-start justify-between">
                                      <p className="text-sm font-medium text-gray-900">
                                        {item.quantity} x {item.name}
                                      </p>
                                      <p className="text-xs text-gray-600 ml-2">
                                        ₹{item.price * item.quantity}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ),
                            ) || (
                                <p className="text-sm text-gray-500">No items</p>
                              )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Cutlery preference */}
                  <div
                    className={`mb-2 flex items-center gap-2 rounded-lg p-2 ${(popupOrder || newOrder)?.sendCutlery === false
                      ? "bg-orange-50"
                      : "bg-gray-50"
                      }`}>
                    <svg
                      className={`h-5 w-5 ${(popupOrder || newOrder)?.sendCutlery === false
                        ? "text-orange-600"
                        : "text-gray-600"
                        }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                    <span
                      className={`text-sm font-medium ${(popupOrder || newOrder)?.sendCutlery === false
                        ? "text-orange-700"
                        : "text-gray-700"
                        }`}>
                      {(popupOrder || newOrder)?.sendCutlery === false
                        ? "Don't send cutlery"
                        : "Send cutlery"}
                    </span>
                  </div>

                  {/* Total bill */}
                  <div className="mb-2 flex items-center justify-between py-1.5 border-y border-gray-200">
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-5 h-5 text-gray-700"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
                        />
                      </svg>
                      <span className="text-sm font-semibold text-gray-900">
                        Total bill
                      </span>
                    </div>
                    <span className="text-base font-bold text-gray-900">
                      ₹{getPopupOrderTotal(popupOrder || newOrder)}
                    </span>
                  </div>

                  {/* Payment method: treat cash/cod (any case) as COD */}
                  {(() => {
                    const raw =
                      (popupOrder || newOrder)?.paymentMethod ||
                      (popupOrder || newOrder)?.payment?.method;
                    const m =
                      raw != null ? String(raw).toLowerCase().trim() : "";
                    const isCod = m === "cash" || m === "cod";
                    return (
                      <div className="mb-2 flex items-center justify-between py-1">
                        <span className="text-sm font-medium text-gray-700">
                          Payment
                        </span>
                        <span
                          className={`text-sm font-semibold ${isCod ? "text-amber-600" : "text-green-600"}`}>
                          {isCod ? "Cash on Delivery" : "Online"}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Preparation time */}
                  <div className="mb-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        Preparation time
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPrepTime(Math.max(1, prepTime - 1))}
                          className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors">
                          <Minus className="w-4 h-4 text-gray-700" />
                        </button>
                        <span className="text-base font-semibold text-gray-900 min-w-[60px] text-center">
                          {prepTime} mins
                        </span>
                        <button
                          onClick={() => setPrepTime(prepTime + 1)}
                          className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors">
                          <Plus className="w-4 h-4 text-gray-700" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-3 pt-2.5 border-t border-gray-200 bg-white">
                  {(() => {
                    const activePopupOrder = popupOrder || newOrder;
                    const popupStatus =
                      activePopupOrder?.orderStatus || activePopupOrder?.status;
                    const userCancelled = isUserCancelledStatus(popupStatus);
                    const anyCancelled = isAnyCancelledStatus(popupStatus);

                    if (anyCancelled) {
                      return (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                          <p className="text-sm font-semibold text-red-700">
                            {userCancelled
                              ? "Order canceled by user"
                              : "Order cancelled"}
                          </p>
                          <p className="mt-1 text-xs text-red-600">
                            This order is no longer available for acceptance.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        <div
                          ref={acceptSliderRef}
                          className="relative h-14 rounded-2xl bg-gray-900 overflow-hidden select-none touch-pan-y md:hidden">
                          <motion.div
                            className="absolute inset-y-0 left-0 bg-blue-600"
                            initial={{ width: "100%" }}
                            animate={{ width: `${(countdown / 180) * 100}%` }}
                            transition={{ duration: 1, ease: "linear" }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center px-16">
                            <span className="relative z-10 text-sm font-semibold text-white text-center">
                              {isAcceptingOrder
                                ? "Accepting order..."
                                : `Slide to accept (${formatTime(countdown)})`}
                            </span>
                          </div>
                          <motion.button
                            type="button"
                            className="absolute left-2 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-white text-gray-900 shadow-md disabled:cursor-not-allowed"
                            style={{
                              x: (() => {
                                const sliderWidth =
                                  acceptSliderRef.current?.offsetWidth || 320;
                                const handleWidth = 40;
                                const maxTravel = Math.max(
                                  sliderWidth - handleWidth - 16,
                                  0,
                                );
                                return acceptSwipeProgress * maxTravel;
                              })(),
                            }}
                            onMouseDown={(e) => handleAcceptSwipeStart(e.clientX)}
                            onTouchStart={(e) =>
                              handleAcceptSwipeStart(e.touches[0].clientX)
                            }
                            onMouseMove={(e) => {
                              if (acceptSwipeActiveRef.current)
                                handleAcceptSwipeMove(e.clientX);
                            }}
                            onTouchMove={(e) =>
                              handleAcceptSwipeMove(e.touches[0].clientX)
                            }
                            onMouseUp={handleAcceptSwipeEnd}
                            onTouchEnd={handleAcceptSwipeEnd}
                            onTouchCancel={handleAcceptSwipeEnd}
                            onClick={triggerSwipeAccept}
                            disabled={isAcceptingOrder}>
                            <span className="text-lg font-bold">›</span>
                          </motion.button>
                        </div>

                        <button
                          onClick={triggerSwipeAccept}
                          disabled={isAcceptingOrder}
                          className="hidden md:block w-full bg-blue-600 text-white py-3.5 rounded-2xl font-bold text-sm hover:bg-blue-700 transition-colors disabled:opacity-60">
                          {isAcceptingOrder ? "Accepting order..." : `Accept Order (${formatTime(countdown)})`}
                        </button>

                        <button
                          onClick={handleRejectClick}
                          disabled={isAcceptingOrder}
                          className="w-full bg-white border-2 border-red-500 text-red-600 py-2.5 rounded-lg font-semibold text-sm hover:bg-red-50 transition-colors disabled:opacity-60">
                          Reject Order
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Reject Order Popup */}
      <AnimatePresence>
        {showRejectPopup && (
          <>
            <motion.div
              className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4 pb-[110px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleRejectCancel}>
              <motion.div
                className="restaurant-modal-panel max-w-md max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="px-4 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-bold text-gray-900">
                    Reject Order {(popupOrder || newOrder)?.orderId || "#Order"}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Please select a reason for rejecting this order
                  </p>
                </div>

                {/* Content */}
                <div className="px-4 py-4 flex-1 overflow-y-auto min-h-0">
                  <div className="space-y-2">
                    {rejectReasons.map((reason) => (
                      <button
                        key={reason}
                        onClick={() => setRejectReason(reason)}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-all ${rejectReason === reason
                            ? "border-primary bg-primary/10"
                            : "border-gray-200 bg-white hover:border-gray-300"
                          }`}>
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-sm font-medium ${rejectReason === reason
                                ? "text-primary"
                                : "text-gray-900"
                              }`}>
                            {reason}
                          </span>
                          {rejectReason === reason && (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
                  <button
                    onClick={handleRejectCancel}
                    className="flex-1 bg-white border-2 border-gray-300 text-gray-700 py-3 rounded-lg font-semibold text-sm hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleRejectConfirm}
                    disabled={!rejectReason}
                    className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-colors ${rejectReason
                        ? "!bg-primary !text-white hover:!bg-primary/90"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                      }`}>
                    Confirm Rejection
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cancel Order Popup */}
      <AnimatePresence>
        {showCancelPopup && orderToCancel && (
          <>
            <motion.div
              className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4 pb-[110px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCancelPopupClose}>
              <motion.div
                className="restaurant-modal-panel max-w-md max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="px-4 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-bold text-gray-900">
                    Cancel Order {orderToCancel.orderId || "#Order"}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Please provide a reason for cancelling this order
                  </p>
                </div>

                {/* Content */}
                <div className="px-4 py-4 flex-1 overflow-y-auto min-h-0">
                  <div className="space-y-3">
                    {rejectReasons.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setCancelReason(reason)}
                        className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${cancelReason === reason
                            ? "border-red-500 bg-red-50"
                            : "border-gray-200 hover:border-gray-300"
                          }`}>
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${cancelReason === reason
                                ? "border-red-500 bg-red-500"
                                : "border-gray-300"
                              }`}>
                            {cancelReason === reason && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </div>
                          <span
                            className={`text-sm font-medium ${cancelReason === reason
                                ? "text-red-700"
                                : "text-gray-700"
                              }`}>
                            {reason}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
                  <button
                    onClick={handleCancelPopupClose}
                    className="flex-1 bg-white border-2 border-gray-300 text-gray-700 py-3 rounded-lg font-semibold text-sm hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleCancelConfirm}
                    disabled={!cancelReason}
                    className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-colors ${cancelReason
                        ? "!bg-red-600 !text-white hover:bg-red-700"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                      }`}>
                    Confirm Cancellation
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>


      {/* Bottom Sheet for Order Details */}
      <AnimatePresence>
        {isSheetOpen && selectedOrder && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSheetOpen(false)}>
            <motion.div
              className="restaurant-modal-panel max-w-md max-h-[85vh] overflow-y-auto bg-white rounded-2xl p-4 shadow-lg"
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}>
              {/* Drag handle */}
              <div className="flex justify-center mb-3">
                <div className="h-1 w-10 rounded-full bg-gray-300" />
              </div>

              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold text-black">
                    Order #{selectedOrder.orderId}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedOrder.customerName}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {selectedOrder.type}
                    {selectedOrder.tableOrToken
                      ? ` • ${selectedOrder.tableOrToken}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border ${selectedOrder.status === "Ready"
                        ? "border-green-500 text-green-600"
                        : "border-gray-800 text-gray-900"
                      }`}>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${selectedOrder.status === "Ready"
                          ? "bg-green-500"
                          : "bg-gray-800"
                        }`}
                    />
                    {selectedOrder.status}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {selectedOrder.timePlaced}
                  </span>
                  {/* Delivery Resend Button - Only for preparing/ready orders with no partner */}
                  {(String(selectedOrder.status).toLowerCase() === "preparing" ||
                    String(selectedOrder.status).toLowerCase() === "ready") &&
                    !selectedOrder.deliveryPartnerId && (
                      <div className="mt-1">
                        <ResendNotificationButton
                          orderId={selectedOrder.orderId}
                          mongoId={selectedOrder.mongoId}
                          onSuccess={() => setIsSheetOpen(false)}
                        />
                      </div>
                    )}
                </div>
              </div>

              <div className="border-t border-gray-100 my-3" />

              <div className="mb-3">
                <p className="text-xs font-medium text-gray-700 mb-1">Items</p>
                <p className="text-xs text-gray-600">
                  {selectedOrder.itemsSummary}
                </p>
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500 mb-4">
                {/* Hide ETA for ready orders */}
                {selectedOrder.status !== "ready" && selectedOrder.eta && (
                  <span>
                    ETA:{" "}
                    <span className="font-medium text-black">
                      {selectedOrder.eta}
                    </span>
                  </span>
                )}
                {(() => {
                  const raw = selectedOrder.paymentMethod;
                  const normalized =
                    raw != null ? String(raw).toLowerCase().trim() : "";
                  const isCod = normalized === "cash" || normalized === "cod";
                  return (
                    <span>
                      Payment:{" "}
                      <span
                        className={`font-medium ${isCod ? "text-amber-700" : "text-black"}`}>
                        {isCod ? "Cash on Delivery" : "Paid online"}
                      </span>
                    </span>
                  );
                })()}
              </div>

              {selectedOrder.status === "cancelled" && selectedOrder.cancellationReason && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-[10px] font-bold text-red-500 uppercase mb-1">Cancellation Reason</p>
                  <p className="text-xs text-red-700 font-medium">{selectedOrder.cancellationReason}</p>
                </div>
              )}

              {selectedOrder.status === "rejected" && selectedOrder.rejectionReason && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Rejection Reason</p>
                  <p className="text-xs text-amber-700 font-medium">{selectedOrder.rejectionReason}</p>
                </div>
              )}

              {selectedOrder.restaurantNote && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Note for Restaurant</p>
                  <p className="text-xs text-blue-700 font-medium">{selectedOrder.restaurantNote}</p>
                </div>
              )}

              {/* Pickup OTP */}
              {selectedOrder.pickupOtp ? (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-0.5">Pickup Verification OTP</p>
                    <p className="text-[9px] text-emerald-600 font-medium leading-tight">Share this code with the delivery partner.</p>
                  </div>
                  <div className="bg-white px-3 py-1 rounded shadow-sm border border-emerald-200">
                    <span className="text-lg font-black text-emerald-800 tracking-[0.2em]">{selectedOrder.pickupOtp}</span>
                  </div>
                </div>
              ) : (selectedOrder.status === "READY" || selectedOrder.status === "PREPARING" || selectedOrder.status === "CONFIRMED") && selectedOrder.deliveryPartnerId && selectedOrder.type === "Home Delivery" ? (
                <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <p className="text-[10px] font-bold text-gray-700 uppercase tracking-wider mb-0.5">Pickup Verification OTP</p>
                  <p className="text-[9px] text-gray-500 font-medium leading-tight">Will be shown when the delivery partner reaches the restaurant.</p>
                </div>
              ) : null}

              <div className="flex gap-3 mt-4">
                <button
                  className="flex-1 bg-white border-2 border-primary text-primary py-2.5 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors"
                  onClick={() => setIsSheetOpen(false)}>
                  Close
                </button>
                <button
                  className="flex-1 bg-primary text-white py-2.5 rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
                  onClick={() => navigate(`/food/restaurant/orders/${selectedOrder.mongoId || selectedOrder.orderId}`)}>
                  View Details & Bill
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation - Sticky */}
    </div>
  );
}


// Order Card Component
function OrderCard({
  orderId,
  mongoId,
  status,
  customerName,
  type,
  tableOrToken,
  timePlaced,
  eta,
  itemsSummary,
  paymentMethod,
  photoUrl,
  photoAlt,
  deliveryPartnerId,
  dispatchStatus,
  onSelect,
  onCancel,
  onMarkReady,
  isMarkingReady = false,
  scheduledAt = null,
  restaurantNote = null,
  pickupOtp = null,
  cancellationReason = null,
  rejectionReason = null,
}) {
  const normalizedStatus = String(status || "").toLowerCase();
  const isReady = normalizedStatus === "ready";
  const isPreparing = normalizedStatus === "preparing";
  const brandColor = "#7e3866";

  let statusLabel = String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // If the restaurant hasn't accepted it yet, show it as Pending instead of Confirmed
  if (normalizedStatus === "confirmed" || normalizedStatus === "created") {
    statusLabel = "Pending";
  }

  return (
    <div className="restaurant-bento-card w-full p-3 mb-3 lg:mb-0 h-full relative overflow-hidden active:bg-slate-50 transition-colors">
      <div
        className="absolute top-0 left-0 w-1 h-full"
        style={{ backgroundColor: brandColor }}
      />

      <div
        onClick={() => onSelect?.({ orderId, mongoId, status, customerName, type, tableOrToken, timePlaced, eta, itemsSummary, paymentMethod, scheduledAt, restaurantNote, pickupOtp, deliveryPartnerId, dispatchStatus, cancellationReason, rejectionReason })}
        className="flex gap-3 items-start cursor-pointer pl-1">

        {/* Photo Container - Smaller for mobile */}
        <div className="h-14 w-14 rounded-lg overflow-hidden bg-slate-50 flex-shrink-0 border border-slate-100 mt-0.5">
          {photoUrl ? (
            <img src={photoUrl} alt={photoAlt} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center p-1 bg-slate-50">
              <span className="text-[8px] font-bold text-slate-300 text-center leading-none uppercase">
                {photoAlt}
              </span>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top Row: ID & Status Badge */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-[13px] font-black text-slate-900 truncate">
              #<span style={{ color: brandColor }}>{orderId}</span>
            </h3>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {scheduledAt && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-100 text-[8px] font-black uppercase">
                  <Calendar className="w-2 h-2" />
                  Scheduled
                </span>
              )}
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-black border uppercase tracking-wider ${isReady ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                  normalizedStatus === "confirmed" ? "bg-amber-50 text-amber-600 border-amber-100" :
                    "bg-slate-50 text-slate-500 border-slate-100"
                }`}>
                {statusLabel}
              </span>

              {/* {isPreparing && onCancel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel({ orderId, mongoId, customerName });
                  }}
                  className="p-1 rounded-full bg-rose-50 text-rose-500"
                >
                  <X className="w-3 h-3" />
                </button>
              )} */}
            </div>
          </div>

          {/* Customer & Type */}
          <div className="flex items-center justify-between text-[9px] text-slate-400 font-bold uppercase tracking-tight mb-1">
            <span className="truncate max-w-[60%]">{customerName}</span>
            <span className="whitespace-nowrap">{type}</span>
          </div>

          {/* Items Summary - One line only */}
          <p className="text-[10px] text-slate-600 font-bold truncate italic mb-1">
            {itemsSummary}
          </p>

          {restaurantNote && (
            <div className="mb-2 px-2 py-1 bg-blue-50 border border-blue-100 rounded-md">
              <p className="text-[9px] text-blue-700 font-bold line-clamp-1 italic">
                Note: {restaurantNote}
              </p>
            </div>
          )}

          {/* Pickup OTP Display on Card */}
          {pickupOtp ? (
            <div className="mb-2 px-2 py-1.5 bg-emerald-50 border border-emerald-100 rounded flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
              <span className="text-[9px] font-bold text-emerald-700 uppercase">Pickup OTP</span>
              <span className="text-[13px] font-black text-emerald-800 tracking-[0.2em]">{pickupOtp}</span>
            </div>
          ) : (isReady || isPreparing || normalizedStatus === "confirmed") && type === "Home Delivery" ? (
            <div className="mb-2 px-2 py-1 bg-gray-50 border border-gray-100 rounded flex justify-center items-center">
              <span className="text-[8px] font-bold text-gray-500 uppercase tracking-wider text-center">OTP shown upon rider arrival</span>
            </div>
          ) : null}

          {/* Bottom Actions Row - Clean Grid/Flex */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-50 mt-auto">
            {scheduledAt ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-[8px] font-bold text-green-600 uppercase">Scheduled For</span>
                <span className="text-[10px] font-black text-green-700">
                  {new Date(scheduledAt).toLocaleString("en-US", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {!isReady && eta && (
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-bold text-slate-400 uppercase">ETA</span>
                    <span className="text-[11px] font-black text-slate-800">{eta}</span>
                  </div>
                )}
                <span className="text-[7px] text-slate-300 font-bold uppercase">{timePlaced}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {(isPreparing || isReady || normalizedStatus === "confirmed") && (
                <>
                  {deliveryPartnerId && (
                    <div className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600" title="Driver Assigned">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}

                  {!deliveryPartnerId && isPreparing && (
                    <div className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 text-[7px] font-black border border-slate-100 uppercase tracking-tighter">
                      No Rider
                    </div>
                  )}

                  {dispatchStatus !== "accepted" && (
                    <ResendNotificationButton
                      orderId={orderId}
                      mongoId={mongoId}
                      onSuccess={onSelect}
                    />
                  )}
                </>
              )}

              {isPreparing && onMarkReady && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkReady({ orderId, mongoId, customerName });
                  }}
                  disabled={isMarkingReady}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-black text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50"
                  style={{ backgroundColor: brandColor }}>
                  {isMarkingReady ? "..." : "MARK READY"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Preparing Orders List
function PreparingOrders({
  onSelectOrder,
  onCancel,
  refreshToken = 0,
  onStatusChanged,
}) {
  const pollMs =
    typeof window !== "undefined" && window.restaurantSocketConnected
      ? 45000
      : 20000;
  const { orders: rawOrders, meta, page, loading, setPage, refetch } =
    usePaginatedRestaurantOrders({
      status: RESTAURANT_ORDER_TAB_STATUS.preparing,
      refreshToken,
      enablePoll: true,
      pollMs,
    });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [markingReadyOrderIds, setMarkingReadyOrderIds] = useState({});
  const [hiddenOrderIds, setHiddenOrderIds] = useState(() => new Set());

  useEffect(() => {
    const countdownIntervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(countdownIntervalId);
  }, []);

  const orders = rawOrders
    .map((order) => {
      const initialETA = order.estimatedDeliveryTime || 30;
      const preparingTimestamp = order.tracking?.preparing?.timestamp
        ? new Date(order.tracking.preparing.timestamp)
        : new Date(order.createdAt);

      return {
        orderId: order.orderId || order._id,
        mongoId: order._id,
        status: order.status || "preparing",
        customerName: order.userId?.name || "Customer",
        type:
          order.deliveryFleet === "standard"
            ? "Home Delivery"
            : "Express Delivery",
        tableOrToken: null,
        timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        initialETA,
        preparingTimestamp,
        itemsSummary:
          order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") ||
          "No items",
        photoUrl: order.items?.[0]?.image || null,
        photoAlt: order.items?.[0]?.name || "Order",
        deliveryPartnerId: order.deliveryPartnerId || null,
        dispatchStatus: order.dispatch?.status || null,
        paymentMethod: order.paymentMethod || order.payment?.method || null,
        scheduledAt: order.scheduledAt || null,
        restaurantNote: order.restaurantNote || null,
        pickupOtp: order.pickupOtp || null,
      };
    })
    .filter((order) => !hiddenOrderIds.has(order.mongoId || order.orderId));

  // Track which orders have been marked as ready to avoid duplicate API calls
  const markedReadyOrdersRef = useRef(new Set());

  // Auto-mark orders as ready when ETA reaches 0
  useEffect(() => {
    if (!currentTime || orders.length === 0) return;

    const checkAndMarkReady = async () => {
      for (const order of orders) {
        const orderKey = order.mongoId || order.orderId;

        // Skip if already marked as ready
        if (markedReadyOrdersRef.current.has(orderKey)) {
          continue;
        }

        // Calculate remaining ETA
        const elapsedMs = currentTime - order.preparingTimestamp;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);
        const remainingMinutes = Math.max(0, order.initialETA - elapsedMinutes);

        // If ETA has reached 0 (or slightly past), mark as ready
        if (remainingMinutes <= 0 && order.status === "preparing") {
          const elapsedSeconds = Math.floor(elapsedMs / 1000);
          const totalETASeconds = order.initialETA * 60;

          // Mark as ready when ETA time has elapsed (with 2 second buffer)
          if (elapsedSeconds >= totalETASeconds - 2) {
            try {
              debugLog(
                `?? Auto-marking order ${order.orderId} as ready (ETA reached 0)`,
              );
              markedReadyOrdersRef.current.add(orderKey); // Mark as processing
              await restaurantAPI.markOrderReady(
                order.mongoId || order.orderId,
              );
              debugLog(`? Order ${order.orderId} marked as ready`);
              onStatusChanged?.();
              refetch();
            } catch (error) {
              const status = error.response?.status;
              const msg = (
                error.response?.data?.message ||
                error.message ||
                ""
              ).toLowerCase();
              // If 400 and message says order cannot be marked ready (e.g. already ready),
              // treat as idempotent - backend cron or another client already marked it.
              if (
                status === 400 &&
                (msg.includes("cannot be marked as ready") ||
                  msg.includes("current status"))
              ) {
                // Keep in markedReadyOrdersRef so we don't retry; order will disappear on next fetch
              } else {
                debugError(
                  `? Failed to auto-mark order ${order.orderId} as ready:`,
                  error,
                );
                markedReadyOrdersRef.current.delete(orderKey);
              }
              // Don't show error toast - it will retry on next check (for non-idempotent errors)
            }
          }
        }
      }
    };

    // Check every 2 seconds for orders that need to be marked ready
    const readyCheckInterval = setInterval(checkAndMarkReady, 2000);

    return () => {
      clearInterval(readyCheckInterval);
    };
  }, [currentTime, orders]);

  // Clear marked orders when orders list changes (orders moved to ready)
  useEffect(() => {
    const currentOrderKeys = new Set(orders.map((o) => o.mongoId || o.orderId));
    // Remove keys that are no longer in the preparing orders list
    for (const key of markedReadyOrdersRef.current) {
      if (!currentOrderKeys.has(key)) {
        markedReadyOrdersRef.current.delete(key);
      }
    }
  }, [orders]);

  const handleMarkReady = async ({ orderId, mongoId, customerName }) => {
    const orderKey = mongoId || orderId;
    if (!orderKey || markingReadyOrderIds[orderKey]) return;

    try {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: true }));
      await restaurantAPI.markOrderReady(orderKey);
      setHiddenOrderIds((prev) => new Set(prev).add(orderKey));
      toast.success(
        `Order ${orderId} marked ready${customerName ? ` for ${customerName}` : ""}`,
      );
      onStatusChanged?.();
      refetch();
    } catch (error) {
      const status = error.response?.status;
      const message =
        error.response?.data?.message || "Failed to mark order as ready";
      if (
        status === 400 &&
        String(message).toLowerCase().includes("current status")
      ) {
        setHiddenOrderIds((prev) => new Set(prev).add(orderKey));
        toast.success(`Order ${orderId} is already ready`);
        onStatusChanged?.();
        refetch();
      } else {
        toast.error(message);
      }
    } finally {
      setMarkingReadyOrderIds((prev) => {
        const next = { ...prev };
        delete next[orderKey];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Preparing orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Preparing orders</h2>
        <span className="text-xs text-gray-500">{meta.total} active</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders in preparation
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => {
            // Calculate remaining ETA (countdown)
            const elapsedMs = currentTime - order.preparingTimestamp;
            const elapsedMinutes = Math.floor(elapsedMs / 60000);
            const remainingMinutes = Math.max(
              0,
              order.initialETA - elapsedMinutes,
            );

            // Format ETA display
            let etaDisplay = "";
            if (remainingMinutes <= 0) {
              const remainingSeconds = Math.max(
                0,
                Math.floor(order.initialETA * 60 - elapsedMs / 1000),
              );
              if (remainingSeconds > 0) {
                etaDisplay = `${remainingSeconds} secs`;
              } else {
                etaDisplay = "0 mins";
              }
            } else {
              etaDisplay = `${remainingMinutes} mins`;
            }

            return (
              <OrderCard
                key={order.orderId || order.mongoId}
                orderId={order.orderId}
                mongoId={order.mongoId}
                status={order.status}
                customerName={order.customerName}
                type={order.type}
                tableOrToken={order.tableOrToken}
                timePlaced={order.timePlaced}
                eta={etaDisplay}
                itemsSummary={order.itemsSummary}
                photoUrl={order.photoUrl}
                photoAlt={order.photoAlt}
                paymentMethod={order.paymentMethod}
                deliveryPartnerId={order.deliveryPartnerId}
                dispatchStatus={order.dispatchStatus}
                onSelect={onSelectOrder}
                onCancel={onCancel}
                onMarkReady={handleMarkReady}
                isMarkingReady={Boolean(
                  markingReadyOrderIds[order.mongoId || order.orderId],
                )}
              />
            );
          })}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

// Ready Orders List
function ReadyOrders({ onSelectOrder, refreshToken = 0 }) {
  const pollMs =
    typeof window !== "undefined" && window.restaurantSocketConnected
      ? 45000
      : 20000;
  const { orders: rawOrders, meta, page, loading, setPage } =
    usePaginatedRestaurantOrders({
      status: RESTAURANT_ORDER_TAB_STATUS.ready,
      refreshToken,
      enablePoll: true,
      pollMs,
    });

  const orders = rawOrders.map((order) => ({
    orderId: order.orderId || order._id,
    mongoId: order._id,
    status: order.status || "ready",
    customerName: order.userId?.name || "Customer",
    type:
      order.deliveryFleet === "standard"
        ? "Home Delivery"
        : "Express Delivery",
    tableOrToken: null,
    timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    eta: null,
    itemsSummary:
      order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") ||
      "No items",
    photoUrl: order.items?.[0]?.image || null,
    photoAlt: order.items?.[0]?.name || "Order",
    paymentMethod: order.paymentMethod || order.payment?.method || null,
    deliveryPartnerId: order.deliveryPartnerId || null,
    dispatchStatus: order.dispatch?.status || null,
    scheduledAt: order.scheduledAt || null,
    restaurantNote: order.restaurantNote || null,
    pickupOtp: order.pickupOtp || null,
  }));

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Ready for pickup
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Ready for pickup</h2>
        <span className="text-xs text-gray-500">{meta.total} active</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders ready for pickup
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

// Out for Delivery Orders List
const OutForDeliveryOrders = ({ onSelectOrder, refreshToken = 0 }) => {
  const { orders: rawOrders, meta, page, loading, setPage } =
    usePaginatedRestaurantOrders({
      status: RESTAURANT_ORDER_TAB_STATUS["out-for-delivery"],
      refreshToken,
    });

  const orders = rawOrders.map((order) => ({
    orderId: order.orderId || order._id,
    mongoId: order._id,
    status: order.status || "out_for_delivery",
    customerName: order.userId?.name || "Customer",
    type:
      order.deliveryFleet === "standard"
        ? "Home Delivery"
        : "Express Delivery",
    tableOrToken: null,
    timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    eta: null,
    itemsSummary:
      order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") ||
      "No items",
    photoUrl: order.items?.[0]?.image || null,
    photoAlt: order.items?.[0]?.name || "Order",
    paymentMethod: order.paymentMethod || order.payment?.method || null,
    deliveryPartnerId: order.deliveryPartnerId || null,
    dispatchStatus: order.dispatch?.status || null,
    scheduledAt: order.scheduledAt || null,
    restaurantNote: order.restaurantNote || null,
  }));

  if (loading) {
    return (
      <div className="pt-1 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Out for delivery
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Out for delivery</h2>
        <span className="text-xs text-gray-500">{meta.total} active</span>
      </div>
      {orders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No orders out for delivery
        </div>
      ) : (
        <RestaurantBentoGrid variant="orders">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </RestaurantBentoGrid>
      )}
      <RestaurantOrdersPagination
        page={page}
        totalPages={meta.totalPages}
        total={meta.total}
        limit={meta.limit || RESTAURANT_ORDERS_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
};

// Empty State Component
function EmptyState({ message = "Temporarily closed" }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-12">
      {/* Store Illustration */}
      <div className="mb-6">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          className="text-gray-300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg">
          {/* Storefront */}
          <rect
            x="40"
            y="80"
            width="120"
            height="80"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Awning */}
          <path
            d="M30 80 L100 50 L170 80"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Doors */}
          <rect
            x="60"
            y="100"
            width="30"
            height="60"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          <rect
            x="110"
            y="100"
            width="30"
            height="60"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Laptop */}
          <rect
            x="70"
            y="140"
            width="40"
            height="25"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="white"
          />
          <text
            x="85"
            y="155"
            fontSize="8"
            fill="currentColor"
            textAnchor="middle">
            CLOSED
          </text>
          {/* Sign */}
          <rect
            x="80"
            y="170"
            width="40"
            height="20"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="white"
          />
        </svg>
      </div>

      {/* Message */}
      <h2 className="text-lg font-semibold text-gray-600 mb-4 text-center">
        {message}
      </h2>

      {/* View Status Button */}
      <button
        onClick={() => {
          // If message is related to rejection/offline, go to status page, otherwise refresh orders
          if (message?.toLowerCase().includes("rejected") || message?.toLowerCase().includes("closed")) {
            window.location.href = "/food/restaurant/status";
          } else {
            window.location.reload();
          }
        }}
        className="bg-black text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors">
        View status
      </button>
    </div>
  );
}

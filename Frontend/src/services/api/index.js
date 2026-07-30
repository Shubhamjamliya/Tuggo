/**
 * API layer - auth connected to new backend; rest stubbed for UI compatibility.
 */

import axios from "axios";
import apiClient, { userClient, restaurantClient, deliveryClient, adminClient } from "./axios.js";
import { API_ENDPOINTS } from "./config.js";
import { getUploadApiBaseUrl, getUploadAuthHeaders, joinApiUrl } from "./uploadTarget.js";
import { getUploadErrorMessage } from '../../shared/utils/uploadErrors.js';
import * as authService from "./auth.js";
import { getModuleFcmToken, getModuleRefreshToken } from "@food/utils/auth";

const stub = () =>
  Promise.resolve({
    data: { success: false, message: "Backend not connected", data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

/** Search API - unified search for user app */
export const searchAPI = {
  unifiedSearch: (params = {}) =>
    userClient.get("/food/search/unified", { params }),
  getAdminCategories: (params = {}) =>
    adminClient.get("/food/search/categories/admin", { params }),
};

const createStubAPI = () =>
  new Proxy(
    {},
    {
      get(_, prop) {
        return () => stub();
      },
    },
  );

export default apiClient;
export { API_ENDPOINTS };

// Stub for non-auth endpoints so we don't hit backend for unimplemented routes (avoids 404s and extra calls).
// Auth is done via authAPI/authService which use apiClient directly.
const emptyDataStub = () =>
  Promise.resolve({
    data: { success: false, data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

export const api = {
  get: (_url, _config) => emptyDataStub(),
  post: (_url, _data, _config) => emptyDataStub(),
  put: (_url, _data, _config) => emptyDataStub(),
  patch: (_url, _data, _config) => emptyDataStub(),
  delete: (_url, _config) => emptyDataStub(),
};

/** Single in-flight + short cache for user /auth/me - avoids duplicate calls. */
let userMeInFlight = null;
let userMeCached = null;
let userMeCacheTime = 0;
const USER_ME_CACHE_MS = 3000;

const getUserMeOnce = () => {
  const now = Date.now();
  if (userMeCached && now - userMeCacheTime < USER_ME_CACHE_MS) {
    return Promise.resolve(userMeCached);
  }
  if (!userMeInFlight) {
    userMeInFlight = authService
      .getMe("user")
      .then((res) => {
        userMeCached = res;
        userMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        userMeInFlight = null;
      });
  }
  return userMeInFlight;
};

/** Dedupe FCM token POST — skip if same token was saved recently (avoids spam on route changes). */
function createSaveFcmTokenOnce(client) {
  const savedAt = new Map();
  const inFlight = new Map();
  const TTL_MS = 24 * 60 * 60 * 1000;

  return (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const normalizedToken = String(token);
    const normalizedPlatform = platform === "mobile" ? "mobile" : "web";
    const key = `${normalizedPlatform}:${normalizedToken}`;

    const last = savedAt.get(key);
    if (last && Date.now() - last < TTL_MS) {
      return Promise.resolve({
        data: { success: true, message: "FCM token already saved", deduped: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });
    }

    if (inFlight.has(key)) return inFlight.get(key);

    const path =
      normalizedPlatform === "mobile"
        ? "/fcm-tokens/mobile/save"
        : "/fcm-tokens/save";

    const promise = client
      .post(path, { token: normalizedToken, platform: normalizedPlatform })
      .then((res) => {
        savedAt.set(key, Date.now());
        return res;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  };
}

const saveUserFcmTokenOnce = createSaveFcmTokenOnce(userClient);
const saveRestaurantFcmTokenOnce = createSaveFcmTokenOnce(restaurantClient);
const saveDeliveryFcmTokenOnce = createSaveFcmTokenOnce(deliveryClient);

function createSavePushDevice(client) {
  return (payload = {}) => client.post("/fcm-tokens/device/save", payload ?? {});
}

function createRemovePushDevice(client) {
  return (payload = {}) => client.delete("/fcm-tokens/device/remove", {
    data: payload ?? {},
    params: payload ?? {},
  });
}

const saveUserPushDevice = createSavePushDevice(userClient);
const saveRestaurantPushDevice = createSavePushDevice(restaurantClient);
const saveDeliveryPushDevice = createSavePushDevice(deliveryClient);
const removeUserPushDevice = createRemovePushDevice(userClient);
const removeRestaurantPushDevice = createRemovePushDevice(restaurantClient);
const removeDeliveryPushDevice = createRemovePushDevice(deliveryClient);

/** Auth API - user OTP + admin login via new backend */
export const authAPI = {
  sendOTP: (phone, _purpose = "login", _email = null) => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestUserOtp(phone);
  },
  verifyOTP: (
    phone,
    otp,
    _purpose,
    _name,
    _email,
    _role,
    _password,
    _referralCode,
    fcmToken = null,
    platform = "web",
  ) => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyUserOtp(
      phone,
      otp,
      _referralCode,
      _name,
      fcmToken,
      platform,
    );
  },
  getCurrentUser: () => getUserMeOnce(),
  refreshToken: (token) => authService.refreshToken(token),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    const token =
      refreshToken || getModuleRefreshToken("user");
    const resolvedFcmToken = fcmToken || getModuleFcmToken("user");
    return authService.logout(token, resolvedFcmToken, platform);
  },
};

export const supportAPI = {
  createTicket: (body) =>
    userClient.post("/food/user/support/ticket", body ?? {}),
  getMyTickets: (params = {}) =>
    userClient.get("/food/user/support/my-tickets", { params }),
  getSupportTicketsAdmin: (params = {}) =>
    adminClient.get("/food/admin/support-tickets", { params }),
  updateSupportTicketAdmin: (id, body = {}) =>
    adminClient.patch(`/food/admin/support-tickets/${String(id)}`, body ?? {}),
};

export const notificationAPI = {
  getInbox: (params = {}, config = {}) =>
    apiClient.get("/food/notifications/inbox", {
      params,
      ...config,
    }),
  markAsRead: (id, config = {}) =>
    apiClient.patch(`/food/notifications/${String(id)}/read`, {}, config),
  dismiss: (id, config = {}) =>
    apiClient.delete(`/food/notifications/${String(id)}`, config),
  dismissAll: (config = {}) =>
    apiClient.delete("/food/notifications/inbox/all", config),
  sendTestNotification: (platform = "web", channel = "fcm", config = {}) =>
    apiClient.post("/fcm-tokens/test", { platform, channel }, config),
};

/** Admin API - new backend only (GET /auth/me, PATCH /auth/admin/profile, POST /auth/admin/change-password) */
export const adminAPI = {
  // Sub Admins
  getSubAdmins: (params = {}) => adminClient.get("/food/admin/sub-admins", { params }),
  createSubAdmin: (body) => adminClient.post("/food/admin/sub-admins", body),
  updateSubAdmin: (id, body) => adminClient.put(`/food/admin/sub-admins/${id}`, body),
  deleteSubAdmin: (id) => adminClient.delete(`/food/admin/sub-admins/${id}`),

  getSidebarBadges: () =>
    adminClient.get("/food/admin/sidebar-badges"),
  getEnvSettings: () => adminClient.get("/food/admin/env"),
  updateEnvSettings: (data) => adminClient.put("/food/admin/env", data),
  getBusinessSettings: () => adminClient.get("/food/admin/business-settings"),
  updateBusinessSettings: (data) => {
    // If data is a FormData object (e.g. has files), pass it directly, else pass as JSON
    const config = data instanceof FormData ? { headers: { "Content-Type": "multipart/form-data" } } : {};
    return adminClient.put("/food/admin/business-settings", data, config);
  },
  login: (email, password) => authService.adminLogin(email, password),
  /** POST /auth/admin/forgot-password/request-otp â€“ only accepts registered admin email */
  requestForgotPasswordOtp: (email) =>
    adminClient.post("/auth/admin/forgot-password/request-otp", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
    }),
  /** POST /auth/admin/forgot-password/reset â€“ verify OTP and set new password in one call */
  resetPasswordWithOtp: (email, otp, newPassword) =>
    adminClient.post("/auth/admin/forgot-password/reset", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
      otp: String(otp || "").replace(/\D/g, ""),
      newPassword: String(newPassword || ""),
    }),
  /** Raw /auth/me for admin (e.g. navbar). For Profile & Settings use getAdminProfile. */
  getCurrentAdmin: () => authService.getMe("admin"),
  /** Single API for admin profile: GET /auth/me, returns { data: { admin } }. Use on Profile & Settings only. */
  getAdminProfile: () =>
    authService.getMe("admin").then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { data: { data: { admin: user }, admin: user } };
    }),
  /** PATCH /auth/admin/profile. Body: name?, phone?, profileImage? */
  updateAdminProfile: (body) =>
    adminClient.patch("/auth/admin/profile", body ?? {}),
  /** POST /auth/admin/change-password */
  changePassword: (currentPassword, newPassword) =>
    adminClient.post(
      "/auth/admin/change-password",
      { currentPassword, newPassword }
    ),
  /** Public API for fee settings */
  getPublicFeeSettings: () =>
    apiClient.get("/food/admin/fee-settings/public"),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    const token =
      refreshToken || getModuleRefreshToken("admin");
    const resolvedFcmToken = fcmToken || getModuleFcmToken("admin");
    return authService.logout(token, resolvedFcmToken, platform);
  },
  // Restaurant approvals and join requests
  getPendingRestaurants: () =>
    adminClient.get("/food/admin/restaurants/pending"),
  /** List restaurant complaints (admin). */
  getRestaurantComplaints: (params = {}) =>
    adminClient.get("/food/admin/restaurants/complaints", { params }),
  getRestaurantMenuPdfUrl: (id) =>
    adminClient.get(`/food/admin/restaurants/${String(id)}/menu-pdf`),
  downloadRestaurantMenuPdf: (id) =>
    adminClient.get(`/food/admin/restaurants/${String(id)}/download-menu-pdf`, {
      responseType: "blob",
    }),
  updateRestaurantComplaint: (id, body) =>
    adminClient.patch(`/food/admin/restaurants/complaints/${id}`, body),
  /** Global universal search (admin). */
  globalSearch: (query) =>
    adminClient.get("/food/admin/global-search", { params: { query } }),
  approveRestaurant: (id) =>
    adminClient.patch(`/food/admin/restaurants/${id}/approve`, {}),
  rejectRestaurant: (id, reason) =>
    adminClient.patch(`/food/admin/restaurants/${id}/reject`, { reason }),
  /** Delivery partner join requests - uses /food/admin/delivery/* (new backend API) */
  getDeliveryPartnerJoinRequests: (params) =>
    adminClient.get("/food/admin/delivery/join-requests", { params }),
  /** List approved delivery partners (Deliveryman List page) */
  getDeliveryPartners: (params) =>
    adminClient.get("/food/admin/delivery/partners", { params }),
  getDeliverymanReviews: (params = {}) =>
    adminClient.get("/food/admin/delivery/reviews", { params }),
  getContactMessages: (params = {}) =>
    adminClient.get("/food/admin/contact-messages", { params }),
  /** Dashboard summary stats (admin home) */
  getDashboardStats: (params = {}) =>
    adminClient.get("/food/admin/dashboard-stats", { params }),
  /** Live monitor: restaurants + delivery partners with locations */
  getLiveMonitorStatus: () =>
    adminClient.get("/food/admin/live-monitor/status"),
  /** List restaurant withdrawal requests (admin). */
  getWithdrawals: (params = {}) =>
    adminClient.get("/food/admin/withdrawals", { params }),
  /** Update status of a withdrawal request. */
  updateWithdrawalStatus: (id, body) =>
    adminClient.patch(`/food/admin/withdrawals/${id}`, body),
  /** List delivery withdrawal requests (admin). */
  getDeliveryWithdrawals: (params = {}) =>
    adminClient.get("/food/admin/delivery/withdrawals", { params }),
  /** Update status of a delivery withdrawal request. */
  updateDeliveryWithdrawalStatus: (id, body) =>
    adminClient.patch(`/food/admin/delivery/withdrawals/${id}`, body),
  /** Delivery withdrawal aliases */
  getDeliveryWithdrawalRequests: (params) => adminAPI.getDeliveryWithdrawals(params),
  approveDeliveryWithdrawal: (id) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "approved" }),
  rejectDeliveryWithdrawal: (id, reason) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  // Aliases for RestaurantWithdraws page
  getWithdrawalRequests: (params) => adminAPI.getWithdrawals(params),
  approveWithdrawalRequest: (id) => adminAPI.updateWithdrawalStatus(id, { status: "approved" }),
  rejectWithdrawalRequest: (id, reason) => adminAPI.updateWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  /** Delivery boy wallets (stub until backend implements - returns empty so list still loads) */
  getDeliveryBoyWallets: (params) =>
    adminClient.get("/food/admin/delivery/wallets", { params }),
  getDeliveryPartnerById: (id) =>
    adminClient.get(`/food/admin/delivery/${id}`),
  approveDeliveryPartner: (id) =>
    adminClient.patch(`/food/admin/delivery/${String(id)}/approve`, {}),
  rejectDeliveryPartner: (id, reason) =>
    adminClient.patch(`/food/admin/delivery/${String(id)}/reject`, { reason: String(reason || "").trim() }),
  deleteDeliveryPartner: (id) =>
    adminClient.delete(`/food/admin/delivery/${String(id)}`),
  getAvailableDeliveryPartners: (params) =>
    adminClient.get("/food/admin/delivery/available-partners", { params }),
  assignDeliveryPartner: (orderId, partnerId) =>
    adminClient.post(`/food/admin/orders/${String(orderId)}/assign-delivery`, { deliveryPartnerId: partnerId }),
  /** GET /food/admin/delivery/support-tickets - list all delivery support tickets (query: status, priority, search, page, limit). */
  getDeliverySupportTickets: (params) =>
    adminClient.get("/food/admin/delivery/support-tickets", { params }),
  getExpiredFssaiNotifications: (params = {}) =>
    adminClient.get("/food/admin/notifications/fssai-expired", {
      params,
    }),
  /** GET /food/admin/delivery/support-tickets/stats - counts by status. */
  getDeliverySupportTicketStats: () =>
    adminClient.get("/food/admin/delivery/support-tickets/stats"),
  /** PATCH /food/admin/delivery/support-tickets/:id - update adminResponse, status. */
  updateDeliverySupportTicket: (id, body) =>
    adminClient.patch(`/food/admin/delivery/support-tickets/${id}`, body ?? {}),
  createBroadcastNotification: (body = {}) =>
    adminClient.post("/food/admin/notifications/broadcast", body ?? {}),
  getBroadcastNotifications: (params = {}) =>
    adminClient.get("/food/admin/notifications/broadcast", { params }),
  deleteBroadcastNotification: (id) =>
    adminClient.delete(`/food/admin/notifications/broadcast/${String(id)}`),
  /** List restaurants for admin. Requires admin auth. */
  getRestaurants: (params = {}, config = {}) =>
    adminClient.get("/food/admin/restaurants", {
      params: { limit: 1000, ...params },
      ...config,
    }),
  getRestaurantReviews: (params = {}) =>
    adminClient.get("/food/admin/restaurants/reviews", {
      params: { page: 1, limit: 1000, ...params }
    }),
  /** Categories (admin) */
  getCategories: (params = {}) =>
    adminClient.get("/food/admin/categories", { params }),
  /** Dining categories (admin) */
  getDiningCategories: (params = {}) =>
    adminClient.get("/food/admin/dining/categories", { params }),
  createDiningCategory: (body) =>
    adminClient.post("/food/admin/dining/categories", body ?? {}),
  updateDiningCategory: (id, body) =>
    adminClient.patch(`/food/admin/dining/categories/${String(id)}`, body ?? {}),
  deleteDiningCategory: (id) =>
    adminClient.delete(`/food/admin/dining/categories/${String(id)}`),
  getDiningRestaurants: (params = {}) =>
    adminClient.get("/food/admin/dining/restaurants", { params }),
  updateRestaurantDiningSettings: (restaurantId, body) =>
    adminClient.patch(`/food/admin/dining/restaurants/${String(restaurantId)}`, body ?? {}),
  getDiningRequests: (params = {}) =>
    adminClient.get("/food/admin/dining/requests", { params }),
  approveDiningRequest: (id) =>
    adminClient.patch(`/food/admin/dining/requests/${String(id)}/approve`, {}),
  rejectDiningRequest: (id, reason) =>
    adminClient.patch(`/food/admin/dining/requests/${String(id)}/reject`, { reason }),
  createCategory: (body) =>
    adminClient.post("/food/admin/categories", body ?? {}),
  updateCategory: (id, body) =>
    adminClient.patch(`/food/admin/categories/${id}`, body ?? {}),
  deleteCategory: (id) =>
    adminClient.delete(`/food/admin/categories/${id}`),
  approveCategory: (id) =>
    adminClient.patch(`/food/admin/categories/${String(id)}/approve`, {}),
  rejectCategory: (id, reason) =>
    adminClient.patch(`/food/admin/categories/${String(id)}/reject`, { reason: String(reason || "").trim() }),
  makeCategoryGlobal: (id) =>
    adminClient.patch(`/food/admin/categories/${String(id)}/make-global`, {}),
  toggleCategoryStatus: (id) =>
    adminClient.patch(`/food/admin/categories/${id}/toggle`, {}),
  /** Get single restaurant by id (full details for View Details modal). */
  getRestaurantById: (id) =>
    adminClient.get(`/food/admin/restaurants/${id}`),
  /** Get restaurant analytics for POS. */
  getRestaurantAnalytics: (id) =>
    adminClient.get(`/food/admin/restaurants/${id}/analytics`),
  /** Update restaurant basic details (admin). */
  updateRestaurant: (id, body) =>
    adminClient.patch(`/food/admin/restaurants/${String(id)}`, body ?? {}),
  deleteRestaurant: (id) =>
    adminClient.delete(`/food/admin/restaurants/${id}`),
  /** Update restaurant status (admin). Body: { status: boolean } */
  updateRestaurantStatus: (id, status) =>
    adminClient.patch(`/food/admin/restaurants/${String(id)}/status`, { status: status !== false }),
  /** Update restaurant location (admin). Body includes lat/lng + address fields. */
  updateRestaurantLocation: (id, body) =>
    adminClient.patch(`/food/admin/restaurants/${String(id)}/location`, body ?? {}),
  updateRestaurantOutletTimings: (id, outletTimings) =>
    adminClient.patch(`/food/admin/restaurants/${String(id)}/outlet-timings`, { outletTimings }),
  /** Update restaurant zone rank (admin) */
  updateRestaurantZoneRank: (id, rank) =>
    adminClient.patch(`/food/admin/restaurants/${String(id)}/zone-rank`, { rank }),
  /** Restaurant menu (admin) */
  getRestaurantMenuById: (id, config = {}) =>
    adminClient.get(`/food/admin/restaurants/${id}/menu`, config),
  updateRestaurantMenuById: (id, body) =>
    adminClient.patch(`/food/admin/restaurants/${id}/menu`, body ?? {}),
  uploadMenuBulk: (restaurantId, file) => {
    const formData = new FormData();
    formData.append("restaurantId", restaurantId);
    formData.append("file", file);
    return adminClient.post("/food/admin/menu/bulk-upload", formData);
  },
  getMenuItemsStatus: (restaurantId) =>
    adminClient.get(`/food/admin/menu/items-status/${restaurantId}`),
  regenerateMenuItemImage: (restaurantId, sectionIndex, itemIndex, itemId) =>
    adminClient.post("/food/admin/menu/regenerate-image", { restaurantId, sectionIndex, itemIndex, itemId }),
  /** Foods (admin) - separate collection */
  getFoods: (params = {}) =>
    adminClient.get("/food/admin/foods", { params }),
  createFood: (body) =>
    adminClient.post("/food/admin/foods", body ?? {}),
  updateFood: (id, body) =>
    adminClient.patch(`/food/admin/foods/${id}`, body ?? {}),
  deleteFood: (id) =>
    adminClient.delete(`/food/admin/foods/${id}`),
  /** Food approvals (admin) - pending items created by restaurants */
  getPendingFoodApprovals: (params = {}) =>
    adminClient.get("/food/admin/foods/pending-approvals", { params }),
  approveFoodItem: (id) =>
    adminClient.patch(`/food/admin/foods/${String(id)}/approve`, {}),
  rejectFoodItem: (id, reason) =>
    adminClient.patch(`/food/admin/foods/${String(id)}/reject`, { reason: String(reason || "").trim() }),
  /** Bulk approve multiple food items */
  bulkApproveFood: (ids) =>
    adminClient.patch("/food/admin/foods/bulk-approve", { ids }),
  /** Customers (admin) */
  getCustomers: (params = {}) =>
    adminClient.get("/food/admin/customers", { params }),
  getCustomerById: (id) =>
    adminClient.get(`/food/admin/customers/${String(id)}`),
  updateCustomerStatus: (id, isActive) =>
    adminClient.patch(`/food/admin/customers/${String(id)}/status`, { isActive: isActive !== false }),
  topupCustomerWallet: (id, amount, description) =>
    adminClient.post(`/food/admin/customers/${String(id)}/wallet-topup`, { amount: Number(amount), description }),
  /** Orders (admin) â€“ list, get by id, assign delivery partner */
  getOrders: (params = {}) =>
    adminClient.get("/food/admin/orders", { params: { limit: 50, page: 1, ...params } }),
  getOrderById: (orderId) =>
    adminClient.get(`/food/admin/orders/${String(orderId)}`),
  acceptOrder: (orderId) =>
    adminClient.patch(`/food/admin/orders/${String(orderId)}/status`, { orderStatus: "confirmed", note: "Accepted by admin" }),
  rejectOrder: (orderId, reason = "") =>
    adminClient.patch(`/food/admin/orders/${String(orderId)}/status`, { orderStatus: "cancelled_by_admin", note: reason }),
  cancelOrder: (orderId, reason = "Cancelled by admin") =>
    adminClient.patch(`/food/admin/orders/${String(orderId)}/status`, { orderStatus: "cancelled_by_admin", note: reason }),
  markOrderDelivered: (orderId, note = "Marked as delivered by admin") =>
    adminClient.patch(`/food/admin/orders/${String(orderId)}/status`, { orderStatus: "delivered", note }),
  resendDeliveryNotification: (orderId, voipToken = "") =>
    adminClient.post(`/food/admin/orders/${String(orderId)}/resend-notification`, { voipToken }),
  deleteOrder: (orderId) =>
    adminClient.delete(`/food/admin/orders/${String(orderId)}`),
  /** Dispatch settings â€“ auto vs manual assign (global) */
  /** Create restaurant (admin). Single API: POST /food/admin/restaurants. Body: JSON with image URLs. */
  createRestaurant: (body) =>
    adminClient.post("/food/admin/restaurants", body ?? {}),
  /** List delivery zones. Query: limit, page, isActive, search */
  getZones: (params = {}) =>
    adminClient.get("/food/admin/zones", { params: { limit: 1000, ...params } }),
  /** Restaurant report (admin). */
  getRestaurantReport: (params = {}) =>
    adminClient.get("/food/admin/reports/restaurants", { params: { page: 1, limit: 1000, ...params } }),
  getTransactionReport: (params = {}) =>
    adminClient.get("/food/admin/reports/transactions", { params: { page: 1, limit: 1000, ...params } }),
  getTaxReport: (params = {}) =>
    adminClient.get("/food/admin/reports/tax", { params: { page: 1, limit: 1000, ...params } }),
  getTaxReportDetail: (id, params = {}) =>
    adminClient.get(`/food/admin/reports/tax/${id}`, { params }),
  /** Get single zone by id */
  getZoneById: (id) =>
    adminClient.get(`/food/admin/zones/${id}`),
  /** Create zone. Body: name, zoneName?, country?, unit?, coordinates, isActive? */
  createZone: (body) =>
    adminClient.post("/food/admin/zones", body ?? {}),
  /** Update zone. Body: name?, zoneName?, country?, unit?, coordinates?, isActive? */
  updateZone: (id, body) =>
    adminClient.patch(`/food/admin/zones/${id}`, body ?? {}),
  /** Delete zone */
  deleteZone: (id) =>
    adminClient.delete(`/food/admin/zones/${id}`),

  /** Business Settings */
  getBusinessSettings: () =>
    adminClient.get("/food/admin/business-settings"),
  getPublicBusinessSettings: () =>
    userClient.get("/food/admin/business-settings/public"),
  updateBusinessSettings: (data, files = {}) => {
    const formData = new FormData();
    formData.append("data", JSON.stringify(data));
    if (files.logo) formData.append("logo", files.logo);
    if (files.favicon) formData.append("favicon", files.favicon);

    return adminClient.patch("/food/admin/business-settings", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  /** Feedback Experience (admin) */
  getFeedbackExperiences: (params = {}) =>
    adminClient.get(API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE, { params }),
  deleteFeedbackExperience: (id) =>
    adminClient.delete(`${API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE}/${id}`),

  /** Public env variables (safe subset). Used for runtime keys like Google Maps. */
  // getPublicEnvVariables removed: rely on import.meta.env instead.

  /** Public categories (user app) - zone-aware, cached + deduped */
  getPublicCategories: (params = {}, config = {}) =>
    getPublicCategoriesOnce(params, config),

  /** Offers & Coupons (admin) */
  getAllOffers: (params = {}) =>
    adminClient.get("/food/admin/offers", { params }),
  createAdminOffer: (body) =>
    adminClient.post("/food/admin/offers", body ?? {}),
  updateAdminOfferCartVisibility: (offerId, itemId, showInCart) =>
    adminClient.patch(`/food/admin/offers/${String(offerId)}/cart-visibility`, { itemId: String(itemId), showInCart: Boolean(showInCart) }),
  deleteAdminOffer: (offerId) =>
    adminClient.delete(`/food/admin/offers/${String(offerId)}`),

  /** Delivery Partner Bonus (admin) */
  getDeliveryPartnerBonusTransactions: (params = {}) =>
    adminClient.get("/food/admin/delivery/bonus-transactions", { params }),
  /** Delivery Earnings (admin) */
  getDeliveryEarnings: (params = {}) =>
    adminClient.get("/food/admin/delivery/earnings", { params }),
  addDeliveryPartnerBonus: (deliveryPartnerId, amount, reference = "") =>
    adminClient.post("/food/admin/delivery/bonus", {
      deliveryPartnerId: String(deliveryPartnerId),
      amount: Number(amount),
      reference: String(reference || ""),
    }),

  /** Earning Addon Offers (admin) */
  getEarningAddons: (params = {}) =>
    adminClient.get("/food/admin/delivery/earning-addons", { params }),
  createEarningAddon: (body) =>
    adminClient.post("/food/admin/delivery/earning-addons", body ?? {}),
  updateEarningAddon: (id, body) =>
    adminClient.patch(`/food/admin/delivery/earning-addons/${String(id)}`, body ?? {}),
  deleteEarningAddon: (id) =>
    adminClient.delete(`/food/admin/delivery/earning-addons/${String(id)}`),
  toggleEarningAddonStatus: (id, status) =>
    adminClient.patch(`/food/admin/delivery/earning-addons/${String(id)}/status`, { status: String(status) }),

  /** Earning Addon History (admin) */
  getEarningAddonHistory: (params = {}) =>
    adminClient.get("/food/admin/delivery/earning-addon-history", { params }),
  creditEarningToWallet: (historyId, notes = "") =>
    adminClient.post(`/food/admin/delivery/earning-addon-history/${String(historyId)}/credit`, { notes: String(notes || "") }),
  cancelEarningAddonHistory: (historyId, reason = "") =>
    adminClient.post(`/food/admin/delivery/earning-addon-history/${String(historyId)}/cancel`, { reason: String(reason || "") }),
  checkEarningAddonCompletions: (deliveryPartnerId, force = false) =>
    adminClient.post("/food/admin/delivery/earning-addon-completions/check", { deliveryPartnerId: String(deliveryPartnerId), force: Boolean(force) }),
  getDeliveryWallets: (params = {}) =>
    adminClient.get("/food/admin/delivery/wallets", { params }),
  getDeliveryWithdrawals: (params = {}) =>
    adminClient.get("/food/admin/delivery/withdrawals", { params }),
  updateDeliveryWithdrawalStatus: (id, body) =>
    adminClient.patch(`/food/admin/delivery/withdrawals/${String(id)}`, body),
  getCashLimitSettlements: (params = {}) =>
    adminClient.get("/food/admin/delivery/cash-limit-settlements", { params }),

  /** Restaurant Commission (admin) */
  getRestaurantCommissionBootstrap: () =>
    adminClient.get("/food/admin/restaurant-commissions/bootstrap"),
  updateGlobalRestaurantCommissionSettings: (body) =>
    adminClient.post("/food/admin/restaurant-commissions/global", body),
  getRestaurantCommissions: (params = {}) =>
    adminClient.get("/food/admin/restaurant-commissions", { params }),
  getRestaurantCommissionById: (id) =>
    adminClient.get(`/food/admin/restaurant-commissions/${String(id)}`),
  createRestaurantCommission: (body) =>
    adminClient.post("/food/admin/restaurant-commissions", body ?? {}),
  updateRestaurantCommission: (id, body) =>
    adminClient.patch(`/food/admin/restaurant-commissions/${String(id)}`, body ?? {}),
  deleteRestaurantCommission: (id) =>
    adminClient.delete(`/food/admin/restaurant-commissions/${String(id)}`),
  toggleRestaurantCommissionStatus: (id) =>
    adminClient.patch(`/food/admin/restaurant-commissions/${String(id)}/toggle`, {}),
  /** Backward-compatible alias used in UI */
  getApprovedRestaurants: (params = {}) =>
    adminClient.get("/food/admin/restaurants", { params: { status: "live_and_banned", limit: 1000, ...params } }),

  /** Delivery Boy Commission Rules (admin) */
  getCommissionRules: () =>
    adminClient.get("/food/admin/delivery/commission-rules"),
  createCommissionRule: (body) =>
    adminClient.post("/food/admin/delivery/commission-rules", body ?? {}),
  updateCommissionRule: (id, body) =>
    adminClient.patch(`/food/admin/delivery/commission-rules/${String(id)}`, body ?? {}),
  deleteCommissionRule: (id) =>
    adminClient.delete(`/food/admin/delivery/commission-rules/${String(id)}`),
  toggleCommissionRuleStatus: (id, status) =>
    adminClient.patch(`/food/admin/delivery/commission-rules/${String(id)}/status`, { status: Boolean(status) }),

  /** Fee Settings (admin) */
  getFeeSettings: () =>
    adminClient.get("/food/admin/fee-settings"),
  createOrUpdateFeeSettings: (body) =>
    adminClient.put("/food/admin/fee-settings", body ?? {}),

  /** Referral Settings (admin) */
  getReferralSettings: () =>
    adminClient.get("/food/admin/referral-settings"),
  createOrUpdateReferralSettings: (body) =>
    adminClient.put("/food/admin/referral-settings", body ?? {}),

  /** Safety / Emergency Reports (admin) */
  getSafetyEmergencyReports: (params) =>
    adminClient.get("/food/admin/safety-emergency-reports", { params: params ?? {} }),
  updateSafetyEmergencyStatus: (id, status) =>
    adminClient.put(`/food/admin/safety-emergency-reports/${String(id)}/status`, { status: String(status) }),
  updateSafetyEmergencyPriority: (id, priority) =>
    adminClient.put(`/food/admin/safety-emergency-reports/${String(id)}/priority`, { priority: String(priority) }),
  deleteSafetyEmergencyReport: (id) =>
    adminClient.delete(`/food/admin/safety-emergency-reports/${String(id)}`),

  /** Delivery Cash Limit (admin) */
  getDeliveryCashLimit: () =>
    adminClient.get("/food/admin/delivery-cash-limit"),
  updateDeliveryCashLimit: (body) =>
    adminClient.patch("/food/admin/delivery-cash-limit", body ?? {}),

  /** Delivery Emergency Help (admin) */
  getEmergencyHelp: () =>
    adminClient.get("/food/admin/delivery-emergency-help"),
  createOrUpdateEmergencyHelp: (body) =>
    adminClient.put("/food/admin/delivery-emergency-help", body ?? {}),

  /** Restaurant add-ons approval (admin) */
  getRestaurantAddons: (params = {}) =>
    adminClient.get("/food/admin/addons", { params: params ?? {} }),
  updateRestaurantAddon: (id, body) =>
    adminClient.patch(`/food/admin/addons/${String(id)}`, body ?? {}),
  approveRestaurantAddon: (id) =>
    adminClient.patch(`/food/admin/addons/${String(id)}/approve`, {}),
  rejectRestaurantAddon: (id, reason) =>
    adminClient.patch(`/food/admin/addons/${String(id)}/reject`, { reason: String(reason || "").trim() }),
  /** Business Settings (admin) */
  getBusinessSettings: () =>
    adminClient.get(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS),
  updateBusinessSettings: (data, files = {}) => {
    const formData = new FormData();
    // Add JSON data
    formData.append("data", JSON.stringify(data));
    // Add files
    if (files.logo) formData.append("logo", files.logo);
    if (files.favicon) formData.append("favicon", files.favicon);

    return adminClient.patch(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  updateBusinessToggles: (body) =>
    adminClient.patch("/food/admin/business-settings/toggles", body ?? {}),
};

/** Restaurant API - OTP login via new backend; no email/password. */
export const restaurantAPI = {
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestRestaurantOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, _email, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyRestaurantOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => authService.getMe("restaurant"),
  /** Restaurant dashboard: fetch current restaurant profile (deduped + short-cached). */
  getCurrentRestaurant: () => getRestaurantCurrentOnce(),
  /** Finance dashboard for `hub-finance`. */
  getFinance: (params = {}) =>
    restaurantClient.get("/food/restaurant/finance", { params: params || {} }),
  /** Restaurant overview dashboard KPIs and charts. */
  getDashboardStats: (params = {}) =>
    restaurantClient.get("/food/restaurant/dashboard-stats", { params: params || {} }),
  /** Fetch restaurant by owner (stub for missing backend endpoint). */
  getRestaurantByOwner: () =>
    Promise.resolve({
      data: {
        success: true,
        data: {
          restaurant: {
            name: "Your Restaurant",
            restaurantId: "REST000001",
            address: "Your address",
          },
        },
      },
    }),
  /** Submit a real withdrawal request to the backend. */
  createWithdrawalRequest: (amount) =>
    restaurantClient.post("/food/restaurant/withdraw", { amount: Number(amount) }),
  /** List withdrawal history for current restaurant. */
  getWithdrawalHistory: () =>
    restaurantClient.get("/food/restaurant/withdrawals"),
    
  // Promocodes
  getPromocodes: () => restaurantClient.get("/food/promocodes"),
  createPromocode: (data) => restaurantClient.post("/food/promocodes", data),
  togglePromocodeStatus: (id, isActive) => restaurantClient.patch(`/food/promocodes/${id}`, { isActive }),
  deletePromocode: (id) => restaurantClient.delete(`/food/promocodes/${id}`),

  /** Update restaurant profile fields (name/cuisines/location/menuImages). */
  updateProfile: (body) =>
    restaurantClient
      .patch("/food/restaurant/profile", body ?? {}, { timeout: 300000 })
      .then((res) => {
        // Keep cache coherent to avoid an immediate refetch storm.
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  updateDiningSettings: (body) =>
    restaurantClient
      .patch("/food/restaurant/dining-settings", body ?? {})
      .then((res) => {
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  requestDiningUpdate: (body) =>
    restaurantClient.post("/food/restaurant/dining-settings/request", body ?? {}),
  getPendingDiningRequest: () =>
    restaurantClient.get("/food/restaurant/dining-settings/pending"),
  /** PATCH /food/restaurant/availability. Body: { isAcceptingOrders: boolean } */
  updateAcceptingOrders: (isAcceptingOrders) =>
    restaurantClient
      .patch(
        "/food/restaurant/availability",
        { isAcceptingOrders: Boolean(isAcceptingOrders) }
      )
      .then((res) => {
        // Keep cache coherent to avoid an immediate refetch storm.
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      }),
  /** Upload and set restaurant profile image (multipart). Field name: file */
  uploadProfileImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return restaurantClient.post("/food/restaurant/profile/profile-image", formData);
  },
  /** Upload a menu/cover image (multipart). Does not auto-attach; use updateProfile(menuImages) after. */
  uploadMenuImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return restaurantClient.post("/food/restaurant/profile/menu-image", formData);
  },
  uploadCoverImages: (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const formData = new FormData();
    normalizedFiles.forEach((file) => formData.append("files", file));
    return restaurantClient.post("/food/restaurant/profile/cover-images", formData);
  },
  uploadMenuImages: (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const formData = new FormData();
    normalizedFiles.forEach((file) => formData.append("files", file));
    return restaurantClient.post("/food/restaurant/profile/menu-images", formData);
  },
  /** Public Offers for users (global/selected restaurant) */
  getPublicOffers: () => userClient.get("/food/restaurant/offers"),
  /** Backward-compat helper used by Cart: returns coupons array for an item by adapting public offers */
  getCouponsByItemIdPublic: (restaurantId, _itemId) =>
    userClient.get("/food/restaurant/offers").then((res) => {
      const list = res?.data?.data?.allOffers || res?.data?.allOffers || [];
      const now = Date.now();
      const coupons = list
        .filter((o) => {
          // Guard: respect selected restaurant scope
          if (String(o?.restaurantScope) === "selected") {
            if (!restaurantId) return false;
            return String(o.restaurantId || "") === String(restaurantId || "");
          }
          return true;
        })
        .map((o) => {
          const isPct = o.discountType === "percentage";
          const discountValue = Number(o.discountValue) || 0;
          const flatDiscount = isPct ? 0 : discountValue;
          return {
            couponCode: o.couponCode,
            discountType: o.discountType,
            discountValue,
            discountPercentage: isPct ? discountValue : 0,
            discount: flatDiscount,
            originalPrice: flatDiscount,
            discountedPrice: 0,
            minOrderValue: Number(o.minOrderValue || 0),
            minOrder: Number(o.minOrderValue || 0),
            maxDiscount: o.maxDiscount != null ? Number(o.maxDiscount) : null,
            customerGroup: o.customerScope === "first-time" ? "new" : "all",
            isGlobalCoupon: true,
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            _ts: now,
          };
        });
      return { data: { success: true, data: { coupons } } };
    }),
  /** Categories (restaurant dashboard) */
  getCategories: (params = {}) =>
    // Compact payload for item creation forms (id + name only).
    restaurantClient.get("/food/restaurant/categories", {
      params: { compact: true, limit: 1000, ...params },
    }),
  // For MenuCategoriesPage compatibility
  getAllCategories: (params = {}) =>
    restaurantClient.get("/food/restaurant/categories", {
      params: {
        includeInactive: true,
        withCounts: true,
        limit: 1000,
        ...params,
      },
    }),
  createCategory: (body) =>
    restaurantClient.post("/food/restaurant/categories", body ?? {}),
  updateCategory: (id, body) =>
    restaurantClient.patch(`/food/restaurant/categories/${String(id)}`, body ?? {}),
  deleteCategory: (id) =>
    restaurantClient.delete(`/food/restaurant/categories/${String(id)}`),
  /** Menu (restaurant dashboard) */
  getMenu: (params = {}) =>
    restaurantClient.get("/food/restaurant/menu", { params }),
  getOrderById: (orderId) =>
    restaurantClient.get(`/food/restaurant/orders/${String(orderId)}`),
  updateMenu: (body) =>
    restaurantClient.patch("/food/restaurant/menu", body ?? {}),
  saveFcmToken: saveRestaurantFcmTokenOnce,
  savePushDevice: (payload = {}) => saveRestaurantPushDevice(payload),
  removePushDevice: (payload = {}) => removeRestaurantPushDevice(payload),
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return restaurantClient.delete(
      `/fcm-tokens/remove`,
      {
        params: { platform },
        data: { token: String(token), platform }
      }
    );
  },
  /** Outlet timings (restaurant dashboard) */
  getOutletTimings: () =>
    restaurantClient.get("/food/restaurant/outlet-timings"),
  saveOutletTimings: (outletTimings) =>
    restaurantClient.put(
      "/food/restaurant/outlet-timings",
      { outletTimings: outletTimings || {} }
    ),
  /** Foods (restaurant) - stored in food_items collection */
  createFood: (body) =>
    restaurantClient.post("/food/restaurant/foods", body ?? {}),
  bulkCreateFood: (items) =>
    restaurantClient.post("/food/restaurant/foods/bulk", items ?? []),
  updateFood: (id, body) =>
    restaurantClient.patch(`/food/restaurant/foods/${String(id)}`, body ?? {}),
  deleteFood: (id) =>
    restaurantClient.delete(`/food/restaurant/foods/${String(id)}`),
  /** Orders (restaurant dashboard) */
  getOrders: (() => {
    // Single-flight de-dupe to avoid duplicate GETs in React StrictMode / double-mount.
    let inFlight = null;
    let inFlightKey = "";
    let cache = null;
    let cacheKey = "";
    let cacheAt = 0;
    const CACHE_MS = 800;

    const buildKey = (p = {}) => JSON.stringify({ limit: 30, page: 1, ...p });

    return (params = {}) => {
      const key = buildKey(params);
      const now = Date.now();

      if (cache && cacheKey === key && now - cacheAt < CACHE_MS) {
        return Promise.resolve(cache);
      }

      if (inFlight && inFlightKey === key) return inFlight;

      inFlightKey = key;
      inFlight = restaurantClient
        .get("/food/restaurant/orders", {
          params: { limit: 30, page: 1, ...params },
        })
        .then((res) => {
          // Backend paginated shape: { data: { data: [...], meta: {...} } }
          // Normalize to { data: { data: { orders: [...], meta } } } for restaurant UI pages.
          const payload = res?.data?.data || {};
          const rowsRaw = Array.isArray(payload.orders)
            ? payload.orders
            : Array.isArray(payload.data)
              ? payload.data
              : [];

          // Normalize backend order fields to match existing restaurant UI expectations.
          // UI historically uses: order.status, order.address, order.total, order.paymentMethod
          const normalizeStatus = (s) => {
            const v = String(s || "").toLowerCase();
            // Backend: created -> treat as confirmed/new in UI
            if (v === "created") return "confirmed";
            // Backend: ready_for_pickup -> ready
            if (v === "ready_for_pickup") return "ready";
            // Backend: picked_up -> out_for_delivery (restaurant handed over)
            if (v === "picked_up") return "out_for_delivery";
            if (v.includes("cancel")) return "cancelled";
            return v || "confirmed";
          };

          const rows = rowsRaw.map((o) => {
            const status = normalizeStatus(o.orderStatus || o.status);
            const address = o.deliveryAddress || o.address;
            const total = o.pricing?.total ?? o.total ?? 0;
            const paymentMethod = o.payment?.method || o.paymentMethod || null;
            return { ...o, status, address, total, paymentMethod };
          });
          const meta = payload.meta || payload.pagination || {};
          const normalized = {
            ...res,
            data: {
              ...res.data,
              data: { orders: rows, meta },
            },
          };

          cache = normalized;
          cacheKey = key;
          cacheAt = Date.now();
          return normalized;
        })
        .finally(() => {
          inFlight = null;
          inFlightKey = "";
        });

      return inFlight;
    };
  })(),
  updateOrderStatus: (orderId, body) => {
    const raw = body ?? {};
    const outgoing = { ...raw };

    // Translate UI-friendly statuses to backend enum values.
    const normalizeOutgoingStatus = (s) => {
      const v = String(s || "")
        .toLowerCase()
        .trim();
      if (!v) return v;
      if (v === "ready") return "ready_for_pickup";
      if (v === "out_for_delivery") return "picked_up";
      if (v === "cancelled") return "cancelled_by_restaurant";
      return v;
    };

    if (outgoing.orderStatus) {
      outgoing.orderStatus = normalizeOutgoingStatus(outgoing.orderStatus);
    }

    return restaurantClient.patch(
      `/food/restaurant/orders/${String(orderId)}/status`,
      outgoing
    );
  },
  /**
   * Accept an incoming order (restaurant).
   * UI expects this to move order into "preparing" bucket.
   * Backend supports PATCH /food/restaurant/orders/:orderId/status with { orderStatus }.
   */
  acceptOrder: async (orderId, _prepTimeMins = null) => {
    try {
      return await restaurantAPI.updateOrderStatus(orderId, {
        orderStatus: "preparing",
      });
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      if (statusCode === 400) {
        // Compatibility fallback: some backends treat "confirmed" as accept action.
        return restaurantAPI.updateOrderStatus(orderId, {
          orderStatus: "confirmed",
        });
      }
      throw error;
    }
  },
  /**
   * Reject/cancel order by restaurant.
   * Backend orderStatus enum: cancelled_by_restaurant.
   */
  rejectOrder: (orderId, reason = "") =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "cancelled_by_restaurant",
      note: reason,
    }),
  /** Mark order ready (restaurant handoff). */
  markOrderReady: (orderId) =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "ready_for_pickup",
    }),
  /**
   * Get a single order by id for restaurant screens.
   * Prefer direct endpoint; fallback to list+filter for backward compatibility.
   */
  getOrderById: async (orderId) => {
    return await restaurantClient.get(`/food/restaurant/orders/${String(orderId)}`);
  },
  /** Add-ons (restaurant) - approval handled by admin */
  getAddons: (params = {}) =>
    restaurantClient.get("/food/restaurant/addons", {
      // Backend validator enforces limit <= 100
      params: { limit: 100, page: 1, ...params }
    }),
  addAddon: (body) =>
    restaurantClient.post("/food/restaurant/addons", body ?? {}),
  updateAddon: (id, body) =>
    restaurantClient.patch(`/food/restaurant/addons/${String(id)}`, body ?? {}),
  deleteAddon: (id) =>
    restaurantClient.delete(`/food/restaurant/addons/${String(id)}`),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    restaurantCurrentInFlight = null;
    restaurantCurrentCached = null;
    restaurantCurrentCacheTime = 0;
    const token =
      refreshToken || getModuleRefreshToken("restaurant");
    const resolvedFcmToken = fcmToken || getModuleFcmToken("restaurant");
    return authService.logout(token, resolvedFcmToken, platform);
  },
  /** Backend has no email/password login; use phone OTP only. */
  login: (_email, _password) =>
    Promise.reject(new Error("Please use phone number and OTP to sign in.")),
  /**
   * Register a restaurant (multipart FormData).
   * Backend: POST /v1/food/restaurant/register (path relative to baseURL /api/v1)
   */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return restaurantClient.post("/food/restaurant/register", formData, { timeout: 300000 });
  },
  /** Public: list approved restaurants for user app */
  getRestaurants: (params = {}, config = {}) =>
    getPublicRestaurantsOnce(params, config),
  /** Public: get single approved restaurant by id or slug */
  getRestaurantById: (id, config = {}) =>
    userClient.get(`/food/restaurant/restaurants/${String(id)}`, { ...config }),
  /** Public: get approved menu by restaurant id or slug */
  getMenuByRestaurantId: (id, config = {}) =>
    getPublicRestaurantMenuOnce(id, config),
  /** Public: get outlet timings by restaurant id */
  getOutletTimingsByRestaurantId: (id, config = {}) =>
    getPublicRestaurantOutletTimingsOnce(id, config),
  /** Public (user app): approved add-ons by restaurant id/slug */
  getAddonsByRestaurantId: (id, config = {}) =>
    userClient.get(`/food/restaurant/restaurants/${String(id)}/addons`, {
      ...config,
    }),
  getPublicOffers: (params = {}) =>
    userClient.get("/food/restaurant/offers", { params }),
  /** Resend delivery notification (restaurant dashboard) */
  resendDeliveryNotification: (orderId, voipToken = "") =>
    restaurantClient.post(`/food/restaurant/orders/${String(orderId)}/resend-notification`, { voipToken }),
  /** List restaurant complaints (for current restaurant dashboard) */
  getComplaints: (params = {}) =>
    restaurantClient.get("/food/restaurant/complaints", { params }),
  /** Restaurant support tickets */
  createSupportTicket: (body = {}) =>
    restaurantClient.post("/food/restaurant/support/tickets", body ?? {}),
  getSupportTickets: (params = {}) =>
    restaurantClient.get("/food/restaurant/support/tickets", { params }),
  /** DELETE /food/restaurant/account - permanently delete restaurant account */
  deleteAccount: () =>
    restaurantClient.delete("/food/restaurant/account"),
};

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function createInFlightCache({ ttlMs }) {
  const inFlight = new Map();
  const cached = new Map(); // key -> { t, v }

  const getCached = (key) => {
    const hit = cached.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      cached.delete(key);
      return null;
    }
    return hit.v;
  };

  const getOrCreate = (key, factory) => {
    const cachedValue = getCached(key);
    if (cachedValue) return Promise.resolve(cachedValue);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = Promise.resolve()
      .then(factory)
      .then((res) => {
        cached.set(key, { t: Date.now(), v: res });
        return res;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, p);
    return p;
  };

  return { getOrCreate };
}

// Public user-app endpoints can be called by multiple components/effects on refresh (and React StrictMode in dev).
// A small in-flight + short TTL cache collapses duplicate requests without changing functionality.
const publicRestaurantsCache = createInFlightCache({ ttlMs: 1000 }); // 1 second for fast updates
const publicRestaurantMenuCache = createInFlightCache({ ttlMs: 300000 });
const publicRestaurantOutletTimingsCache = createInFlightCache({ ttlMs: 300000 });
const publicCategoriesCache = createInFlightCache({ ttlMs: 300000 });
const publicFoodsCache = createInFlightCache({ ttlMs: 300000 });
const publicGenericGetCache = createInFlightCache({ ttlMs: 300000 });

export const publicGetOnce = (url, config = {}) => {
  const safeUrl = typeof url === "string" ? url.trim() : "";
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeUrl) return Promise.reject(new Error("url is required"));

  if (noCache) {
    return userClient.get(safeUrl, { params, ...axiosConfig });
  }

  const keyParams =
    params && typeof params === "object" ? { ...params } : params;
  if (keyParams && typeof keyParams === "object") {
    // `_ts` is used as a cache-buster in some call sites; ignore it for dedupe purposes.
    delete keyParams._ts;
  }

  const key = `GET:${safeUrl}:${stableStringify(keyParams)}`;
  return publicGenericGetCache.getOrCreate(key, () =>
    userClient.get(safeUrl, { params, ...axiosConfig }),
  );
};

/** Cached public landing settings — shared by Home, BottomNav, DesktopNavbar, Under250. */
export const getPublicLandingSettings = (zoneId = null) =>
  publicGetOnce("/food/landing/settings/public", {
    params: zoneId ? { zoneId } : {},
  }).then((res) => res?.data?.data ?? res?.data ?? {});

/** Cached explore icons — shared across Home and landing config. */
export const getPublicExploreIcons = (zoneId = null) =>
  publicGetOnce("/food/explore-icons/public", {
    params: zoneId ? { zoneId } : {},
  }).then((res) => res?.data?.data ?? res?.data ?? {});

const getPublicCategoriesOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  const keyParams =
    params && typeof params === "object" ? { ...params } : {};
  if (keyParams._ts) delete keyParams._ts;

  if (noCache) {
    return userClient.get("/food/restaurant/categories/public", {
      params: keyParams,
      ...axiosConfig,
    });
  }

  const key = `categories:${stableStringify(keyParams)}`;
  return publicCategoriesCache.getOrCreate(key, () =>
    userClient.get("/food/restaurant/categories/public", {
      params: keyParams,
      ...axiosConfig,
    }),
  );
};

/** Cached public categories — shared by Home, CategoryPage, SearchResults, etc. */
export const getPublicCategories = (zoneId = null, config = {}) =>
  getPublicCategoriesOnce(zoneId ? { zoneId } : {}, config).then(
    (res) => res?.data?.data ?? res?.data ?? {},
  );

const getPublicFoodsOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  const keyParams =
    params && typeof params === "object" ? { ...params } : {};
  if (keyParams._ts) delete keyParams._ts;

  if (noCache) {
    return userClient.get("/food/restaurant/foods/public", {
      params: keyParams,
      ...axiosConfig,
    });
  }

  const key = `foods:${stableStringify(keyParams)}`;
  return publicFoodsCache.getOrCreate(key, () =>
    userClient.get("/food/restaurant/foods/public", {
      params: keyParams,
      ...axiosConfig,
    }),
  );
};

/** Cached public foods — zone-scoped approved items for CategoryPage fallbacks. */
export const getPublicFoods = (params = {}, config = {}) =>
  getPublicFoodsOnce(params, config).then(
    (res) => res?.data?.data ?? res?.data ?? {},
  );

const getPublicRestaurantsOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  if (noCache) {
    return userClient.get("/food/restaurant/restaurants", {
      params: { limit: 1000, ...params },
      ...axiosConfig,
    });
  }
  const keyParams = { limit: 1000, ...params };
  // `_ts` is an explicit cache-buster in many call sites; ignore it for dedupe purposes.
  if (keyParams && typeof keyParams === "object") {
    delete keyParams._ts;
    // Round coords so minor GPS jitter does not bust the cache.
    if (Number.isFinite(Number(keyParams.lat))) {
      keyParams.lat = Math.round(Number(keyParams.lat) * 100000) / 100000;
    }
    if (Number.isFinite(Number(keyParams.lng))) {
      keyParams.lng = Math.round(Number(keyParams.lng) * 100000) / 100000;
    }
  }
  const key = `restaurants:${stableStringify(keyParams)}`;
  return publicRestaurantsCache.getOrCreate(key, () =>
    userClient.get("/food/restaurant/restaurants", {
      params: { limit: 1000, ...params },
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantMenuOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return userClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      ...axiosConfig,
    });
  }
  const key = `menu:${safeId}`;
  return publicRestaurantMenuCache.getOrCreate(key, () =>
    userClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantOutletTimingsOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return userClient.get(
      `/food/restaurant/restaurants/${safeId}/outlet-timings`,
      { ...axiosConfig },
    );
  }
  const key = `outletTimings:${safeId}`;
  return publicRestaurantOutletTimingsCache.getOrCreate(key, () =>
    userClient.get(`/food/restaurant/restaurants/${safeId}/outlet-timings`, {
      ...axiosConfig,
    }),
  );
};

/** Single in-flight + short cache for restaurant /food/restaurant/current - prevents request storms. */
let restaurantCurrentInFlight = null;
let restaurantCurrentCached = null;
let restaurantCurrentCacheTime = 0;
const RESTAURANT_CURRENT_CACHE_MS = 3000;

const getRestaurantCurrentOnce = () => {
  const now = Date.now();
  if (
    restaurantCurrentCached &&
    now - restaurantCurrentCacheTime < RESTAURANT_CURRENT_CACHE_MS
  ) {
    return Promise.resolve(restaurantCurrentCached);
  }
  if (!restaurantCurrentInFlight) {
    restaurantCurrentInFlight = restaurantClient
      .get("/food/restaurant/current")
      .then((res) => {
        restaurantCurrentCached = res;
        restaurantCurrentCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        restaurantCurrentInFlight = null;
      });
  }
  return restaurantCurrentInFlight;
};

/** Single in-flight + short cache for delivery /auth/me - one call per page load / refresh. */
let deliveryMeInFlight = null;
let deliveryMeCached = null;
let deliveryMeCacheTime = 0;
const DELIVERY_ME_CACHE_MS = 3000;

const getDeliveryMeOnce = () => {
  const now = Date.now();
  if (deliveryMeCached && now - deliveryMeCacheTime < DELIVERY_ME_CACHE_MS) {
    return Promise.resolve(deliveryMeCached);
  }
  if (!deliveryMeInFlight) {
    deliveryMeInFlight = authService
      .getMe("delivery")
      .then((res) => {
        deliveryMeCached = res;
        deliveryMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        deliveryMeInFlight = null;
      });
  }
  return deliveryMeInFlight;
};

/** Delivery API - OTP login + registration via new backend. */
export const deliveryAPI = {
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestDeliveryOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyDeliveryOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => getDeliveryMeOnce(),
  /** Get delivery profile (same as getMe under the hood; maps response to profile shape). */
  getProfile: () =>
    getDeliveryMeOnce().then((res) => ({
      ...res,
      data: {
        ...res.data,
        data: { profile: res.data?.data?.user ?? res.data?.data },
      },
    })),
  getReferralStats: () =>
    deliveryClient.get("/food/delivery/referrals/stats"),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    deliveryMeCached = null;
    deliveryMeCacheTime = 0;
    try {
      localStorage.removeItem("app:isOnline");
    } catch (_) {}
    const token =
      refreshToken || getModuleRefreshToken("delivery");
    const resolvedFcmToken = fcmToken || getModuleFcmToken("delivery");
    return authService.logout(token, resolvedFcmToken, platform);
  },
  /** POST /food/delivery/register - multipart FormData (new partner, no token). */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return deliveryClient.post("/food/delivery/register", formData);
  },
  /** PATCH /food/delivery/profile - complete profile after OTP (Bearer token required). */
  completeProfile: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return deliveryClient.patch("/food/delivery/profile", formData);
  },
  /** PATCH /food/delivery/profile/details - JSON updates (vehicle number, etc). */
  updateProfileDetails: (payload) =>
    deliveryClient.patch("/food/delivery/profile/details", payload ?? {}),
  /** PATCH /food/delivery/profile - multipart updates for photos/documents (uses same endpoint). */
  updateProfileMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return deliveryClient.patch("/food/delivery/profile", formData);
  },
  /** POST /food/delivery/profile/photo-base64 - Flutter in-app camera base64 upload. */
  updateProfilePhotoBase64: (payload) =>
    deliveryClient.post("/food/delivery/profile/photo-base64", payload ?? {}),
  /** PATCH /food/delivery/profile/bank-details - update bank details + PAN (JSON, Bearer required). */
  updateProfile: (payload) =>
    deliveryClient.patch("/food/delivery/profile/bank-details", payload ?? {}),
  /** PATCH /food/delivery/profile/bank-details - multipart updates for bank details + UPI QR (FormData required). */
  updateBankDetailsMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return deliveryClient.patch("/food/delivery/profile/bank-details", formData);
  },
  saveFcmToken: saveDeliveryFcmTokenOnce,
  savePushDevice: (payload = {}) => saveDeliveryPushDevice(payload),
  removePushDevice: (payload = {}) => removeDeliveryPushDevice(payload),
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return deliveryClient.delete(
      `/fcm-tokens/remove`,
      {
        params: { platform },
        data: { token: String(token), platform }
      }
    );
  },
  /** GET /food/delivery/support-tickets - list tickets for logged-in delivery partner. */
  getSupportTickets: () =>
    deliveryClient.get("/food/delivery/support-tickets"),
  /** POST /food/delivery/support-tickets - create ticket (body: subject, description, category?, priority?). */
  createSupportTicket: (body) =>
    deliveryClient.post("/food/delivery/support-tickets", body ?? {}),
  /** GET /food/delivery/support-tickets/:id - get one ticket (own only). */
  getSupportTicketById: (id) =>
    deliveryClient.get(`/food/delivery/support-tickets/${id}`),
  /** PATCH /food/delivery/availability - set online/offline (and optional lat/lng). */
  updateOnlineStatus: (isOnline, shiftStartPicBase64 = null, shiftStartAddress = null) =>
    deliveryClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline", shiftStartPicBase64, shiftStartAddress }
    ),
  updateLocation: (latitude, longitude, isOnline, extras = {}) =>
    deliveryClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline", latitude, longitude, ...extras }
    ),
  /** Orders */
  getOrders: (() => {
    // Collapse duplicate list fetches triggered by multiple effects + StrictMode.
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 2500;

    const stableKey = (p = {}) => {
      const safe = p && typeof p === "object" ? { ...p } : {};
      // Ensure stable ordering + defaults.
      const normalized = { limit: 50, page: 1, ...safe };
      // Remove cache-busters if any.
      delete normalized._ts;
      return JSON.stringify(
        Object.keys(normalized)
          .sort()
          .reduce((acc, k) => {
            acc[k] = normalized[k];
            return acc;
          }, {}),
      );
    };

    return (params = {}) => {
      const key = stableKey(params);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = deliveryClient
        .get("/food/delivery/orders/available", {
          params: { limit: 50, page: 1, ...params }
        })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  getOrderDetails: (() => {
    // Collapse duplicate calls coming from multiple effects (and React StrictMode in dev).
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 1200;

    const isProbablyOrderIdentity = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return false;
      // Mongo ObjectId
      return /^[a-f0-9]{24}$/i.test(raw);
    };

    return (orderId) => {
      const key = String(orderId || "").trim();
      if (!isProbablyOrderIdentity(key)) {
        return Promise.resolve({
          data: { success: false, message: "Invalid order id", data: null },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        });
      }

      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = deliveryClient
        .get(`/food/delivery/orders/${key}`)
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  /** GET /food/delivery/current - fallback for some UI hooks */
  getCurrentDelivery: () => deliveryClient.get("/food/delivery/orders/current"),
  acceptOrder: (orderId, body = {}) =>
    deliveryClient.patch(
      `/food/delivery/orders/${String(orderId)}/accept`,
      body ?? {}
    ),
  rejectOrder: (orderId, body = {}) =>
    deliveryClient.patch(
      `/food/delivery/orders/${String(orderId)}/reject`,
      body ?? {}
    ),
  /**
   * PATCH /food/delivery/orders/:orderId/reached-pickup
   * Marks "reached pickup" (arrival at restaurant) in backend order deliveryState.
   */
  confirmReachedPickup: (orderId) =>
    deliveryClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-pickup`,
      {}
    ),
  /**
   * Confirm order ID and upload bill image (Picked Up slide).
   * Backend endpoint: PATCH /food/delivery/orders/:id/confirm-pickup
   */
  confirmOrderId: (orderId, confirmedOrderId, location = {}, data = {}) =>
    deliveryClient.patch(
      `/food/delivery/orders/${String(orderId)}/confirm-pickup`,
      {
        confirmedOrderId,
        latitude: location.lat,
        longitude: location.lng,
        billImageUrl: data.billImageUrl,
        otp: data.otp,
      }
    ),
  requestPickupOtp: (orderId) =>
    deliveryClient.post(
      `/food/delivery/orders/${String(orderId)}/request-pickup-otp`,
      {}
    ),
  confirmReachedDrop: (orderId) =>
    deliveryClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-drop`,
      {}
    ),
  verifyDropOtp: (orderId, otp) =>
    deliveryClient.post(
      `/food/delivery/orders/${String(orderId)}/verify-drop-otp`,
      { otp: String(otp) }
    ),
  /** POST /food/delivery/orders/:orderId/collect/qr - create Razorpay payment link (COD collection) */
  createCollectQr: (orderId, body = {}) =>
    deliveryClient.post(
      `/food/delivery/orders/${String(orderId)}/collect/qr`,
      body ?? {}
    ),
  /** GET /food/delivery/orders/:orderId/payment-status - check COD/QR payment status */
  getPaymentStatus: (orderId) =>
    deliveryClient.get(`/food/delivery/orders/${String(orderId)}/payment-status`),
  completeDelivery: (orderId, body = {}) => {
    // Backward-compatible: older UI calls completeDelivery(orderId, rating, review)
    // where rating is a number (sent as raw JSON like "3"). Normalize to an object.
    let payload = body ?? {};
    if (
      typeof payload === "number" ||
      typeof payload === "string" ||
      payload == null
    ) {
      payload = { rating: payload == null ? null : Number(payload) };
    }
    return deliveryClient.patch(
      `/food/delivery/orders/${String(orderId)}/complete`,
      payload
    );
  },
  updateOrderStatus: (orderId, body = {}) =>
    deliveryClient.patch(
      `/food/delivery/orders/${String(orderId)}/status`,
      body ?? {}
    ),
  /** Registration Re-verification */
  reverify: () =>
    deliveryClient.post("/food/delivery/reverify", {}),
  /** GET /food/delivery/wallet - wallet for Pocket/requests page (backend) */
  getWallet: () =>
    deliveryClient.get("/food/delivery/wallet"),
  /** GET /food/delivery/earnings - earnings summary for Pocket/requests page */
  getEarnings: (params) =>
    deliveryClient.get("/food/delivery/earnings", {
      params: params ?? {}
    }),
  /** Earning Addons (Hotspots/Bonus) */
  getActiveEarningAddons: () =>
    deliveryClient.get("/food/delivery/earning-addons/active"),
  /** GET /food/delivery/trip-history - completed/cancelled/pending trips for delivery partner */
  getTripHistory: (params) =>
    deliveryClient.get("/food/delivery/trip-history", {
      params: params ?? {}
    }),
  /** GET /food/delivery/pocket-details - single-call week details (trips + transactions) */
  getPocketDetails: (params) =>
    deliveryClient.get("/food/delivery/pocket-details", {
      params: params ?? {}
    }),
  /** GET /food/delivery/emergency-help - admin-set emergency numbers for delivery partner */
  getEmergencyHelp: () =>
    deliveryClient.get("/food/delivery/emergency-help"),
  /** GET /food/delivery/cash-limit - admin-set cash limit for delivery partner */
  getCashLimit: () =>
    deliveryClient.get("/food/delivery/cash-limit"),
  createWithdrawalRequest: (body) =>
    deliveryClient.post("/food/delivery/wallet/withdraw", body ?? {}),
  createDepositOrder: (amount) =>
    deliveryClient.post("/food/delivery/wallet/deposit/order", { amount }),
  verifyDepositPayment: (body) =>
    deliveryClient.post("/food/delivery/wallet/deposit/verify", body ?? {}),
  /** Wallet transactions - from wallet response (no separate backend endpoint) */
  getWalletTransactions: (params) =>
    deliveryClient
      .get("/food/delivery/wallet", {
        params: params ?? {}
      })
      .then((res) => ({
        ...res,
        data: {
          ...res.data,
          data: {
            transactions: res?.data?.data?.wallet?.transactions ?? [],
          },
        },
      })),
  /** Zone discovery */
  getZonesInRadius: (lat, lng, radiusKm = 10) =>
    deliveryClient.get("/food/zones/nearby", {
      params: { lat, lng, radius: radiusKm }
    }),
  /** DELETE /food/delivery/account - permanently delete delivery partner account */
  deleteAccount: () =>
    deliveryClient.delete("/food/delivery/account"),
};

export const userAPI = {
  /** Get current user profile (Bearer USER). */
  getProfile: () =>
    getUserMeOnce().then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { ...res, data: { ...res.data, data: { user } } };
    }),
  /** PATCH /food/user/profile (Bearer USER) */
  updateProfile: (body) =>
    userClient.patch("/food/user/profile", body ?? {}),
    
  // Promocodes
  getActivePromocodes: (restaurantId) =>
    userClient.get(`/food/promocodes/restaurant/${restaurantId}`),
  validatePromocode: (data) =>
    userClient.post("/food/promocodes/validate", data),
    
  /** Upload and set user profile image (multipart). Field name: file */
  uploadProfileImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return userClient.post("/food/user/profile/profile-image", formData);
  },
  /** GET /food/user/wallet (Bearer USER). Deduped + short-cached. */
  getWallet: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = userClient
          .get("/food/user/wallet")
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** GET /food/user/referrals/stats (Bearer USER) */
  getReferralStats: () =>
    userClient.get("/food/user/referrals/stats"),
  /** GET /food/user/referrals/details (Bearer USER) */
  getReferralDetails: () =>
    userClient.get("/food/user/referrals/details"),
  /** POST /food/user/wallet/topup/order (Bearer USER). Body: { amount } */
  createWalletTopupOrder: (amount) =>
    userClient.post(
      "/food/user/wallet/topup/order",
      { amount: Number(amount) }
    ),
  /** POST /food/user/wallet/topup/verify (Bearer USER) */
  verifyWalletTopupPayment: (body) =>
    userClient.post("/food/user/wallet/topup/verify", body ?? {}),
  /** GET /food/user/addresses (Bearer USER). Deduped + short-cached. */
  getAddresses: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = userClient
          .get("/food/user/addresses")
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** POST /food/user/addresses (Bearer USER) */
  addAddress: (body) =>
    userClient.post("/food/user/addresses", body ?? {}),
  /** PATCH /food/user/addresses/:id (Bearer USER) */
  updateAddress: (id, body) =>
    userClient.patch(`/food/user/addresses/${String(id)}`, body ?? {}),
  /** DELETE /food/user/addresses/:id (Bearer USER) */
  deleteAddress: (id) =>
    userClient.delete(`/food/user/addresses/${String(id)}`),
  /** PATCH /food/user/addresses/:id/default (Bearer USER) */
  setDefaultAddress: (id) =>
    userClient.patch(
      `/food/user/addresses/${String(id)}/default`,
      {}
    ),
  /** POST /food/user/safety-emergency-reports (Bearer USER) */
  createSafetyEmergencyReport: (message) =>
    userClient.post(
      "/food/user/safety-emergency-reports",
      { message: String(message || "") }
    ),
  /** GET /food/user/safety-emergency-reports (Bearer USER) */
  getMySafetyEmergencyReports: (params) =>
    userClient.get("/food/user/safety-emergency-reports", {
      params: params ?? {}
    }),
  /** GET /food/user/location (Bearer USER) */
  getLocation: () => userClient.get("/food/user/location"),
  /** PUT /food/user/location (Bearer USER) */
  updateLocation: (payload) =>
    userClient.put("/food/user/location", payload ?? {}),
  saveFcmToken: (token, options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return saveUserFcmTokenOnce(token, platform);
  },
  savePushDevice: (payload = {}) => saveUserPushDevice(payload),
  removePushDevice: (payload = {}) => removeUserPushDevice(payload),
  removeFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return userClient.delete(
      `/fcm-tokens/remove`,
      {
        params: { platform },
        data: { token: String(token), platform }
      }
    );
  },
  testFcmNotification: (options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return userClient.post("/fcm-tokens/test", { platform });
  },
  /** DELETE /food/user/account - permanently delete user account */
  deleteAccount: () =>
    userClient.delete("/food/user/account"),
};
export const locationAPI = {
  /** GET /food/location/reverse-geocode?lat=&lng= (public) */
  reverseGeocode: (latitude, longitude) =>
    userClient.get("/food/location/reverse-geocode", {
      params: { lat: latitude, lng: longitude },
    }),
  /** POST /food/location/distance — road + straight-line legs */
  computeDistance: (body) =>
    userClient.post("/food/location/distance", body ?? {}),
};
export const zoneAPI = {
  /** Public: detect active service zone for a lat/lng point. */
  detectZone: (lat, lng) =>
    userClient.get("/food/zones/detect", {
      params: { lat, lng },
    }),
  /** Public: list active zones (for onboarding dropdowns). */
  getPublicZones: (params = {}, config = {}) =>
    userClient.get("/food/zones/public", { params: params ?? {}, ...config }),
};
const uploadRequestWithFallback = async (paths, formData) => {
  const baseUrl = getUploadApiBaseUrl();
  const headers = getUploadAuthHeaders();
  let lastError = null;

  for (const path of paths) {
    try {
      return await axios.post(joinApiUrl(baseUrl, path), formData, {
        timeout: 300000,
        headers,
      });
    } catch (error) {
      lastError = error;
      if (error?.response?.status && error.response.status !== 404) {
        error.userMessage = getUploadErrorMessage(error, { fallback: 'Failed to upload file.' });
        throw error;
      }
    }
  }

  if (lastError) {
    lastError.userMessage = getUploadErrorMessage(lastError, { fallback: 'Failed to upload file.' });
    throw lastError;
  }

  throw new Error('Upload failed');
};

export const uploadAPI = {
  /**
   * Upload a single image file to the backend.
   * @param {File|Blob} file
   * @param {{ folder?: string }} options
   */
  uploadMedia: (file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }

    const formData = new FormData();
    formData.append("file", file);
    if (options.folder) {
      formData.append("folder", options.folder);
    }

    return uploadRequestWithFallback(["/uploads/image", "/uploads/single"], formData);
  },
  /**
   * Upload a single non-image file (PDF) to the backend.
   * @param {File|Blob} file
   * @param {{ folder?: string }} options
   */
  uploadFile: (file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }

    const formData = new FormData();
    formData.append("file", file);
    if (options.folder) {
      formData.append("folder", options.folder);
    }

    return uploadRequestWithFallback(["/uploads/file", "/uploads/single"], formData);
  },
};/** Order API (user app â€“ Bearer USER token). Minimal calls: single create/verify, list/details cached by caller. */
export const orderAPI = {
  calculateOrder: (payload) =>
    userClient.post("/food/orders/calculate", payload ?? {}),
  createOrder: (payload) =>
    userClient.post("/food/orders", payload ?? {}),
  verifyPayment: (body) =>
    userClient.post("/food/orders/verify-payment", body ?? {}),
  getOrders: (params = {}) =>
    userClient
      .get("/food/orders", {
        params: { limit: 20, page: 1, ...params }
      })
      .then((res) => {
        const payload = res?.data?.data;

        // Normalize backend paginated shape:
        // { data: { data: [...], meta: { total, page, limit, totalPages } } }
        // into UI-friendly:
        // { data: { orders: [...], pagination: { total, page, limit, pages } } }
        if (
          payload &&
          typeof payload === "object" &&
          Array.isArray(payload.data) &&
          payload.meta &&
          typeof payload.meta === "object"
        ) {
          const meta = payload.meta;
          return {
            ...res,
            data: {
              ...res.data,
              data: {
                ...payload,
                orders: payload.data,
                pagination: {
                  total: Number(meta.total || 0),
                  page: Number(meta.page || 1),
                  limit: Number(meta.limit || params.limit || 20),
                  pages: Number(meta.totalPages || 1),
                },
              },
            },
          };
        }

        return res;
      }),
  getOrderDetails: (() => {
    const inFlight = new Map();
    const cache = new Map();
    /** Dedupes overlapping calls (StrictMode, poll + socket) without hiding fresh data for long. */
    const CACHE_MS = 800;

    return (orderId, options = {}) => {
      const key = String(orderId ?? "").trim();
      if (!key) {
        return Promise.reject(new Error("orderId required"));
      }

      const force = options.force === true;
      const now = Date.now();
      if (!force) {
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_MS) {
          return Promise.resolve(hit.res);
        }
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const p = userClient
        .get(`/food/orders/${key}`)
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  cancelOrder: (orderId, body = {}) =>
    userClient.patch(`/food/orders/${String(orderId)}/cancel`, body ?? {}),
  updateOrderInstructions: (orderId, instructions) =>
    userClient.patch(`/food/orders/${String(orderId)}/instructions`, { instructions }),
  submitOrderRatings: (orderId, body = {}) =>
    userClient.patch(`/food/orders/${String(orderId)}/ratings`, body ?? {}),
  /** Submit a complaint for an order (user). */
  submitComplaint: (payload) =>
    userClient.post(
      "/food/user/support/ticket",
      {
        type: "order",
        orderId: payload.orderId,
        issueType: payload.complaintType,
        description: payload.subject ? `${payload.subject}: ${payload.description}` : payload.description,
      }
    ),
};

// Dining bookings now handled by backend


export const diningAPI = {
  getCategories: (params = {}) =>
    userClient.get("/food/dining/categories/public", { params }),
  getRestaurants: (params = {}) =>
    userClient.get("/food/dining/restaurants/public", { params }),
  getOccupiedSeatsPublic: (restaurantId) =>
    userClient.get(`/food/dining/restaurants/${String(restaurantId)}/occupied-seats/public`),
  getHeroBanners: () => userClient.get("/food/hero-banners/ads/public"),
  getRestaurantBySlug: (slug, config = {}) =>
    userClient.get(`/food/restaurant/restaurants/${String(slug)}`, config),
  getOfferBanners: () => Promise.resolve({ data: { success: true, data: [] } }),
  getStories: () => Promise.resolve({ data: { success: true, data: [] } }),
  getBankOffers: () => Promise.resolve({ data: { success: true, data: [] } }),
  
  // Real API calls for Bookings
  getBookings: () => 
    userClient.get("/food/dining/bookings/my"),
  
  getRestaurantBookings: (candidate) => {
    const id = candidate?._id || candidate?.id || candidate;
    return restaurantClient.get(`/food/dining/bookings/restaurant/${String(id)}`);
  },
  
  updateBookingStatusRestaurant: (bookingId, status) => 
    restaurantClient.patch(`/food/dining/bookings/${String(bookingId)}/status`, { status }),
  
  createReview: (payload = {}) => 
    userClient.post(`/food/dining/bookings/${String(payload?.bookingId)}/review`, payload),
  
  createBooking: (payload = {}) => 
    userClient.post("/food/dining/bookings", payload),
};
export const heroBannerAPI = createStubAPI();
export const publicAPI = {
  getPrivacy: (key = "privacy") => userClient.get(`/food/pages/${key}`),
  getTerms: (key = "terms") => userClient.get(`/food/pages/${key}`),
  getBusinessSettings: () => apiClient.get("/food/admin/business-settings/public"),
};







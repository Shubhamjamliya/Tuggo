import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Ticket, Plus, Trash2, X, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { restaurantAPI } from "@food/api";
import { toast } from "sonner";
import { Card, CardContent } from "@food/components/ui/card";

export default function Promocodes() {
  const navigate = useNavigate();
  const [promocodes, setPromocodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    code: "",
    description: "",
    discountType: "PERCENTAGE",
    discountValue: "",
    minOrderAmount: "",
    maxDiscountAmount: "",
    expiryDate: "",
    usageLimit: "",
  });

  useEffect(() => {
    fetchPromocodes();
  }, []);

  const fetchPromocodes = async () => {
    try {
      setLoading(true);
      const res = await restaurantAPI.getPromocodes();
      const list = res?.data?.data?.promocodeList || [];
      setPromocodes(list);
    } catch (err) {
      console.error("Error fetching promocodes:", err);
      toast.error("Failed to load promo codes");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleToggleStatus = async (id, currentStatus) => {
    try {
      await restaurantAPI.togglePromocodeStatus(id, !currentStatus);
      toast.success(currentStatus ? "Promo code disabled" : "Promo code enabled");
      fetchPromocodes();
    } catch (err) {
      toast.error("Failed to update status");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this promo code?")) return;
    try {
      await restaurantAPI.deletePromocode(id);
      toast.success("Promo code deleted");
      fetchPromocodes();
    } catch (err) {
      toast.error("Failed to delete promo code");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      
      const payload = {
        code: formData.code.toUpperCase(),
        description: formData.description,
        discountType: formData.discountType,
        discountValue: Number(formData.discountValue),
        minOrderAmount: Number(formData.minOrderAmount) || 0,
        expiryDate: new Date(formData.expiryDate).toISOString(),
      };

      if (formData.maxDiscountAmount && formData.discountType === "PERCENTAGE") {
        payload.maxDiscountAmount = Number(formData.maxDiscountAmount);
      }
      
      if (formData.usageLimit) {
        payload.usageLimit = Number(formData.usageLimit);
      }

      await restaurantAPI.createPromocode(payload);
      toast.success("Promo code created successfully!");
      setIsModalOpen(false);
      setFormData({
        code: "",
        description: "",
        discountType: "PERCENTAGE",
        discountValue: "",
        minOrderAmount: "",
        maxDiscountAmount: "",
        expiryDate: "",
        usageLimit: "",
      });
      fetchPromocodes();
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.message || "Failed to create promo code");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="restaurant-page min-h-full bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-primary px-4 py-4 sticky top-0 z-10 shadow-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <h1 className="text-lg font-bold text-white flex-1">Promo Codes</h1>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : promocodes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm mt-4">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Ticket className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">No Promo Codes Yet</h2>
            <p className="text-gray-500 mb-6 px-4">Create your first promo code to boost your sales and attract more customers!</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-primary text-white font-bold py-3 px-6 rounded-full hover:bg-[#6a2f56] transition-colors active:scale-95"
            >
              Create Promo Code
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {promocodes.map((promo) => (
              <Card key={promo._id} className="overflow-hidden border-0 shadow-sm ring-1 ring-gray-100">
                <div className={`h-2 ${promo.isActive ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="inline-block bg-primary/10 text-primary px-3 py-1 rounded-md border border-primary/20 font-bold tracking-wider mb-2">
                        {promo.code}
                      </div>
                      <h3 className="font-semibold text-gray-900 text-sm">{promo.description}</h3>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="font-black text-lg text-primary">
                        {promo.discountType === "PERCENTAGE" ? `${promo.discountValue}% OFF` : `₹${promo.discountValue} OFF`}
                      </span>
                      <button
                        onClick={() => handleDelete(promo._id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 mb-4 mt-4 text-xs">
                    <div className="bg-gray-50 p-2 rounded-lg">
                      <p className="text-gray-500 mb-0.5">Min Order</p>
                      <p className="font-medium">₹{promo.minOrderAmount}</p>
                    </div>
                    {promo.discountType === "PERCENTAGE" && promo.maxDiscountAmount && (
                      <div className="bg-gray-50 p-2 rounded-lg">
                        <p className="text-gray-500 mb-0.5">Max Discount</p>
                        <p className="font-medium">₹{promo.maxDiscountAmount}</p>
                      </div>
                    )}
                    <div className="bg-gray-50 p-2 rounded-lg">
                      <p className="text-gray-500 mb-0.5">Expires</p>
                      <p className="font-medium">{new Date(promo.expiryDate).toLocaleDateString()}</p>
                    </div>
                    <div className="bg-gray-50 p-2 rounded-lg">
                      <p className="text-gray-500 mb-0.5">Usage</p>
                      <p className="font-medium">{promo.usageCount} {promo.usageLimit ? `/ ${promo.usageLimit}` : 'used'}</p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span className={`text-sm font-medium ${promo.isActive ? 'text-green-600' : 'text-gray-500'}`}>
                      {promo.isActive ? 'Active' : 'Inactive'}
                    </span>
                    
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={promo.isActive}
                        onChange={() => handleToggleStatus(promo._id, promo.isActive)}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Floating Action Button */}
      {promocodes.length > 0 && (
        <button
          onClick={() => setIsModalOpen(true)}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 w-14 h-14 bg-primary text-white rounded-full shadow-lg flex items-center justify-center hover:bg-[#6a2f56] hover:scale-105 active:scale-95 transition-all z-20 lg:bottom-6"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Create Modal */}
      {isModalOpen && typeof document !== "undefined" && createPortal(
            <div className="fixed inset-0 z-[10000] flex items-end justify-center md:items-center md:p-4">
              <button
                type="button"
                aria-label="Close create promo code"
                className="absolute inset-0 bg-black/55"
                onClick={() => setIsModalOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="new-promo-title"
                className="relative z-10 flex max-h-[calc(100dvh-0.75rem)] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:max-h-[min(90dvh,760px)] md:max-w-lg md:rounded-3xl"
              >
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 py-4 sm:px-6">
                <h2 id="new-promo-title" className="text-lg font-bold text-gray-900 sm:text-xl">New Promo Code</h2>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
                <form id="promoForm" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Code <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      name="code"
                      required
                      value={formData.code}
                      onChange={handleChange}
                      placeholder="e.g. SUMMER50"
                      className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent uppercase font-bold tracking-wider"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      name="description"
                      required
                      value={formData.description}
                      onChange={handleChange}
                      placeholder="e.g. 50% off on all orders"
                      className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Discount Type</label>
                      <select
                        name="discountType"
                        value={formData.discountType}
                        onChange={handleChange}
                        className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      >
                        <option value="PERCENTAGE">Percentage (%)</option>
                        <option value="FLAT">Flat Amount (₹)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">
                        {formData.discountType === "PERCENTAGE" ? "Discount Percentage (%)" : "Flat Amount (₹)"} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        name="discountValue"
                        required
                        min="1"
                        max={formData.discountType === "PERCENTAGE" ? "100" : undefined}
                        value={formData.discountValue}
                        onChange={handleChange}
                        placeholder={formData.discountType === "PERCENTAGE" ? "e.g. 50" : "e.g. 150"}
                        className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Min Order (₹)</label>
                      <input
                        type="number"
                        name="minOrderAmount"
                        min="0"
                        value={formData.minOrderAmount}
                        onChange={handleChange}
                        placeholder="0"
                        className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                    </div>
                    {formData.discountType === "PERCENTAGE" && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Max Discount (₹)</label>
                        <input
                          type="number"
                          name="maxDiscountAmount"
                          min="1"
                          value={formData.maxDiscountAmount}
                          onChange={handleChange}
                          placeholder="No limit"
                          className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Expiry Date <span className="text-red-500">*</span></label>
                      <input
                        type="date"
                        name="expiryDate"
                        required
                        min={new Date().toISOString().split('T')[0]}
                        value={formData.expiryDate}
                        onChange={handleChange}
                        className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Total Usage Limit</label>
                      <input
                        type="number"
                        name="usageLimit"
                        min="1"
                        value={formData.usageLimit}
                        onChange={handleChange}
                        placeholder="Unlimited"
                        className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                    </div>
                  </div>
                  
                  <div className="bg-blue-50 text-blue-800 p-3 rounded-lg flex gap-3 text-sm mt-2">
                    <Info className="w-5 h-5 shrink-0 text-blue-600" />
                    <p>Once created, the promo code will immediately be visible and usable by your customers until it expires or reaches its usage limit.</p>
                  </div>
                </form>
              </div>

              <div className="shrink-0 border-t border-gray-100 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.1)] sm:px-6 sm:py-4">
                <button
                  type="submit"
                  form="promoForm"
                  disabled={isSubmitting}
                  className="w-full bg-primary text-white font-bold py-3.5 px-4 rounded-xl hover:bg-[#6a2f56] active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center"
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    "Create Promo Code"
                  )}
                </button>
              </div>
              </div>
            </div>,
        document.body
      )}
    </div>
  );
}

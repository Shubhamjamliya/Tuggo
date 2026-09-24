import { useState, useEffect, useCallback } from "react"
import { Download, DollarSign, Building, FileText, CheckCircle, Loader2, CreditCard, ChevronLeft, ChevronRight } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { generatePayoutPDF } from "@food/utils/payoutPdfGenerator"

export default function RestaurantPayouts() {
  // Filter States
  const [restaurants, setRestaurants] = useState([])
  const [selectedRestaurant, setSelectedRestaurant] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")

  // Data States
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    totalPayout: 0,
    totalCommission: 0,
    totalGst: 0,
    totalDeliveryFee: 0,
    totalPlatformFee: 0,
    totalPaid: 0,
    totalRemaining: 0,
  })
  const [orders, setOrders] = useState([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  })

  // Loading States
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  // Fetch restaurants (Including banned and inactive restaurants)
  useEffect(() => {
    async function fetchRestaurantsList() {
      try {
        const response = await adminAPI.getRestaurants({ limit: 1000 })
        if (response.data?.success) {
          const list = response.data.data?.restaurants || response.data.data || []
          setRestaurants(Array.isArray(list) ? list : [])
        }
      } catch (err) {
        toast.error("Failed to load restaurants list")
      }
    }
    fetchRestaurantsList()
  }, [])

  // Build query params
  const getQueryParams = useCallback(() => {
    const params = {}
    if (selectedRestaurant) params.restaurantId = selectedRestaurant
    if (statusFilter && statusFilter !== "All") params.status = statusFilter.toLowerCase()
    if (fromDate) params.fromDate = fromDate
    if (toDate) params.toDate = toDate
    return params
  }, [selectedRestaurant, statusFilter, fromDate, toDate])

  // Fetch Summary Cards Data
  const fetchSummary = useCallback(async () => {
    try {
      setLoadingSummary(true)
      const params = getQueryParams()
      const response = await adminAPI.getPayoutSummary(params)
      if (response.data?.success) {
        setSummary(response.data.data)
      }
    } catch (err) {
      toast.error("Failed to load summary statistics")
    } finally {
      setLoadingSummary(false)
    }
  }, [getQueryParams])

  // Fetch Paginated Orders Data
  const fetchOrders = useCallback(async (pageToFetch = 1) => {
    try {
      setLoadingOrders(true)
      const params = {
        ...getQueryParams(),
        page: pageToFetch,
        limit: pagination.limit,
      }
      const response = await adminAPI.getPayoutOrders(params)
      if (response.data?.success) {
        setOrders(response.data.data?.data || [])
        setPagination(prev => ({
          ...prev,
          ...(response.data.data?.pagination || {}),
          page: pageToFetch,
        }))
      }
    } catch (err) {
      toast.error("Failed to load payout orders")
    } finally {
      setLoadingOrders(false)
    }
  }, [getQueryParams, pagination.limit])

  // Trigger data reload on filter updates
  useEffect(() => {
    fetchSummary()
    fetchOrders(1)
  }, [selectedRestaurant, statusFilter, fromDate, toDate])

  // Page change handler
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchOrders(newPage)
    }
  }

  // Handle PDF Export
  const handleDownloadPDF = async () => {
    try {
      setDownloadingPdf(true)
      const params = getQueryParams()
      const response = await adminAPI.getPayoutPdfData(params)
      if (response.data?.success) {
        generatePayoutPDF(response.data.data)
        toast.success("Payout statement PDF generated")
      } else {
        toast.error(response.data?.message || "Failed to generate PDF data")
      }
    } catch (err) {
      toast.error("Error exporting PDF statement")
    } finally {
      setDownloadingPdf(false)
    }
  }

  const formatCurrency = (val) => {
    const num = Number(val) || 0
    return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A"
    try {
      return new Date(dateStr).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 rounded-xl">
              <DollarSign className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Restaurant Payouts</h1>
              <p className="text-xs text-slate-500 mt-0.5">Manage financial earnings, fees, and payout settlements</p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleDownloadPDF}
              disabled={downloadingPdf}
              className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {downloadingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              ) : (
                <Download className="w-4 h-4 text-blue-600" />
              )}
              <span>Download PDF</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Restaurant Selector (Shows All including Banned) */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Restaurant
              </label>
              <div className="relative">
                <select
                  value={selectedRestaurant}
                  onChange={(e) => setSelectedRestaurant(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="">All Restaurants (Including Banned)</option>
                  {restaurants.map((r) => {
                    const isBanned = Boolean(r.isBanned || r.status === "banned");
                    const isInactive = r.isActive === false;
                    const tag = isBanned ? " [Banned]" : isInactive ? " [Inactive]" : "";
                    return (
                      <option key={r._id} value={r._id}>
                        {r.restaurantName || r.name}{tag}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="All">All Statuses</option>
                <option value="Delivered">Delivered</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            {/* From Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            {/* To Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

          </div>
        </div>

        {/* 5 Financial Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          
          {/* Card 1: Total Revenue */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Revenue</span>
              <DollarSign className="w-4 h-4 text-slate-400" />
            </div>
            {loadingSummary ? (
              <Loader2 className="w-5 h-5 animate-spin text-blue-600 my-1" />
            ) : (
              <div className="text-xl font-bold text-slate-900">{formatCurrency(summary.totalRevenue)}</div>
            )}
            <p className="text-[11px] text-slate-500 mt-1">Gross paid by customers</p>
          </div>

          {/* Card 2: Total Payout */}
          <div className="bg-white rounded-xl shadow-sm border border-emerald-200 bg-emerald-50/20 p-5">
            <div className="flex items-center justify-between text-emerald-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Payout</span>
              <CreditCard className="w-4 h-4 text-emerald-600" />
            </div>
            {loadingSummary ? (
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600 my-1" />
            ) : (
              <div className="text-xl font-bold text-emerald-700">{formatCurrency(summary.totalPayout)}</div>
            )}
            <p className="text-[11px] text-emerald-600/80 mt-1">Net restaurant earnings</p>
          </div>

          {/* Card 3: Commission Earned */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Commission</span>
              <Building className="w-4 h-4 text-slate-400" />
            </div>
            {loadingSummary ? (
              <Loader2 className="w-5 h-5 animate-spin text-blue-600 my-1" />
            ) : (
              <div className="text-xl font-bold text-blue-600">{formatCurrency(summary.totalCommission)}</div>
            )}
            <p className="text-[11px] text-slate-500 mt-1">Platform commission share</p>
          </div>

          {/* Card 4: Other Charges */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Other Charges</span>
              <FileText className="w-4 h-4 text-slate-400" />
            </div>
            {loadingSummary ? (
              <Loader2 className="w-5 h-5 animate-spin text-blue-600 my-1" />
            ) : (
              <div className="text-xl font-bold text-slate-900">
                {formatCurrency(summary.totalGst + summary.totalDeliveryFee + summary.totalPlatformFee)}
              </div>
            )}
            <p className="text-[11px] text-slate-500 mt-1">
              GST: {formatCurrency(summary.totalGst)}
            </p>
          </div>

          {/* Card 5: Paid vs Remaining */}
          <div className="bg-white rounded-xl shadow-sm border border-purple-200 bg-purple-50/20 p-5">
            <div className="flex items-center justify-between text-purple-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Paid vs Remaining</span>
              <CheckCircle className="w-4 h-4 text-purple-600" />
            </div>
            {loadingSummary ? (
              <Loader2 className="w-5 h-5 animate-spin text-purple-600 my-1" />
            ) : (
              <div>
                <div className="text-lg font-bold text-purple-900">
                  Paid: <span className="text-emerald-600">{formatCurrency(summary.totalPaid)}</span>
                </div>
                <div className="text-xs font-semibold text-purple-700 mt-0.5">
                  Remaining: <span className="text-rose-600">{formatCurrency(summary.totalRemaining)}</span>
                </div>
              </div>
            )}
            <p className="text-[11px] text-purple-600/80 mt-1">Settled vs Balance owed</p>
          </div>

        </div>

        {/* Orders Table Container */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">Delivered Orders Payout Table</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                {pagination.total} Orders
              </span>
            </div>
          </div>

          {/* Table */}
          {loadingOrders ? (
            <div className="py-20 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
              <p className="text-slate-600 text-sm">Loading payout orders...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">Sr No</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">Order ID</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">Restaurant</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">Item Name</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-bold text-slate-700 uppercase tracking-wider">Item Amount</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-bold text-slate-700 uppercase tracking-wider">Commission</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-bold text-slate-700 uppercase tracking-wider">GST</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-bold text-slate-700 uppercase tracking-wider">Delivery Fee</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-bold text-slate-700 uppercase tracking-wider">Platform Fee</th>
                    <th className="px-4 py-3.5 text-right text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Payout Amount</th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold text-slate-700 uppercase tracking-wider">Delivered Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-sm">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <FileText className="w-12 h-12 text-slate-300 mb-3" />
                          <p className="text-base font-semibold text-slate-700">No Orders Found</p>
                          <p className="text-xs text-slate-500 mt-1">No delivered orders match your selected filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.orderId} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3.5 text-slate-600 font-medium">{o.srNo}</td>
                        <td className="px-4 py-3.5 text-slate-900 font-semibold">{o.orderId}</td>
                        <td className="px-4 py-3.5 text-slate-800">
                          <span>{o.restaurantName}</span>
                          {o.isBanned && (
                            <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-700 rounded">
                              Banned
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-slate-700 max-w-[200px] truncate" title={o.itemName}>
                          {o.itemName}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium text-slate-800">{formatCurrency(o.itemAmount)}</td>
                        <td className="px-4 py-3.5 text-right font-medium text-blue-600">-{formatCurrency(o.commission)}</td>
                        <td className="px-4 py-3.5 text-right text-slate-600">{formatCurrency(o.gst)}</td>
                        <td className="px-4 py-3.5 text-right text-slate-600">{formatCurrency(o.deliveryFee)}</td>
                        <td className="px-4 py-3.5 text-right text-slate-600">{formatCurrency(o.platformFee)}</td>
                        <td className="px-4 py-3.5 text-right font-bold text-emerald-700">{formatCurrency(o.payoutAmount)}</td>
                        <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap">{formatDate(o.dateTime)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {!loadingOrders && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 pt-4 mt-4">
              <div className="text-xs text-slate-500">
                Showing page <span className="font-semibold text-slate-800">{pagination.page}</span> of{" "}
                <span className="font-semibold text-slate-800">{pagination.totalPages}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  )
}

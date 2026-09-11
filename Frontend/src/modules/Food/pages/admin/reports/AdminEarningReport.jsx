import React, { useState, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { adminAPI } from "@food/api"
import { ArrowLeft, Loader2, DollarSign, ChevronDown, ChevronUp } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"

export default function AdminEarningReport() {
  const location = useLocation()
  const navigate = useNavigate()
  
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedCards, setExpandedCards] = useState({})

  const toggleExpand = (id) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const filters = location.state?.filters || { time: "All Time", zone: "All Zones", restaurant: "All restaurants" }
  const searchQuery = location.state?.searchQuery || ""

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true)
        
        let fromDate = null
        let toDate = null
        const now = new Date()
        
        if (filters.time === "Today") {
          fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
        } else if (filters.time === "This Week") {
          const dayOfWeek = now.getDay()
          const diff = now.getDate() - dayOfWeek
          fromDate = new Date(now.getFullYear(), now.getMonth(), diff)
          toDate = new Date(now.getFullYear(), now.getMonth(), diff + 6, 23, 59, 59)
        } else if (filters.time === "This Month") {
          fromDate = new Date(now.getFullYear(), now.getMonth(), 1)
          toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        }

        const params = {
          search: searchQuery || undefined,
          zone: filters.zone !== "All Zones" ? filters.zone : undefined,
          restaurant: filters.restaurant !== "All restaurants" ? filters.restaurant : undefined,
          fromDate: fromDate ? fromDate.toISOString() : undefined,
          toDate: toDate ? toDate.toISOString() : undefined,
          limit: 1000
        }

        const response = await adminAPI.getTransactionReport(params)

        if (response?.data?.success && response.data.data) {
          // Filter to only successful transactions (delivered, captured, settled) to show earnings
          const validTx = response.data.data.transactions.filter(t => 
            ['delivered', 'captured', 'settled'].includes(String(t.status).toLowerCase())
          )
          setTransactions(validTx || [])
        } else {
          setTransactions([])
          if (response?.data?.message) {
            toast.error(response.data.message)
          }
        }
      } catch (error) {
        console.error("Error fetching earning report:", error)
        toast.error("Failed to fetch earning report")
      } finally {
        setLoading(false)
      }
    }

    fetchReport()
  }, [])

  const formatMoney = (amount) => {
    return `\u20B9${Number(amount || 0).toFixed(2)}`
  }

  const formatDiscount = (amount) => {
    return `-\u20B9${Number(amount || 0).toFixed(2)}`
  }

  if (loading) {
    return (
      <div className="p-2 lg:p-3 bg-slate-50 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading admin earning details...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-green-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Admin Earning Breakdown</h1>
            </div>
          </div>
          <div className="text-sm font-medium text-slate-500">
            {transactions.length} Transactions Found
          </div>
        </div>

        {/* Content Grid */}
        {transactions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center flex flex-col items-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <DollarSign className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">No Earnings Found</h3>
            <p className="text-slate-500">No successful transactions matched the selected filters.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="px-6 py-4">Order ID</th>
                    <th className="px-6 py-4">Restaurant</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Customer Paid</th>
                    <th className="px-6 py-4 text-right">Admin Earning</th>
                    <th className="px-6 py-4 text-right">Restaurant Payout</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {transactions.map((tx) => {
                    const breakdown = tx.adminEarningBreakdown || {}
                    const rawItems = Array.isArray(tx.items) ? tx.items : []
                    let calculatedOriginal = 0
                    let calculatedDiscount = 0
                    rawItems.forEach((it) => {
                      const price = Number(it.price || 0)
                      const orig = it.originalPrice != null && Number(it.originalPrice) > price ? Number(it.originalPrice) : price
                      const qty = Number(it.quantity || 1)
                      calculatedOriginal += orig * qty
                      if (orig > price) {
                        calculatedDiscount += (orig - price) * qty
                      }
                    })

                    const itemSubtotal = Number(tx.itemSubtotalAfterDiscount ?? tx.totalItemAmount ?? 0)
                    let discount = Number(
                      (tx.restaurantDiscount != null && Number(tx.restaurantDiscount) > 0 ? tx.restaurantDiscount : null) ??
                      (calculatedDiscount > 0 ? calculatedDiscount : (tx.itemDiscount || 0))
                    )
                    let originalItemCost = Number(
                      (tx.originalItemCost != null && Number(tx.originalItemCost) > 0 ? tx.originalItemCost : null) ??
                      (breakdown.originalItemCost != null && Number(breakdown.originalItemCost) > 0 ? breakdown.originalItemCost : null) ??
                      (calculatedOriginal > itemSubtotal ? calculatedOriginal : (itemSubtotal + discount))
                    )

                    if (calculatedOriginal > 0 && calculatedOriginal > originalItemCost) {
                      originalItemCost = calculatedOriginal
                    }
                    if (calculatedDiscount > 0 && calculatedDiscount > discount) {
                      discount = calculatedDiscount
                    }
                    if (discount > 0 && originalItemCost <= itemSubtotal) {
                      originalItemCost = itemSubtotal + discount
                    } else if (originalItemCost > itemSubtotal && discount <= 0) {
                      discount = originalItemCost - itemSubtotal
                    }
                    const taxes = breakdown.gstCollectedFromUser || tx.vatTax || 0
                    const platformFee = breakdown.platformFee || tx.platformFee || 0
                    const packagingFee = breakdown.packagingFee || 0
                    const deliveryFeeUser = tx.deliveryCharge || (breakdown.deliveryProfit || 0) + (breakdown.deliveryCostToAdmin || 0) + (breakdown.deliveryGstToAdmin || 0)
                    
                    const totalAdmin = 
                      (deliveryFeeUser || 0) -
                      (breakdown.deliveryCostToAdmin || 0) -
                      (breakdown.deliveryGstToAdmin || 0) +
                      (breakdown.platformFee || 0) + 
                      (breakdown.restaurantCommission || 0) + 
                      (breakdown.gstOnItem || 0) +
                      (breakdown.gstOnCommission || 0) +
                      (breakdown.paymentGatewayFee || 0) + 
                      (breakdown.tcs || 0) +
                      (breakdown.gstCollectedFromUser || 0) +
                      (breakdown.packagingFee || 0)

                    const restaurantCommission = Number(breakdown.restaurantCommission) || 0
                    const gstOnItem = Number(breakdown.gstOnItem) || 0
                    const gstOnCommission = Number(breakdown.gstOnCommission) || 0
                    const paymentGatewayFee = Number(breakdown.paymentGatewayFee) || 0
                    const tcs = Number(breakdown.tcs) || 0
                    
                    const totalDeductions = restaurantCommission + gstOnItem + gstOnCommission + paymentGatewayFee + tcs
                    const restaurantGets = Math.max(0, itemSubtotal + packagingFee - totalDeductions)
                    const isExpanded = !!expandedCards[tx.id]

                    return (
                      <React.Fragment key={tx.id}>
                        <tr className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-900">#{tx.orderId}</td>
                          <td className="px-6 py-4 text-slate-600 font-medium">{tx.restaurant}</td>
                          <td className="px-6 py-4">
                            <span className="px-2.5 py-1 bg-green-100 text-green-700 text-[10px] font-bold uppercase rounded-full tracking-wide">
                              {tx.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-semibold text-slate-900">{formatMoney(tx.orderAmount)}</td>
                          <td className="px-6 py-4 text-right font-bold text-emerald-600">{formatMoney(breakdown.totalAdminReceivable || totalAdmin)}</td>
                          <td className="px-6 py-4 text-right font-bold text-blue-600">{formatMoney(restaurantGets)}</td>
                          <td className="px-6 py-4 text-center">
                            <button 
                              onClick={() => toggleExpand(tx.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 hover:text-blue-600 transition-colors"
                            >
                              Details {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan="7" className="p-0 bg-slate-50/50 border-b-2 border-slate-200">
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6"
                              >
                                {/* Customer Bill */}
                                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                                  <h3 className="text-sm font-bold text-gray-900 mb-3 tracking-wide">Customer Bill</h3>
                                  <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Original item cost</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(originalItemCost)}</span>
                                    </div>
                                    {discount > 0 && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-gray-600 font-medium">Restaurant discount</span>
                                        <span className="text-[13px] text-red-600">{formatDiscount(discount)}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Item subtotal (after discount)</span>
                                      <span className="text-[13px] text-gray-900 font-semibold">{formatMoney(itemSubtotal)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Delivery fee (user)</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(deliveryFeeUser)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Platform fee</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(platformFee)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">GST (user bill)</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(taxes)}</span>
                                    </div>
                                    <div className="pt-2 mt-2 border-t border-slate-200 flex items-center justify-between">
                                      <span className="text-sm font-bold text-gray-900">Total paid by user</span>
                                      <span className="text-sm font-bold text-gray-900">{formatMoney(tx.orderAmount)}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Admin Receivable */}
                                <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-100 shadow-sm">
                                  <h3 className="text-sm font-bold text-emerald-900 mb-3 tracking-wide">Admin Receivable</h3>
                                  <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Delivery cost to admin</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(breakdown.deliveryCostToAdmin)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Delivery GST to admin (18%)</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(breakdown.deliveryGstToAdmin)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Platform fee to admin</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(breakdown.platformFee)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Restaurant commission</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(restaurantCommission)}</span>
                                    </div>
                                    {gstOnItem > 0 && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-gray-600 font-medium">GST on item</span>
                                        <span className="text-[13px] text-gray-900">{formatMoney(gstOnItem)}</span>
                                      </div>
                                    )}
                                    {gstOnCommission > 0 && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-gray-600 font-medium">GST on commission</span>
                                        <span className="text-[13px] text-gray-900">{formatMoney(gstOnCommission)}</span>
                                      </div>
                                    )}
                                    {paymentGatewayFee > 0 && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-gray-600 font-medium">Payment gateway fee</span>
                                        <span className="text-[13px] text-gray-900">{formatMoney(paymentGatewayFee)}</span>
                                      </div>
                                    )}
                                    {tcs > 0 && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-gray-600 font-medium">TCS</span>
                                        <span className="text-[13px] text-gray-900">{formatMoney(tcs)}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">GST collected from user</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(taxes)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Recommended item charge</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(packagingFee)}</span>
                                    </div>
                                    <div className="pt-2 mt-2 border-t border-emerald-200 flex items-center justify-between">
                                      <span className="text-sm font-bold text-emerald-900">Total going to admin</span>
                                      <span className="text-sm font-bold text-emerald-900">
                                        {formatMoney(breakdown.totalAdminReceivable || totalAdmin)}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Restaurant Payout */}
                                <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100 shadow-sm">
                                  <h3 className="text-sm font-bold text-blue-900 mb-3 tracking-wide">Restaurant Payout</h3>
                                  <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Original item cost</span>
                                      <span className="text-[13px] text-gray-900">{formatMoney(originalItemCost)}</span>
                                    </div>
                                    {discount > 0 && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-gray-600 font-medium">Restaurant discount</span>
                                        <span className="text-[13px] text-red-600">{formatDiscount(discount)}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-gray-600 font-medium">Item subtotal (after discount)</span>
                                      <span className="text-[13px] text-gray-900 font-semibold">{formatMoney(itemSubtotal)}</span>
                                    </div>
                                    {packagingFee > 0 && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-gray-600 font-medium">Packaging fee</span>
                                        <span className="text-[13px] text-gray-900">{formatMoney(packagingFee)}</span>
                                      </div>
                                    )}
                                    
                                    <div className="flex items-center gap-1.5 py-1">
                                      <span className="text-[13px] text-gray-600 font-medium">GST & Fees Deducted:</span>
                                      <span className="text-[13px] text-red-600">{formatDiscount(totalDeductions)}</span>
                                    </div>

                                    <div className="pl-3 border-l-2 border-blue-100 space-y-2 mt-1 mb-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[12px] text-gray-500 font-medium">Restaurant commission</span>
                                        <span className="text-[12px] text-red-500/80">{formatDiscount(restaurantCommission)}</span>
                                      </div>
                                      {gstOnItem > 0 && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-[12px] text-gray-500 font-medium">GST on item</span>
                                          <span className="text-[12px] text-red-500/80">{formatDiscount(gstOnItem)}</span>
                                        </div>
                                      )}
                                      {gstOnCommission > 0 && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-[12px] text-gray-500 font-medium">GST on commission</span>
                                          <span className="text-[12px] text-red-500/80">{formatDiscount(gstOnCommission)}</span>
                                        </div>
                                      )}
                                      {paymentGatewayFee > 0 && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-[12px] text-gray-500 font-medium">Payment gateway fee</span>
                                          <span className="text-[12px] text-red-500/80">{formatDiscount(paymentGatewayFee)}</span>
                                        </div>
                                      )}
                                      {tcs > 0 && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-[12px] text-gray-500 font-medium">TCS</span>
                                          <span className="text-[12px] text-red-500/80">{formatDiscount(tcs)}</span>
                                        </div>
                                      )}
                                    </div>

                                    <div className="pt-2 mt-2 border-t border-blue-200 flex items-center justify-between">
                                      <span className="text-sm font-bold text-blue-900">Restaurant gets</span>
                                      <span className="text-sm font-bold text-blue-900">{formatMoney(restaurantGets)}</span>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

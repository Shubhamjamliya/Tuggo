import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

/**
 * Generates an executive, beautifully styled PDF payout statement.
 * Uses standard 'Rs.' currency prefix to ensure clean rendering.
 * Ensures responsive column widths, right-aligned amount fields, and a clean professional layout.
 */
export const generatePayoutPDF = (pdfData = {}) => {
  const doc = new jsPDF("p", "mm", "a4")
  const pageWidth = doc.internal.pageSize.getWidth()
  
  const restaurantName = pdfData.restaurant?.name || "All Restaurants (Including Banned)"
  const ownerName = pdfData.restaurant?.ownerName || "N/A"
  const ownerPhone = pdfData.restaurant?.ownerPhone || "N/A"
  const fromDate = pdfData.dateRange?.fromDate || "All Time"
  const toDate = pdfData.dateRange?.toDate || "All Time"
  
  const totalOrders = pdfData.summary?.totalOrders || 0
  const totalRevenue = pdfData.summary?.totalRevenue || 0
  const totalCommission = pdfData.summary?.totalCommission || 0
  const totalPayout = pdfData.summary?.totalPayout || 0

  const formatAmount = (num) => {
    const val = Number(num) || 0
    return `Rs. ${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // 1. TOP HEADER BANNER
  doc.setFillColor(30, 58, 138) // Deep Blue 900
  doc.rect(0, 0, pageWidth, 28, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text("RESTAURANT PAYOUT STATEMENT", 14, 18)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(224, 231, 255)
  doc.text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, pageWidth - 14, 18, { align: "right" })

  // 2. METADATA CARD (Restaurant & Filter Info)
  let currentY = 36

  doc.setFillColor(248, 250, 252) // slate-50
  doc.setDrawColor(226, 232, 240) // slate-200
  doc.roundedRect(14, currentY, pageWidth - 28, 24, 2, 2, "FD")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42) // slate-900
  doc.text(restaurantName, 18, currentY + 7)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105) // slate-600
  doc.text(`Owner: ${ownerName} (${ownerPhone})`, 18, currentY + 14)
  doc.text(`Date Filter: ${fromDate} to ${toDate}`, 18, currentY + 20)

  if (pdfData.restaurant?.bankDetails?.accountNumber) {
    const bank = pdfData.restaurant.bankDetails
    doc.text(`Account: ${bank.accountNumber} | IFSC: ${bank.ifscCode}`, pageWidth - 18, currentY + 14, { align: "right" })
  }

  currentY += 30

  // 3. FINANCIAL STAT SUMMARY CARDS (4 Columns)
  const cardWidth = (pageWidth - 28 - 9) / 4
  const cardHeight = 18

  const statCards = [
    { label: "TOTAL ORDERS", value: String(totalOrders), color: [241, 245, 249], textColor: [15, 23, 42] },
    { label: "GROSS REVENUE", value: formatAmount(totalRevenue), color: [241, 245, 249], textColor: [15, 23, 42] },
    { label: "COMMISSION", value: `-${formatAmount(totalCommission)}`, color: [254, 242, 242], textColor: [220, 38, 38] },
    { label: "NET PAYOUT", value: formatAmount(totalPayout), color: [236, 253, 245], textColor: [4, 120, 87] },
  ]

  statCards.forEach((card, idx) => {
    const x = 14 + idx * (cardWidth + 3)
    doc.setFillColor(...card.color)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, currentY, cardWidth, cardHeight, 1.5, 1.5, "FD")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(card.label, x + 4, currentY + 5)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(...card.textColor)
    doc.text(card.value, x + 4, currentY + 13)
  })

  currentY += 24

  // 4. ORDERS TABLE WITH AUTO TABLE
  const tableHeaders = [["Sr", "Order ID", "Item Details", "Item Amount", "Payout Amount", "Delivered Date"]]
  const tableRows = (pdfData.orders || []).map((o) => [
    o.srNo,
    o.orderId,
    o.itemName || "N/A",
    formatAmount(o.itemAmount),
    formatAmount(o.payoutAmount),
    o.dateTime ? new Date(o.dateTime).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }) : "N/A"
  ])

  autoTable(doc, {
    head: tableHeaders,
    body: tableRows,
    startY: currentY,
    theme: "grid",
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      halign: "center",
      cellPadding: 3
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
      cellPadding: 3
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { halign: "center", cellWidth: 26, fontStyle: "bold" },
      2: { halign: "left", cellWidth: "auto" },
      3: { halign: "right", cellWidth: 32 },
      4: { halign: "right", cellWidth: 32, fontStyle: "bold", textColor: [4, 120, 87] },
      5: { halign: "center", cellWidth: 28 }
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    margin: { left: 14, right: 14 }
  })

  // 5. TOTAL PAYOUT FOOTER CALLOUT BOX
  const finalY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 8 : currentY + 30
  
  doc.setFillColor(6, 78, 59) // Emerald 900
  doc.roundedRect(14, finalY, pageWidth - 28, 14, 2, 2, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text("TOTAL RESTAURANT PAYOUT AMOUNT:", 20, finalY + 9)
  doc.text(formatAmount(totalPayout), pageWidth - 20, finalY + 9, { align: "right" })

  // 6. PAGE NUMBERING FOOTER
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" })
  }

  // SAVE PDF FILE
  const cleanName = restaurantName.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  doc.save(`payout_statement_${cleanName}_${new Date().toISOString().split("T")[0]}.pdf`)
}

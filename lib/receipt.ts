/**
 * POS Receipt Generator
 * Generates thermal-printer-sized HTML receipts (58mm / 80mm width)
 * Uses expo-print for printing and expo-sharing for PDF sharing
 * Includes full EFRIS fiscal invoice sections when fiscalized
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';

export type ReceiptItem = {
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_rate?: number;
  tax_letter?: string; // A, B, C etc
};

export type ReceiptData = {
  // Business info
  businessName: string;
  businessTin?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessAddress?: string | null;
  logoUrl?: string | null;
  branchName: string;
  branchPhone?: string | null;
  branchLocation?: string | null;
  footerMessage?: string | null;

  // Sale info
  saleId: string;
  invoiceNumber?: string | null;
  date: string; // ISO date string
  sellerName: string;
  paymentMethod: string;

  // Items
  items: ReceiptItem[];

  // Totals
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;

  // EFRIS info (optional)
  isFiscalized?: boolean;
  efrisFdn?: string | null;
  efrisQrCode?: string | null;
  efrisVerificationCode?: string | null;

  // Full EFRIS response (for detailed invoice)
  efrisResponse?: any | null;

  // Customer
  customerName?: string | null;
  customerTin?: string | null;

  // Currency display
  currencySymbol?: string;

  // Partial payment info
  amountPaid?: number;
  balanceDue?: number;
};

export type StatementEntry = {
  date: string;
  type: 'sale' | 'payment';
  description: string;
  debit: number; // For sales
  credit: number; // For payments
  balance: number;
  items?: string; // e.g. "2x Soap, 1x Sugar"
};

export type StatementData = {
  businessName: string;
  businessTin?: string | null;
  businessPhone?: string | null;
  businessAddress?: string | null;
  customerName: string;
  customerPhone?: string | null;
  startDate: string;
  endDate: string;
  openingBalance: number;
  entries: StatementEntry[];
  closingBalance: number;
  currencySymbol?: string;
};

function fmt(amount: number): string {
  return Math.round(amount).toLocaleString();
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: 'numeric' })
    + '  ' + d.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
}

function paymentLabel(method: string): string {
  const map: Record<string, string> = {
    cash: 'Cash', mobile_money: 'Mobile Money', card: 'Card', credit: 'Credit',
    '101': 'Credit', '102': 'Cash', '103': 'Cheque', '104': 'Demand Draft',
    '105': 'Mobile Money',
  };
  return map[method] || method;
}

const TAX_LETTERS: Record<string, string> = {
  '01': 'A', '02': 'B', '03': 'C', '04': 'D', '05': 'E', '11': 'F',
};

const TAX_CATEGORY_LABELS: Record<string, string> = {
  '01': 'A-Standard (18%)',
  '02': 'B-Zero Rate (0%)',
  '03': 'C-Exempt',
  '04': 'D-Deemed (18%)',
  '05': 'E-Excise Duty',
  '11': 'F-Out of Scope',
};

// ─── Extract EFRIS fields with fallback chains ────────────────────
function extractEfris(resp: any) {
  if (!resp) return null;
  const fd = resp.fiscal_data || {};
  const seller = resp.seller || {};
  const buyer = resp.buyer || {};
  const summary = resp.summary || {};
  const items = resp.items || [];
  const taxDetails = resp.tax_details || [];

  return {
    // Seller
    sellerTin: seller.tin || '',
    sellerLegalName: (seller.legal_name || '').toUpperCase(),
    sellerTradeName: (seller.trade_name || seller.legal_name || '').toUpperCase(),
    sellerAddress: seller.address || '',
    sellerRef: seller.reference_number || resp.invoice_number || '',
    servedBy: seller.served_by || 'API User',

    // Fiscal / URA
    documentType: fd.document_type || 'Original',
    issuedDate: fd.issued_date || resp.fiscalized_at?.split('T')[0] || '',
    issuedTime: fd.issued_time || resp.fiscalized_at?.split('T')[1]?.split('.')[0] || '',
    deviceNumber: fd.device_number || '',
    fdn: resp.fdn || fd.fdn || fd.fiscalDocumentNumber || fd.FDN || '',
    verificationCode: resp.verification_code || fd.verification_code || fd.verificationCode || fd.code || '',
    qrCode: resp.qr_code || fd.qr_code || fd.qrCode || '',

    // Buyer
    buyerName: buyer.name || resp.customer_name || '',

    // Items (use API response items if available)
    items: items.map((it: any) => ({
      item: it.item || it.description || '',
      qty: it.qty || it.quantity || '',
      unitPrice: it.unitPrice || it.unit_price || '',
      total: parseFloat(it.total || '0'),
      discountFlag: it.discountFlag || it.discount_flag || '2',
      taxRate: it.taxRate || it.tax_rate || '0.18',
      taxLetter: TAX_LETTERS[it.taxCategoryCode || it.tax_category_code || '01'] || 'A',
    })),

    // Tax details
    taxDetails: taxDetails.map((td: any) => ({
      code: td.taxCategoryCode || td.tax_category_code || '01',
      label: td.taxRateName || TAX_CATEGORY_LABELS[td.taxCategoryCode || td.tax_category_code || '01'] || '',
      net: parseFloat(td.netAmount || td.net_amount || '0'),
      tax: parseFloat(td.taxAmount || td.tax_amount || '0'),
      gross: parseFloat(td.grossAmount || td.gross_amount || '0'),
    })),

    // Summary
    netAmount: parseFloat(summary.netAmount || summary.net_amount || resp.total_amount || '0'),
    taxAmount: parseFloat(summary.taxAmount || summary.tax_amount || resp.total_tax || '0'),
    grossAmount: parseFloat(summary.grossAmount || summary.gross_amount || '0'),
    grossInWords: summary.gross_amount_words || '',
    paymentMode: summary.payment_mode || paymentLabel(resp.payment_method || '102'),
    itemCount: summary.number_of_items || items.filter((it: any) => (it.discountFlag || it.discount_flag || '2') !== '0').length,
    remarks: resp.notes || summary.remarks || '',
    currency: resp.currency || 'UGX',
  };
}

/**
 * Generate the HTML for a thermal receipt (80mm width)
 * When fiscalized, includes all 6 EFRIS sections adapted for narrow paper
 */
export async function generateReceiptHtml(data: ReceiptData): Promise<string> {
  const cur = data.currencySymbol || 'UGX';
  const efris = data.isFiscalized ? extractEfris(data.efrisResponse) : null;

  // Generate QR code SVG if fiscal
  let qrSvg = '';
  if (efris) {
    const qrValue = efris.qrCode || (efris.verificationCode ? `https://efris.ura.go.ug/verify/${efris.verificationCode}` : '');
    if (qrValue) {
      try {
        qrSvg = await QRCode.toString(qrValue, { type: 'svg', width: 120, margin: 1 });
      } catch (e) {
        console.warn('QR generation failed:', e);
      }
    }
  }

  // ── Item rows ───────────────────────────
  // For EFRIS receipts, render product lines only (skip discount lines)
  const itemRows = efris && efris.items.length > 0
    ? efris.items
        .filter((ei: any) => ei.discountFlag !== '0')
        .map((ei: any) => `
      <tr>
        <td class="item-name">${ei.item}</td>
        <td class="qty">${ei.qty}</td>
        <td class="price">${fmt(parseFloat(ei.unitPrice || '0'))}</td>
        <td class="total">${fmt(ei.total)}</td>
        <td class="tax-col">${ei.taxLetter}</td>
      </tr>`
        ).join('')
    : data.items
        .map(
          (item) => `
      <tr>
        <td class="item-name">${item.name}</td>
        <td class="qty">${item.quantity}</td>
        <td class="price">${fmt(efris ? Math.round(item.unit_price * (1 + (item.tax_rate || 0))) : item.unit_price)}</td>
        <td class="total">${fmt(efris ? Math.round(item.line_total * (1 + (item.tax_rate || 0))) : item.line_total)}</td>
        ${efris ? `<td class="tax-col">${item.tax_letter || 'A'}</td>` : ''}
      </tr>`
        )
        .join('');

  // ── Tax breakdown rows (EFRIS only) ─────
  const taxRows = efris && efris.taxDetails.length > 0
    ? efris.taxDetails.map((td: any) => `
        <tr>
          <td>${td.label}</td>
          <td class="r">${fmt(td.net)}</td>
          <td class="r">${fmt(td.tax)}</td>
          <td class="r">${fmt(td.gross)}</td>
        </tr>`).join('')
    : '';

  // ── Customer section ────────────────────
  const customerSection =
    data.customerName || data.customerTin
      ? `<div class="customer">
          ${data.customerName ? `<span>Customer: ${data.customerName}</span>` : ''}
          ${data.customerTin ? `<span>TIN: ${data.customerTin}</span>` : ''}
        </div>`
      : '';

  // ── EFRIS Sections (only when fiscalized) ─────
  const efrisHeader = efris ? `
    <div class="efris-header">
      EFRIS e-INVOICE / TAX INVOICE
    </div>` : '';

  const sectionA = efris ? `
    <div class="section-hdr">Seller's Details</div>
    <div class="meta">
      <div class="meta-row"><span>TIN:</span><span>${efris.sellerTin}</span></div>
      <div class="meta-row"><span>Name:</span><span>${efris.sellerLegalName}</span></div>
      ${efris.sellerTradeName !== efris.sellerLegalName ? `<div class="meta-row"><span>Trade:</span><span>${efris.sellerTradeName}</span></div>` : ''}
      ${efris.sellerAddress ? `<div class="meta-row"><span>Address:</span><span class="addr">${efris.sellerAddress}</span></div>` : ''}
      <div class="meta-row"><span>Ref No:</span><span class="b">${efris.sellerRef}</span></div>
      <div class="meta-row"><span>Served by:</span><span>${efris.servedBy}</span></div>
    </div>` : '';

  const sectionB = efris ? `
    ${efris.fdn ? `<div class="fdn-row">FDN: ${efris.fdn}</div>` : ''}
    ${efris.verificationCode ? `<div class="verify-row">Verify: ${efris.verificationCode}</div>` : ''}` : '';

  const sectionC = efris && efris.buyerName ? `
    <div class="section-hdr">Buyer's Details</div>
    <div class="meta">
      <div class="meta-row"><span>Name:</span><span>${efris.buyerName}</span></div>
      ${data.customerTin ? `<div class="meta-row"><span>TIN:</span><span>${data.customerTin}</span></div>` : ''}
    </div>` : '';

  const sectionE = efris && taxRows ? `
    <div class="section-hdr">Tax Details</div>
    <table class="tax-table">
      <thead><tr>
        <th>Category</th><th class="r">Net</th><th class="r">Tax</th><th class="r">Gross</th>
      </tr></thead>
      <tbody>${taxRows}</tbody>
    </table>` : '';

  // Calculate total discount from EFRIS discount lines
  const efrisTotalDiscount = efris
    ? efris.items
        .filter((ei: any) => ei.discountFlag === '0')
        .reduce((sum: number, ei: any) => sum + Math.abs(ei.total), 0)
    : 0;

  const sectionF = efris ? `
    <div class="section-hdr">Summary</div>
    <div class="meta">
      ${efrisTotalDiscount > 0 ? `<div class="meta-row" style="color:#e94560"><span>Discount:</span><span>-${fmt(efrisTotalDiscount)}</span></div>` : ''}
      <div class="meta-row"><span>Net Amount:</span><span>${fmt(efris.netAmount)}</span></div>
      <div class="meta-row"><span>Tax Amount:</span><span>${fmt(efris.taxAmount)}</span></div>
      <div class="meta-row grand"><span>Gross Amount:</span><span>${fmt(efris.grossAmount || data.totalAmount)} ${efris.currency}</span></div>
      ${efris.grossInWords ? `<div class="words">${efris.grossInWords}</div>` : ''}
      <div class="meta-row"><span>Payment:</span><span>${efris.paymentMode}</span></div>
      <div class="meta-row"><span>Items:</span><span>${efris.itemCount || data.items.length}</span></div>
      ${efris.remarks ? `<div class="meta-row"><span>Remarks:</span><span>${efris.remarks}</span></div>` : ''}
    </div>` : '';

  const efrisFooter = efris ? `
    <div class="efris-footer">*** END OF e-INVOICE ***</div>
    ${qrSvg ? `<div class="qr-wrapper">${qrSvg}<div class="qr-label">Scan to verify on URA portal</div></div>` : ''}` : '';

  // ── NON-EFRIS simple receipt sections ──
  const address = data.branchLocation || data.businessAddress;
  const phone = data.branchPhone || data.businessPhone;
  const email = data.businessEmail;
  const tin = data.businessTin;
  const footer = data.footerMessage || 'Thank you for your purchase!';

  const simpleHeader = !efris ? `
    <div class="header">
      <div class="header-main">
        ${data.logoUrl ? `<img src="${data.logoUrl}" class="logo" />` : ''}
        <div class="biz-name">${data.businessName}</div>
      </div>
      ${tin ? `<div class="biz-info">TIN: ${tin}</div>` : ''}
      <div class="biz-info">${data.branchName}</div>
      ${address ? `<div class="biz-info">${address}</div>` : ''}
      ${phone ? `<div class="biz-info">Tel: ${phone}</div>` : ''}
      ${email ? `<div class="biz-info">${email}</div>` : ''}
      <div class="biz-info">CURRENCY: ${cur}</div>
      <div class="invoice-title">SALES INVOICE</div>
    </div>
    <div class="meta">
      <div class="meta-row"><span>Date:</span><span>${formatDate(data.date)}</span></div>
      ${data.invoiceNumber ? `<div class="meta-row"><span>Invoice:</span><span>${data.invoiceNumber}</span></div>` : ''}
      <div class="meta-row"><span>Served by:</span><span>${data.sellerName}</span></div>
    </div>
    ${customerSection}` : '';

  const simpleTotals = !efris ? `
    <div class="totals">
      <div class="total-row"><span>Subtotal</span><span>${cur} ${fmt(data.subtotal)}</span></div>
      ${data.discountAmount > 0 ? `<div class="total-row"><span>Discount</span><span>-${cur} ${fmt(data.discountAmount)}</span></div>` : ''}
      <div class="total-row"><span>Tax</span><span>${cur} ${fmt(data.taxAmount)}</span></div>
      <div class="total-row grand-total"><span>TOTAL</span><span>${cur} ${fmt(data.totalAmount)}</span></div>
      ${data.amountPaid !== undefined && data.amountPaid > 0 ? `
        <div class="total-row"><span>Amount Paid</span><span>${cur} ${fmt(data.amountPaid)}</span></div>
        <div class="total-row" style="font-weight: bold;"><span>BALANCE DUE</span><span>${cur} ${fmt(data.balanceDue || 0)}</span></div>
      ` : ''}
    </div>
    <div class="payment">Payment: ${paymentLabel(data.paymentMethod)}</div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @page { margin: 0; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    color: #000;
    width: 80mm;
    max-width: 80mm;
    margin: 0 auto;
    padding: 3mm 2mm;
    background: #fff;
  }
  .header { text-align: center; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px dashed #000; }
  .header-main { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px; }
  .logo { height: 40px; width: auto; object-fit: contain; }
  .biz-name { font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
  .biz-info { font-size: 10px; color: #000; margin-top: 2px; }
  .invoice-title { font-size: 12px; font-weight: bold; margin-top: 8px; text-decoration: underline; }
  .efris-header {
    text-align: center; font-size: 11px; font-weight: bold; letter-spacing: 0.5px;
    padding: 4px 0; margin-bottom: 2px;
    border-top: 2px solid #000; border-bottom: 2px solid #000;
  }
  .efris-footer {
    text-align: center; font-size: 10px; font-weight: bold;
    padding: 3px 0; margin: 4px 0;
    border-top: 2px solid #000; border-bottom: 2px solid #000;
  }
  .section-hdr {
    font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 2px 0; margin-top: 4px; border-bottom: 1px solid #000;
    background: #eee; padding-left: 2px;
  }
  .meta { font-size: 10px; padding: 2px 0; border-bottom: 1px dashed #000; }
  .meta-row { display: flex; justify-content: space-between; margin: 1px 0; }
  .meta-row .addr { max-width: 55%; text-align: right; font-size: 9px; }
  .meta-row.grand { font-weight: bold; font-size: 12px; padding: 2px 0; }
  .b { font-weight: bold; }
  .fdn-row { font-weight: bold; font-size: 12px; text-align: center; padding: 3px 0; letter-spacing: 0.3px; }
  .verify-row { font-family: monospace; font-size: 8px; text-align: center; word-break: break-all; padding-bottom: 2px; }
  .words { font-style: italic; font-size: 9px; color: #444; text-align: center; padding: 2px 0; }
  .customer { font-size: 10px; padding: 3px 0; border-bottom: 1px dashed #000; }
  .customer span { display: block; }
  table { width: 100%; border-collapse: collapse; margin: 3px 0; }
  thead th { font-size: 9px; text-align: left; border-bottom: 1px solid #000; padding: 2px 0; }
  thead th.qty, thead th.price, thead th.total, thead th.tax-col { text-align: right; }
  thead th.r { text-align: right; }
  tbody td { font-size: 10px; padding: 2px 0; vertical-align: top; }
  .item-name { max-width: 100px; word-wrap: break-word; }
  .qty, .price, .total, .tax-col { text-align: right; white-space: nowrap; }
  .r { text-align: right; white-space: nowrap; }
  .tax-table { margin: 2px 0; }
  .tax-table thead th { font-size: 8px; }
  .tax-table tbody td { font-size: 9px; }
  .totals { border-top: 1px dashed #000; padding: 3px 0; }
  .total-row { display: flex; justify-content: space-between; font-size: 11px; padding: 1px 0; }
  .grand-total { font-size: 13px; font-weight: bold; border-top: 1px solid #000; padding: 3px 0; margin: 2px 0; }
  .payment { font-size: 10px; text-align: center; padding: 3px 0; border-bottom: 1px dashed #000; }
  .qr-wrapper { text-align: center; padding: 8px 0; }
  .qr-wrapper svg { display: inline-block; width: 120px; height: 120px; }
  .qr-label { font-size: 8px; color: #555; margin-top: 4px; }
  .footer { text-align: center; font-size: 10px; padding: 4px 0 2px; }
  .footer-thanks { font-size: 11px; font-weight: bold; margin-bottom: 2px; }
  .footer-powered { font-size: 8px; color: #666; margin-top: 3px; }
</style>
</head>
<body>

${efris ? `
  ${efrisHeader}
  ${sectionA}
  ${sectionB}
  ${sectionC}
` : `
  ${simpleHeader}
`}

  <table>
    <thead><tr>
      <th>Item</th>
      <th class="qty">Qty</th>
      <th class="price">Price</th>
      <th class="total">Total</th>
      ${efris ? '<th class="tax-col">Tax</th>' : ''}
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>

${efris ? `
  ${sectionE}
  ${sectionF}
  ${efrisFooter}
` : `
  ${simpleTotals}
`}

  <div class="footer">
    <div class="footer-thanks">${footer}</div>
    <div class="footer-powered">Powered by YourBooks Lite</div>
  </div>

</body>
</html>`;
}

/**
 * Print receipt directly (opens system print dialog / sends to connected printer)
 */
export async function printReceipt(data: ReceiptData): Promise<void> {
  const html = await generateReceiptHtml(data);
  await Print.printAsync({ html, width: 302 }); // ~80mm at 96dpi
}

/**
 * Generate a PDF and share it (for Bluetooth printer apps, email, WhatsApp, etc.)
 */
export async function shareReceiptPdf(data: ReceiptData): Promise<void> {
  const html = await generateReceiptHtml(data);
  const { uri } = await Print.printToFileAsync({ html, width: 302 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share Receipt',
      UTI: 'com.adobe.pdf',
    });
  }
}

/**
 * Generate Statement HTML
 */
export async function generateStatementHtml(data: StatementData): Promise<string> {
  const cur = data.currencySymbol || 'UGX';
  
  const entriesHtml = data.entries.map(e => `
    <tr>
      <td style="font-size: 8px;">${e.date.split('T')[0]}</td>
      <td>
        <div style="font-weight: bold;">${e.description}</div>
        ${e.items ? `<div style="font-size: 8px; color: #555;">${e.items}</div>` : ''}
      </td>
      <td class="r">${e.debit > 0 ? fmt(e.debit) : '-'}</td>
      <td class="r">${e.credit > 0 ? fmt(e.credit) : '-'}</td>
      <td class="r" style="font-weight: bold;">${fmt(e.balance)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { margin: 10mm; size: A4; }
  body { font-family: 'Helvetica', sans-serif; font-size: 10px; color: #333; line-height: 1.4; padding: 20px; }
  .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
  .title { font-size: 18px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; }
  .biz-info { font-size: 11px; }
  
  .details-box { display: flex; justify-content: space-between; margin-bottom: 20px; }
  .customer-box { width: 45%; }
  .period-box { width: 45%; text-align: right; }
  .label { font-weight: bold; color: #666; font-size: 9px; text-transform: uppercase; }
  .val { font-size: 12px; font-weight: bold; }

  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f0f0f0; padding: 8px 4px; text-align: left; border-bottom: 1px solid #000; font-size: 9px; }
  td { padding: 8px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .r { text-align: right; }
  
  .summary { margin-top: 20px; border-top: 2px solid #000; padding-top: 10px; display: flex; justify-content: flex-end; }
  .summary-row { display: flex; width: 250px; justify-content: space-between; padding: 4px 0; }
  .summary-label { font-weight: bold; }
  .summary-val { font-weight: bold; font-size: 14px; }
  
  .footer { margin-top: 40px; text-align: center; border-top: 1px dashed #ccc; padding-top: 10px; color: #888; }
</style>
</head>
<body>
  <div class="header">
    <div class="title">STATEMENT OF ACCOUNT</div>
    <div class="biz-info">
      <strong>${data.businessName}</strong><br/>
      ${data.businessTin ? `TIN: ${data.businessTin} | ` : ''}
      ${data.businessPhone ? `Tel: ${data.businessPhone} | ` : ''}
      ${data.businessAddress ? `Address: ${data.businessAddress}` : ''}
    </div>
  </div>

  <div class="details-box">
    <div class="customer-box">
      <div class="label">Bill To:</div>
      <div class="val">${data.customerName}</div>
      ${data.customerPhone ? `<div>${data.customerPhone}</div>` : ''}
    </div>
    <div class="period-box">
      <div class="label">Statement Period:</div>
      <div class="val">${data.startDate} to ${data.endDate}</div>
      <div style="margin-top: 10px;">
        <div class="label">Opening Balance:</div>
        <div class="val">${cur} ${fmt(data.openingBalance)}</div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 70px;">DATE</th>
        <th>DESCRIPTION</th>
        <th class="r" style="width: 80px;">DEBIT (+)</th>
        <th class="r" style="width: 80px;">CREDIT (-)</th>
        <th class="r" style="width: 100px;">BALANCE (${cur})</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="4" style="font-weight: bold;">OPENING BALANCE</td>
        <td class="r" style="font-weight: bold;">${fmt(data.openingBalance)}</td>
      </tr>
      ${entriesHtml}
    </tbody>
  </table>

  <div class="summary">
    <div style="width: 100%;">
      <div class="summary-row" style="margin-left: auto;">
        <span class="summary-label">Closing Balance:</span>
        <span class="summary-val">${cur} ${fmt(data.closingBalance)}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Please clear any outstanding balances as soon as possible.</p>
    <p style="font-size: 8px; margin-top: 5px;">Generated by YourBooks Lite</p>
  </div>
</body>
</html>`;
}

export async function printStatement(data: StatementData): Promise<void> {
  const html = await generateStatementHtml(data);
  await Print.printAsync({ html });
}

export async function shareStatementPdf(data: StatementData): Promise<void> {
  const html = await generateStatementHtml(data);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share Statement',
      UTI: 'com.adobe.pdf',
    });
  }
}

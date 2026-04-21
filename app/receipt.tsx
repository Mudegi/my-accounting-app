import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import {
  generateReceiptHtml,
  printReceipt,
  shareReceiptPdf,
  type ReceiptData,
  type ReceiptItem,
} from '@/lib/receipt';

const TAX_LETTERS: Record<string, string> = {
  '01': 'A', '02': 'B', '03': 'C', '04': 'D', '05': 'E', '11': 'F',
};
const TAX_CATEGORY_LABELS: Record<string, string> = {
  '01': 'A-Standard (18%)', '02': 'B-Zero Rate (0%)', '03': 'C-Exempt',
  '04': 'D-Deemed (18%)', '05': 'E-Excise Duty', '11': 'F-Out of Scope',
};
const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', mobile_money: 'Mobile Money', card: 'Card', credit: 'Credit',
  '101': 'Cash', '102': 'Credit', '103': 'Cheque', '104': 'Mobile Money', '105': 'Visa/MasterCard',
};

export default function ReceiptScreen() {
  const { saleId } = useLocalSearchParams<{ saleId: string }>();
  const { business, currentBranch, profile, fmt: fmtCurrency, currency } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [efrisData, setEfrisData] = useState<any>(null); // parsed fullEfrisResponse
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [autoPrinted, setAutoPrinted] = useState(false);

  useEffect(() => {
    if (saleId) loadSaleData();
  }, [saleId]);

  // Auto-print when receipt loads (if setting is enabled)
  useEffect(() => {
    if (receiptData && !autoPrinted) {
      AsyncStorage.getItem('auto_print').then(v => {
        if (v === 'true') {
          setAutoPrinted(true);
          handlePrint();
        }
      });
    }
  }, [receiptData]);

  const loadSaleData = async () => {
    try {
      const { data: sale, error: saleErr } = await supabase
        .from('sales')
        .select('*')
        .eq('id', saleId)
        .single();

      if (saleErr || !sale) throw saleErr || new Error('Sale not found');

      const { data: items, error: itemsErr } = await supabase
        .from('sale_items')
        .select('*, products:product_id(tax_category_code)')
        .eq('sale_id', saleId);

      if (itemsErr) throw itemsErr;

      let sellerName = profile?.full_name || 'Staff';
      if (sale.seller_id && sale.seller_id !== profile?.id) {
        const { data: seller } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', sale.seller_id)
          .single();
        if (seller) sellerName = seller.full_name;
      }

      const receiptItems: ReceiptItem[] = (items || []).map((item: any) => ({
        name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total || item.unit_price * item.quantity,
        tax_rate: item.tax_rate || 0,
        tax_letter: TAX_LETTERS[item.products?.tax_category_code || '01'] || 'A',
      }));

      // Parse EFRIS full response if available
      let efrisResp: any = null;
      if (sale.efris_response) {
        efrisResp = typeof sale.efris_response === 'string'
          ? JSON.parse(sale.efris_response)
          : sale.efris_response;
        setEfrisData(efrisResp);
      }

      // Fetch branch details for phone/location
      let branchPhone = null;
      let branchLocation = null;
      if (sale.branch_id) {
        const { data: br } = await supabase
          .from('branches')
          .select('phone, location, name')
          .eq('id', sale.branch_id)
          .single();
        if (br) {
          branchPhone = br.phone;
          branchLocation = br.location;
        }
      }

      // Fetch debt payments for upfront/partial calculations
      const { data: pmtData } = await supabase
        .from('debt_payments')
        .select('amount')
        .eq('sale_id', saleId);
      const upfrontPaid = (pmtData || []).reduce((sum, p) => sum + Number(p.amount), 0);

      const data: ReceiptData = {
        businessName: business?.name || 'Business',
        businessTin: business?.tin || null,
        businessEmail: business?.email || null,
        businessPhone: business?.phone || null,
        businessAddress: business?.address || null,
        branchName: currentBranch?.name || '',
        branchPhone: branchPhone,
        branchLocation: branchLocation,
        footerMessage: business?.receipt_footer || null,
        logoUrl: business?.logo_url || null,
        saleId: sale.id,
        invoiceNumber: sale.invoice_number || null,
        date: sale.created_at || new Date().toISOString(),
        sellerName,
        paymentMethod: sale.payment_method || 'cash',
        items: receiptItems,
        subtotal: sale.subtotal || 0,
        taxAmount: sale.tax_amount || 0,
        discountAmount: sale.discount_amount || 0,
        totalAmount: sale.total_amount || 0,
        isFiscalized: sale.is_fiscalized || false,
        efrisFdn: sale.efris_fdn || null,
        efrisQrCode: sale.efris_qr_code || null,
        efrisVerificationCode: sale.efris_verification_code || null,
        efrisResponse: efrisResp,
        customerName: sale.customer_name || null,
        customerTin: sale.customer_tin || null,
        currencySymbol: currency.symbol,
        amountPaid: sale.payment_method === 'credit' ? upfrontPaid : sale.total_amount,
        balanceDue: sale.payment_method === 'credit' ? (sale.total_amount - upfrontPaid) : 0,
      };

      setReceiptData(data);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load sale data');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!receiptData) return;
    setPrinting(true);
    try { await printReceipt(receiptData); }
    catch (error: any) { Alert.alert('Print Error', error.message || 'Failed to print'); }
    finally { setPrinting(false); }
  };

  const handleShare = async () => {
    if (!receiptData) return;
    setSharing(true);
    try { await shareReceiptPdf(receiptData); }
    catch (error: any) { Alert.alert('Share Error', error.message || 'Failed to share'); }
    finally { setSharing(false); }
  };

  const handleDone = () => router.back();
  const f = (n: number) => Math.round(n).toLocaleString();

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={s.loadingText}>Loading receipt...</Text>
      </View>
    );
  }

  if (!receiptData) {
    return (
      <View style={s.loadingContainer}>
        <FontAwesome name="exclamation-circle" size={48} color="#e94560" />
        <Text style={s.loadingText}>Receipt data not found</Text>
        <TouchableOpacity style={s.doneButton} onPress={handleDone}>
          <Text style={s.doneButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Extract EFRIS data with fallbacks
  const isFiscal = receiptData.isFiscalized;
  const ef = efrisData || {};
  const seller = ef.seller || {};
  const fd = ef.fiscal_data || {};
  const buyer = ef.buyer || {};
  const summary = ef.summary || {};
  const efrisItems = ef.items || [];
  const taxDetails = ef.tax_details || [];
  const fdn = ef.fdn || fd.fdn || fd.fiscalDocumentNumber || receiptData.efrisFdn || '';
  const verifyCode = ef.verification_code || fd.verification_code || fd.verificationCode || receiptData.efrisVerificationCode || '';
  const qrCode = ef.qr_code || fd.qr_code || fd.qrCode || receiptData.efrisQrCode || '';

  return (
    <View style={s.container}>
      <ScrollView style={s.scrollContainer} contentContainerStyle={s.scrollContent}>
        <View style={s.receiptCard}>

          {/* ── EFRIS HEADER or SIMPLE header ────────── */}
          {isFiscal ? (
            <>
              <View style={s.headerMain}>
                {receiptData.logoUrl && <Image source={{ uri: receiptData.logoUrl }} style={s.logo} resizeMode="contain" />}
                <Text style={[s.receiptBizName, { textAlign: 'left' }]}>{receiptData.businessName}</Text>
              </View>
              <View style={s.efrisHeaderBar}>
                <Text style={s.efrisHeaderText}>EFRIS e-INVOICE / TAX INVOICE</Text>
              </View>
            </>
          ) : (
            <>
              <View style={s.headerMain}>
                {receiptData.logoUrl && <Image source={{ uri: receiptData.logoUrl }} style={s.logo} resizeMode="contain" />}
                <Text style={[s.receiptBizName, { textAlign: 'left' }]}>{receiptData.businessName}</Text>
              </View>
              {receiptData.businessTin && <Text style={s.receiptMeta}>TIN: {receiptData.businessTin}</Text>}
              <Text style={s.receiptMeta}>{receiptData.branchName}</Text>
              {(receiptData.branchLocation || receiptData.businessAddress) && (
                <Text style={s.receiptMeta}>{receiptData.branchLocation || receiptData.businessAddress}</Text>
              )}
              {(receiptData.branchPhone || receiptData.businessPhone) && (
                <Text style={s.receiptMeta}>Tel: {receiptData.branchPhone || receiptData.businessPhone}</Text>
              )}
              {receiptData.businessEmail && <Text style={s.receiptMeta}>{receiptData.businessEmail}</Text>}
              <Text style={s.receiptMeta}>CURRENCY: {receiptData.currencySymbol}</Text>
              <Text style={[s.receiptBizName, { fontSize: 12, marginTop: 8, textDecorationLine: 'underline' }]}>SALES INVOICE</Text>
              <View style={s.divider} />
            </>
          )}

          {/* ── SECTION A: Seller (EFRIS) or simple meta ── */}
          {isFiscal ? (
            <>
              <Text style={s.sectionHeader}>Seller's Details</Text>
              <View style={s.sectionBody}>
                <Row label="TIN" value={seller.tin || receiptData.businessTin || ''} />
                <Row label="Name" value={(seller.legal_name || receiptData.businessName || '').toUpperCase()} />
                {seller.trade_name && seller.trade_name !== seller.legal_name && (
                  <Row label="Trade" value={seller.trade_name.toUpperCase()} />
                )}
                {seller.address ? <Row label="Address" value={seller.address} small /> : null}
                <Row label="Ref No" value={seller.reference_number || receiptData.invoiceNumber || ''} bold />
                <Row label="Served by" value={seller.served_by || receiptData.sellerName} />
              </View>
            </>
          ) : (
            <>
              <Row label="Date" value={new Date(receiptData.date).toLocaleDateString('en-UG', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + new Date(receiptData.date).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })} />
              {receiptData.invoiceNumber && <Row label="Invoice" value={receiptData.invoiceNumber} />}
              <Row label="Served by" value={receiptData.sellerName} />
              {receiptData.customerName && <Row label="Customer" value={receiptData.customerName} />}
              <View style={s.divider} />
            </>
          )}

          {/* ── FDN & Verification (EFRIS only) ── */}
          {isFiscal && fdn ? <Text style={s.fdnText}>FDN: {fdn}</Text> : null}
          {isFiscal && verifyCode ? <Text style={s.verifyText}>Verify: {verifyCode}</Text> : null}

          {/* ── SECTION C: Buyer (EFRIS only) ── */}
          {isFiscal && (buyer.name || receiptData.customerName) ? (
            <>
              <Text style={s.sectionHeader}>Buyer's Details</Text>
              <View style={s.sectionBody}>
                <Row label="Name" value={buyer.name || receiptData.customerName || 'Walk-in'} />
                {receiptData.customerTin ? <Row label="TIN" value={receiptData.customerTin} /> : null}
              </View>
            </>
          ) : null}

          {/* ── SECTION D: Goods & Services ── */}
          {isFiscal && <Text style={s.sectionHeader}>Goods & Services</Text>}
          <View style={s.itemsHeader}>
            <Text style={[s.itemHeaderText, { flex: 2 }]}>Item</Text>
            <Text style={[s.itemHeaderText, { flex: 0.4, textAlign: 'right' }]}>Qty</Text>
            <Text style={[s.itemHeaderText, { flex: 1, textAlign: 'right' }]}>Price</Text>
            <Text style={[s.itemHeaderText, { flex: 1, textAlign: 'right' }]}>Total</Text>
            {isFiscal && <Text style={[s.itemHeaderText, { flex: 0.3, textAlign: 'right' }]}>Tax</Text>}
          </View>
          {/* For EFRIS receipts: render from EFRIS response items (tax-inclusive prices), skip discount lines */}
          {isFiscal && efrisItems.length > 0 ? (
            efrisItems
              .filter((ei: any) => ei.discountFlag !== '0' && ei.discountFlag !== 0)
              .map((ei: any, i: number) => {
              const taxLetter = TAX_LETTERS[
                ei.taxCategoryCode || ei.tax_category_code ||
                (ei.taxRate === '0.18' ? '01' : ei.taxRate === '0' ? '02' : ei.taxRate === '-' ? '03' : '01')
              ] || 'A';
              return (
                <View key={i} style={s.itemRow}>
                  <Text style={[s.itemText, { flex: 2 }]} numberOfLines={2}>
                    {ei.item || ei.description || ''}
                  </Text>
                  <Text style={[s.itemText, { flex: 0.4, textAlign: 'right' }]}>
                    {ei.qty || ei.quantity || ''}
                  </Text>
                  <Text style={[s.itemText, { flex: 1, textAlign: 'right' }]}>
                    {f(parseFloat(ei.unitPrice || ei.unit_price || '0'))}
                  </Text>
                  <Text style={[s.itemText, { flex: 1, textAlign: 'right' }]}>
                    {f(parseFloat(ei.total || '0'))}
                  </Text>
                  <Text style={[s.itemText, { flex: 0.3, textAlign: 'right', color: '#7C3AED' }]}>
                    {taxLetter}
                  </Text>
                </View>
              );
            })
          ) : (
            receiptData.items.map((item, i) => (
              <View key={i} style={s.itemRow}>
                <Text style={[s.itemText, { flex: 2 }]} numberOfLines={2}>{item.name}</Text>
                <Text style={[s.itemText, { flex: 0.4, textAlign: 'right' }]}>{item.quantity}</Text>
                <Text style={[s.itemText, { flex: 1, textAlign: 'right' }]}>{f(isFiscal ? Math.round(item.unit_price * (1 + (item.tax_rate || 0))) : item.unit_price)}</Text>
                <Text style={[s.itemText, { flex: 1, textAlign: 'right' }]}>{f(isFiscal ? Math.round(item.line_total * (1 + (item.tax_rate || 0))) : item.line_total)}</Text>
                {isFiscal && <Text style={[s.itemText, { flex: 0.3, textAlign: 'right', color: '#7C3AED' }]}>{item.tax_letter || 'A'}</Text>}
              </View>
            ))
          )}
          <View style={s.divider} />

          {/* ── SECTION E: Tax Details (EFRIS only) ── */}
          {isFiscal && taxDetails.length > 0 && (
            <>
              <Text style={s.sectionHeader}>Tax Details</Text>
              <View style={s.taxTableHeader}>
                <Text style={[s.taxHeaderText, { flex: 1.5 }]}>Category</Text>
                <Text style={[s.taxHeaderText, { flex: 1, textAlign: 'right' }]}>Net</Text>
                <Text style={[s.taxHeaderText, { flex: 1, textAlign: 'right' }]}>Tax</Text>
                <Text style={[s.taxHeaderText, { flex: 1, textAlign: 'right' }]}>Gross</Text>
              </View>
              {taxDetails.map((td: any, i: number) => {
                const code = td.taxCategoryCode || td.tax_category_code || '01';
                return (
                  <View key={i} style={s.taxRow}>
                    <Text style={[s.taxText, { flex: 1.5 }]} numberOfLines={1}>
                      {TAX_CATEGORY_LABELS[code] || code}
                    </Text>
                    <Text style={[s.taxText, { flex: 1, textAlign: 'right' }]}>{f(parseFloat(td.netAmount || td.net_amount || '0'))}</Text>
                    <Text style={[s.taxText, { flex: 1, textAlign: 'right' }]}>{f(parseFloat(td.taxAmount || td.tax_amount || '0'))}</Text>
                    <Text style={[s.taxText, { flex: 1, textAlign: 'right' }]}>{f(parseFloat(td.grossAmount || td.gross_amount || '0'))}</Text>
                  </View>
                );
              })}
              <View style={s.divider} />
            </>
          )}

          {/* ── SECTION F: Summary / Totals ── */}
          {isFiscal ? (
            <>
              <Text style={s.sectionHeader}>Summary</Text>
              <View style={s.sectionBody}>
                {/* Show discount if any (sum of discount lines from EFRIS response) */}
                {(() => {
                  const totalDiscount = efrisItems
                    .filter((ei: any) => ei.discountFlag === '0' || ei.discountFlag === 0)
                    .reduce((sum: number, ei: any) => sum + Math.abs(parseFloat(ei.total || '0')), 0);
                  return totalDiscount > 0 ? (
                    <Row label={`Discount`} value={`-${f(totalDiscount)}`} />
                  ) : null;
                })()}
                <Row label="Net Amount" value={f(parseFloat(summary.netAmount || summary.net_amount || ef.total_amount || receiptData.subtotal || '0'))} />
                <Row label="Tax Amount" value={f(parseFloat(summary.taxAmount || summary.tax_amount || ef.total_tax || receiptData.taxAmount || '0'))} />
              </View>
              <View style={s.grandTotalRow}>
                <Text style={s.grandTotalLabel}>GROSS</Text>
                <Text style={s.grandTotalValue}>
                  {f(parseFloat(summary.grossAmount || summary.gross_amount || '0') || receiptData.totalAmount)} {ef.currency || fmtCurrency(0).replace(/[\d,. ]/g, '') || 'UGX'}
                </Text>
              </View>
              {summary.gross_amount_words ? (
                <Text style={s.amountWords}>{summary.gross_amount_words}</Text>
              ) : null}
              <View style={s.sectionBody}>
                <Row label="Payment" value={summary.payment_mode || PAYMENT_LABELS[ef.payment_method || receiptData.paymentMethod] || receiptData.paymentMethod} />
                <Row label="Items" value={String(summary.number_of_items || efrisItems.filter((ei: any) => ei.discountFlag !== '0' && ei.discountFlag !== 0).length || receiptData.items.length)} />
                {(ef.notes || summary.remarks) ? <Row label="Remarks" value={ef.notes || summary.remarks} /> : null}
              </View>
            </>
          ) : (
            <>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Subtotal</Text>
                <Text style={s.totalValue}>{fmtCurrency(receiptData.subtotal)}</Text>
              </View>
              {receiptData.discountAmount > 0 && (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Discount</Text>
                  <Text style={[s.totalValue, { color: '#e94560' }]}>-{fmtCurrency(receiptData.discountAmount)}</Text>
                </View>
              )}
              {business?.is_efris_enabled && (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Tax</Text>
                  <Text style={s.totalValue}>{fmtCurrency(receiptData.taxAmount)}</Text>
                </View>
              )}
              <View style={s.grandTotalRow}>
                <Text style={s.grandTotalLabel}>TOTAL</Text>
                <Text style={s.grandTotalValue}>{fmtCurrency(receiptData.totalAmount)}</Text>
              </View>
              
              {receiptData.amountPaid !== undefined && receiptData.amountPaid > 0 && receiptData.paymentMethod === 'credit' && (
                <>
                  <View style={s.totalRow}>
                    <Text style={s.totalLabel}>Amount Paid</Text>
                    <Text style={s.totalValue}>{fmtCurrency(receiptData.amountPaid)}</Text>
                  </View>
                  <View style={s.totalRow}>
                    <Text style={[s.totalLabel, { fontWeight: 'bold', color: '#000' }]}>BALANCE DUE</Text>
                    <Text style={[s.totalValue, { fontWeight: 'bold', color: '#e94560' }]}>{fmtCurrency(receiptData.balanceDue || 0)}</Text>
                  </View>
                </>
              )}

              <View style={s.paymentRow}>
                <Text style={s.paymentText}>Payment: {PAYMENT_LABELS[receiptData.paymentMethod] || receiptData.paymentMethod}</Text>
              </View>
            </>
          )}

          {/* ── EFRIS FOOTER ── */}
          {isFiscal && (
            <View style={s.efrisFooterBar}>
              <Text style={s.efrisFooterText}>*** END OF e-INVOICE ***</Text>
            </View>
          )}

          {/* ── QR Code ── */}
          {isFiscal && (qrCode || verifyCode) ? (
            <View style={s.qrContainer}>
              <QRCode
                value={qrCode || `https://efris.ura.go.ug/verify/${verifyCode}`}
                size={120}
                backgroundColor="#fff"
                color="#000"
              />
              <Text style={s.qrLabel}>Scan to verify on URA portal</Text>
            </View>
          ) : null}

          <View style={s.divider} />
          <Text style={s.thankYou}>{receiptData.footerMessage || 'Thank you for your purchase!'}</Text>
          <Text style={s.poweredBy}>Powered by YourBooks Lite</Text>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={[s.actionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity style={[s.actionButton, s.printButton]} onPress={handlePrint} disabled={printing}>
          {printing ? <ActivityIndicator size="small" color="#fff" /> : (
            <><FontAwesome name="print" size={20} color="#fff" /><Text style={s.actionButtonText}>Print</Text></>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionButton, s.shareButton]} onPress={handleShare} disabled={sharing}>
          {sharing ? <ActivityIndicator size="small" color="#fff" /> : (
            <><FontAwesome name="share-alt" size={20} color="#fff" /><Text style={s.actionButtonText}>Share</Text></>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionButton, s.doneActionButton]} onPress={handleDone}>
          <FontAwesome name="check" size={20} color="#fff" />
          <Text style={s.actionButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Helper component: Key-Value row ──
function Row({ label, value, bold, small }: { label: string; value: string; bold?: boolean; small?: boolean }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaLabel}>{label}:</Text>
      <Text style={[s.metaValue, bold && { fontWeight: 'bold' }, small && { fontSize: 9, maxWidth: '55%' }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loadingContainer: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: '#aaa', fontSize: 16 },
  scrollContainer: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 100 },

  // Receipt card (white paper)
  receiptCard: {
    backgroundColor: '#fff', borderRadius: 6, padding: 12,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
  },

  // ── EFRIS Header/Footer bars ──
  efrisHeaderBar: {
    backgroundColor: '#1a1a2e', borderRadius: 3, paddingVertical: 6, marginBottom: 6, alignItems: 'center',
  },
  efrisHeaderText: { color: '#fff', fontSize: 12, fontWeight: 'bold', letterSpacing: 0.5 },
  efrisFooterBar: {
    backgroundColor: '#1a1a2e', borderRadius: 3, paddingVertical: 5, marginTop: 8, alignItems: 'center',
  },
  efrisFooterText: { color: '#fff', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 },

  // ── Section headers ──
  sectionHeader: {
    fontSize: 9, fontWeight: 'bold', color: '#333', textTransform: 'uppercase', letterSpacing: 0.5,
    backgroundColor: '#f0f0f0', paddingHorizontal: 4, paddingVertical: 3, marginTop: 6,
    borderBottomWidth: 1, borderBottomColor: '#ccc',
  },
  sectionBody: { paddingVertical: 2 },

  // ── Meta rows ──
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
  metaLabel: { fontSize: 10, color: '#666' },
  metaValue: { fontSize: 10, color: '#222', textAlign: 'right', maxWidth: '60%' },

  // ── Simple header ──
  headerMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 4, backgroundColor: 'transparent' },
  logo: { height: 40, width: 60 },
  receiptBizName: {
    fontSize: 16, fontWeight: 'bold', textAlign: 'center', color: '#000', textTransform: 'uppercase', letterSpacing: 1,
  },
  receiptMeta: { fontSize: 10, color: '#555', textAlign: 'center', marginTop: 1 },

  // ── FDN / Verification ──
  fdnText: {
    fontSize: 13, fontWeight: 'bold', color: '#1D4ED8', textAlign: 'center', paddingVertical: 4, letterSpacing: 0.3,
  },
  verifyText: {
    fontSize: 8, fontFamily: 'monospace', color: '#555', textAlign: 'center', paddingBottom: 2,
  },

  // ── Amount in words ──
  amountWords: { fontStyle: 'italic', fontSize: 9, color: '#666', textAlign: 'center', paddingVertical: 3 },

  // ── Divider ──
  divider: { borderBottomWidth: 1, borderBottomColor: '#ccc', borderStyle: 'dashed', marginVertical: 5 },

  // ── Items table ──
  itemsHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 3, marginBottom: 2, marginTop: 4 },
  itemHeaderText: { fontSize: 9, fontWeight: 'bold', color: '#333', textTransform: 'uppercase' },
  itemRow: { flexDirection: 'row', paddingVertical: 2 },
  itemText: { fontSize: 11, color: '#222' },

  // ── Tax table ──
  taxTableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#999', paddingBottom: 2, marginTop: 2 },
  taxHeaderText: { fontSize: 8, fontWeight: 'bold', color: '#444', textTransform: 'uppercase' },
  taxRow: { flexDirection: 'row', paddingVertical: 2 },
  taxText: { fontSize: 9, color: '#333' },

  // ── Totals ──
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalLabel: { fontSize: 12, color: '#555' },
  totalValue: { fontSize: 12, color: '#222' },
  grandTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5,
    borderTopWidth: 1, borderTopColor: '#333', marginTop: 3,
  },
  grandTotalLabel: { fontSize: 15, fontWeight: 'bold', color: '#000' },
  grandTotalValue: { fontSize: 15, fontWeight: 'bold', color: '#000' },

  // ── Payment ──
  paymentRow: { alignItems: 'center', paddingVertical: 4 },
  paymentText: { fontSize: 10, color: '#555' },

  // ── QR ──
  qrContainer: { alignItems: 'center', paddingVertical: 6 },
  qrLabel: { fontSize: 8, color: '#888', marginTop: 2 },

  // ── Footer ──
  thankYou: { textAlign: 'center', fontSize: 12, fontWeight: 'bold', color: '#333', marginTop: 2 },
  poweredBy: { textAlign: 'center', fontSize: 8, color: '#999', marginTop: 3 },

  // ── Bottom buttons ──
  actionBar: {
    flexDirection: 'row', padding: 12,
    backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#0f3460', gap: 10,
  },
  actionButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12, gap: 8,
  },
  actionButtonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  printButton: { backgroundColor: '#4CAF50' },
  shareButton: { backgroundColor: '#2196F3' },
  doneActionButton: { backgroundColor: '#0f3460' },
  doneButton: { backgroundColor: '#e94560', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  doneButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

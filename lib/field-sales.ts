import { supabase } from './supabase';
import { postSaleEntry } from './accounting';

// ─── Types ───────────────────────────────────────────────────────

export type FieldStockAssignment = {
  id: string;
  business_id: string;
  branch_id: string;
  user_id: string;
  product_id: string;
  product_name?: string;
  qty_assigned: number;
  qty_returned: number;
  qty_sold?: number;
  assigned_by: string;
  assigned_by_name?: string;
  assigned_at: string;
  returned_at: string | null;
  status: 'active' | 'partially_returned' | 'returned' | 'voided';
  notes: string | null;
  branch_name?: string;
};

export type PendingFieldSale = {
  id: string;
  total_amount: number;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  payment_method: string;
  created_at: string;
  seller_id: string;
  seller_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  item_count: number;
  items: { product_name: string; quantity: number; unit_price: number; discount_amount: number; tax_rate: number; line_total: number }[];
};

// ─── Admin: Assign Stock ─────────────────────────────────────────

export async function assignStock(params: {
  businessId: string;
  branchId: string;
  userId: string;
  productId: string;
  qtyAssigned: number;
  assignedBy: string;
  notes?: string;
}) {
  // 1. Check branch inventory has enough stock
  const { data: inv } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('product_id', params.productId)
    .eq('branch_id', params.branchId)
    .single();

  if (!inv || inv.quantity < params.qtyAssigned) {
    return { error: `Insufficient stock. Available: ${inv?.quantity ?? 0}`, data: null };
  }

  // 2. Create assignment record
  const { data, error } = await supabase
    .from('field_stock_assignments')
    .insert({
      business_id: params.businessId,
      branch_id: params.branchId,
      user_id: params.userId,
      product_id: params.productId,
      qty_assigned: params.qtyAssigned,
      assigned_by: params.assignedBy,
      notes: params.notes || null,
    })
    .select()
    .single();

  if (error) return { error: error.message, data: null };

  // 3. Deduct from branch inventory
  await supabase
    .from('inventory')
    .update({ quantity: inv.quantity - params.qtyAssigned })
    .eq('product_id', params.productId)
    .eq('branch_id', params.branchId);

  // 4. Audit log
  await supabase.from('audit_log').insert({
    business_id: params.businessId,
    branch_id: params.branchId,
    user_id: params.assignedBy,
    action: 'field_stock_assigned',
    table_name: 'field_stock_assignments',
    record_id: data.id,
    new_data: {
      user_id: params.userId,
      product_id: params.productId,
      qty_assigned: params.qtyAssigned,
    },
  });

  return { error: null, data };
}

// ─── Record Stock Return ─────────────────────────────────────────

export async function returnStock(params: {
  assignmentId: string;
  qtyReturned: number;
  businessId: string;
  userId: string;
}) {
  // 1. Get current assignment
  const { data: assignment } = await supabase
    .from('field_stock_assignments')
    .select('*, products(name)')
    .eq('id', params.assignmentId)
    .single();

  if (!assignment) return { error: 'Assignment not found' };

  const totalReturned = assignment.qty_returned + params.qtyReturned;

  // Get sold qty for this assignment
  const { data: soldData } = await supabase
    .from('sales')
    .select('sale_items(quantity)')
    .eq('field_assignment_id', params.assignmentId)
    .in('status', ['completed', 'pending_approval']);

  const qtySold = (soldData || []).reduce((sum: number, sale: any) => {
    return sum + (sale.sale_items || []).reduce((s: number, i: any) => s + i.quantity, 0);
  }, 0);

  const remaining = assignment.qty_assigned - qtySold - totalReturned;

  if (remaining < 0) {
    return { error: `Cannot return ${params.qtyReturned}. Only ${assignment.qty_assigned - qtySold - assignment.qty_returned} units available to return.` };
  }

  const newStatus = remaining === 0 ? 'returned' : 'partially_returned';

  // 2. Update assignment
  const { error } = await supabase
    .from('field_stock_assignments')
    .update({
      qty_returned: totalReturned,
      status: newStatus,
      returned_at: newStatus === 'returned' ? new Date().toISOString() : null,
    })
    .eq('id', params.assignmentId);

  if (error) return { error: error.message };

  // 3. Add back to branch inventory
  const { data: inv } = await supabase
    .from('inventory')
    .select('quantity')
    .eq('product_id', assignment.product_id)
    .eq('branch_id', assignment.branch_id)
    .single();

  if (inv) {
    await supabase
      .from('inventory')
      .update({ quantity: inv.quantity + params.qtyReturned })
      .eq('product_id', assignment.product_id)
      .eq('branch_id', assignment.branch_id);
  }

  // 4. Audit log
  await supabase.from('audit_log').insert({
    business_id: params.businessId,
    user_id: params.userId,
    action: 'field_stock_returned',
    table_name: 'field_stock_assignments',
    record_id: params.assignmentId,
    new_data: { qty_returned: params.qtyReturned, new_total_returned: totalReturned },
  });

  return { error: null };
}

// ─── Get Assignments ─────────────────────────────────────────────

export async function getAssignments(params: {
  businessId: string;
  userId?: string;
  status?: string;
}) {
  let query = supabase
    .from('field_stock_assignments')
    .select(`
      *, 
      products(name),
      branches(name)
    `)
    .eq('business_id', params.businessId)
    .order('assigned_at', { ascending: false });

  if (params.userId) query = query.eq('user_id', params.userId);
  if (params.status) query = query.eq('status', params.status);

  const { data, error } = await query.limit(100);

  if (error) return { data: [], error: error.message };

  const assignments: FieldStockAssignment[] = (data || []).map((a: any) => ({
    id: a.id,
    business_id: a.business_id,
    branch_id: a.branch_id,
    user_id: a.user_id,
    product_id: a.product_id,
    product_name: a.products?.name || '?',
    qty_assigned: a.qty_assigned,
    qty_returned: a.qty_returned,
    assigned_by: a.assigned_by,
    assigned_by_name: a.assigned_by || '?',
    assigned_at: a.assigned_at,
    returned_at: a.returned_at,
    status: a.status,
    notes: a.notes,
    branch_name: a.branches?.name || '?',
  }));

  return { data: assignments, error: null };
}

// ─── Approve / Reject Field Sales ────────────────────────────────

export async function approveFieldSale(params: {
  saleId: string;
  approverId: string;
  businessId: string;
  branchId: string;
}) {
  // 1. Get the sale
  const { data: sale } = await supabase
    .from('sales')
    .select('*, sale_items(*)')
    .eq('id', params.saleId)
    .single();

  if (!sale) return { error: 'Sale not found' };
  if (sale.status !== 'pending_approval') return { error: 'Sale is not pending approval' };

  // 2. Approve it
  const { error } = await supabase
    .from('sales')
    .update({
      status: 'completed',
      approved_by: params.approverId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', params.saleId);

  if (error) return { error: error.message };

  // 3. Post accounting entry (now that it's approved)
  const costOfGoods = (sale.sale_items || []).reduce(
    (sum: number, item: any) => sum + (item.cost_price || 0) * item.quantity, 0
  );

  postSaleEntry({
    businessId: params.businessId,
    branchId: params.branchId,
    saleId: params.saleId,
    subtotal: sale.subtotal,
    taxAmount: sale.tax_amount,
    totalAmount: sale.total_amount,
    costOfGoods,
    discountAmount: sale.discount_amount || 0,
    paymentMethod: sale.payment_method,
    userId: params.approverId,
  });

  // 4. Audit log
  await supabase.from('audit_log').insert({
    business_id: params.businessId,
    user_id: params.approverId,
    action: 'field_sale_approved',
    table_name: 'sales',
    record_id: params.saleId,
    new_data: { approved_by: params.approverId },
  });

  return { error: null };
}

export async function rejectFieldSale(params: {
  saleId: string;
  approverId: string;
  businessId: string;
  reason?: string;
}) {
  // 1. Get the sale + items
  const { data: sale } = await supabase
    .from('sales')
    .select('*, sale_items(*)')
    .eq('id', params.saleId)
    .single();

  if (!sale) return { error: 'Sale not found' };
  if (sale.status !== 'pending_approval') return { error: 'Sale is not pending approval' };

  // 2. Void the sale
  const { error } = await supabase
    .from('sales')
    .update({
      status: 'voided',
      approved_by: params.approverId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', params.saleId);

  if (error) return { error: error.message };

  // 3. Restore stock to the field assignment if linked
  if (sale.field_assignment_id) {
    const { data: assignment } = await supabase
      .from('field_stock_assignments')
      .select('*')
      .eq('id', sale.field_assignment_id)
      .single();

    if (assignment) {
      // We don't need to add back to branch inventory
      // since it was deducted from the assignment, not the branch
      // The assignment tracking handles the balance
      const totalSoldItems = (sale.sale_items || []).reduce(
        (sum: number, item: any) => sum + item.quantity, 0
      );
      // Note: the qty was already "consumed" from the assignment at sale time
      // Re-marking assignment as active if it was fully consumed
      // This is handled by the reconciliation view, no direct qty change needed
    }
  }

  // 4. Audit log
  await supabase.from('audit_log').insert({
    business_id: params.businessId,
    user_id: params.approverId,
    action: 'field_sale_rejected',
    table_name: 'sales',
    record_id: params.saleId,
    new_data: { reason: params.reason },
  });

  return { error: null };
}

// ─── Get Pending Field Sales ─────────────────────────────────────

export async function getPendingFieldSales(businessId: string): Promise<PendingFieldSale[]> {
  const { data } = await supabase
    .from('sales')
    .select(`
      id, total_amount, subtotal, tax_amount, discount_amount,
      payment_method, created_at, seller_id, customer_name,
      customer_phone, gps_lat, gps_lng,
      sale_items(product_name, quantity, unit_price, discount_amount, tax_rate, line_total)
    `)
    .eq('business_id', businessId)
    .eq('is_field_sale', true)
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!data) return [];

  // Get seller names
  const sellerIds = [...new Set(data.map((s: any) => s.seller_id).filter(Boolean))];
  const sellerMap: Record<string, string> = {};
  if (sellerIds.length > 0) {
    const { data: sellers } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', sellerIds);
    sellers?.forEach((p: any) => { sellerMap[p.id] = p.full_name; });
  }

  return data.map((s: any) => ({
    id: s.id,
    total_amount: Number(s.total_amount),
    subtotal: Number(s.subtotal || 0),
    tax_amount: Number(s.tax_amount || 0),
    discount_amount: Number(s.discount_amount || 0),
    payment_method: s.payment_method,
    created_at: s.created_at,
    seller_id: s.seller_id,
    seller_name: sellerMap[s.seller_id] || '?',
    customer_name: s.customer_name,
    customer_phone: s.customer_phone,
    gps_lat: s.gps_lat ? Number(s.gps_lat) : null,
    gps_lng: s.gps_lng ? Number(s.gps_lng) : null,
    item_count: s.sale_items?.length || 0,
    items: (s.sale_items || []).map((i: any) => ({
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price: Number(i.unit_price),
      discount_amount: Number(i.discount_amount || 0),
      tax_rate: Number(i.tax_rate || 0),
      line_total: Number(i.line_total),
    })),
  }));
}

// ─── Reconciliation Data ─────────────────────────────────────────

export type ReconciliationRow = {
  product_name: string;
  product_id: string;
  qty_assigned: number;
  qty_sold_approved: number;
  qty_sold_pending: number;
  qty_returned: number;
  discrepancy: number; // assigned - sold - returned
};

export async function getReconciliation(params: {
  businessId: string;
  userId: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<ReconciliationRow[]> {
  let query = supabase
    .from('field_stock_assignments')
    .select('product_id, qty_assigned, qty_returned, products(name)')
    .eq('business_id', params.businessId)
    .eq('user_id', params.userId)
    .neq('status', 'voided');

  if (params.dateFrom) query = query.gte('assigned_at', params.dateFrom);
  if (params.dateTo) query = query.lte('assigned_at', params.dateTo);

  const { data: assignments } = await query;
  if (!assignments || assignments.length === 0) return [];

  // Aggregate by product
  const productMap: Record<string, { name: string; assigned: number; returned: number }> = {};
  for (const a of assignments as any[]) {
    const pid = a.product_id;
    if (!productMap[pid]) {
      productMap[pid] = { name: a.products?.name || '?', assigned: 0, returned: 0 };
    }
    productMap[pid].assigned += a.qty_assigned;
    productMap[pid].returned += a.qty_returned;
  }

  // Get sold quantities from approved & pending field sales
  let salesQuery = supabase
    .from('sales')
    .select('status, sale_items(product_id, quantity)')
    .eq('business_id', params.businessId)
    .eq('seller_id', params.userId)
    .eq('is_field_sale', true)
    .in('status', ['completed', 'pending_approval']);

  if (params.dateFrom) salesQuery = salesQuery.gte('created_at', params.dateFrom);
  if (params.dateTo) salesQuery = salesQuery.lte('created_at', params.dateTo);

  const { data: sales } = await salesQuery;

  const soldApproved: Record<string, number> = {};
  const soldPending: Record<string, number> = {};

  for (const sale of (sales || []) as any[]) {
    for (const item of sale.sale_items || []) {
      const pid = item.product_id;
      if (sale.status === 'completed') {
        soldApproved[pid] = (soldApproved[pid] || 0) + item.quantity;
      } else {
        soldPending[pid] = (soldPending[pid] || 0) + item.quantity;
      }
    }
  }

  // Build reconciliation rows
  return Object.entries(productMap).map(([pid, info]) => {
    const approved = soldApproved[pid] || 0;
    const pending = soldPending[pid] || 0;
    return {
      product_id: pid,
      product_name: info.name,
      qty_assigned: info.assigned,
      qty_sold_approved: approved,
      qty_sold_pending: pending,
      qty_returned: info.returned,
      discrepancy: info.assigned - approved - pending - info.returned,
    };
  });
}

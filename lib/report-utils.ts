import { type AccountBalance } from './accounting';

export interface TrendData {
  value: number;
  label: string;
}

/**
 * Aggregates sales into daily or monthly data points for trend charts.
 */
export function aggregateTrendData(sales: any[], period: string): TrendData[] {
  const map: Record<string, number> = {};
  
  sales.forEach(s => {
    const date = new Date(s.created_at);
    let key = '';
    
    if (period === 'today') {
      key = date.getHours() + ':00';
    } else if (period === 'week' || period === 'month') {
      key = date.getDate() + '/' + (date.getMonth() + 1);
    } else {
      key = date.toLocaleString('default', { month: 'short' });
    }
    
    map[key] = (map[key] || 0) + Number(s.total_amount);
  });

  return Object.entries(map).map(([label, value]) => ({ label, value }));
}

/**
 * Aggregates expenses by account category for pie charts.
 */
export function aggregateExpenseChart(trialBalance: AccountBalance[]) {
  const data = trialBalance
    .filter(a => a.account_type === 'expense' && a.balance > 0)
    .map(a => ({
      value: a.balance,
      text: a.name,
      label: a.name.slice(0, 5),
    }));
  
  return data.sort((a,b) => b.value - a.value);
}

/**
 * Prepares product data for donut charts.
 */
export function aggregateProductShare(topProducts: any[]) {
  return topProducts.map((p, idx) => ({
    value: p.revenue,
    text: p.product_name,
    color: ['#e94560', '#533483', '#4CAF50', '#FF9800', '#2196F3'][idx % 5],
  }));
}

import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ─── Types ─── */
type GuideSection = {
  id: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
  title: string;
  subtitle: string;
  screens: ScreenGuide[];
};

type ScreenGuide = {
  title: string;
  route?: string;
  description: string;
  steps: string[];
  tips?: string[];
  adminOnly?: boolean;
  proOnly?: boolean;
};

/* ─── Guide Data ─── */
const getGuideSections = (efris: boolean): GuideSection[] => [
  /* ────────── GETTING STARTED ────────── */
  {
    id: 'getting-started',
    icon: 'rocket',
    color: '#e94560',
    title: 'Getting Started',
    subtitle: 'Set up your business in minutes',
    screens: [
      {
        title: 'Sign Up & Login',
        route: '/login',
        description: 'Create your account or sign in to access your business.',
        steps: [
          'Open the app — you\'ll see the Login screen.',
          'To create a new account, tap "Create Account" and enter your full name, email, password, and business name.',
          'If you already have an account, enter your email and password, then tap "Sign In".',
          'After signing in, you\'ll be taken through the onboarding wizard.',
        ],
        tips: [
          'Use a strong password with at least 6 characters.',
          'If loading takes more than 10 seconds, check your internet connection.',
        ],
      },
      {
        title: 'Business Onboarding',
        route: '/onboarding',
        description: 'Set up your business details, currency, and subscription plan during first-time setup.',
        steps: [
          'Step 1: Enter your business name, phone number, and address.',
          'Step 2: Select your business currency (default is UGX — Ugandan Shilling).',
          'Step 3: Choose a subscription plan — Free Trial (14 days), Basic (70,000/mo), or Pro (220,000/mo).',
          'Tap "Complete Setup" to finish. You\'ll be redirected to the main app.',
        ],
        tips: [
          'You can change your business details later in Settings.',
          'The 14-day free trial gives you full access to all features.',
        ],
      },
      {
        title: 'Subscription & Billing',
        route: '/subscription',
        description: 'Manage your subscription, make payments, and view your billing history.',
        steps: [
          'Go to Settings → tap your subscription status card.',
          'View available plans and pricing.',
          'Tap "Subscribe" or "Renew" on a plan to initiate payment.',
          'Choose a payment method and confirm.',
          'View your payment history at the bottom of the screen.',
        ],
        tips: [
          efris ? 'Basic plan is ideal for small shops not required to use EFRIS.' : 'Basic plan is ideal for small shops.',
          ...(efris ? ['Pro plan includes EFRIS fiscal invoicing for URA compliance.'] : []),
          'Your free trial gives full Pro features for 14 days.',
        ],
      },
    ],
  },

  /* ────────── POINT OF SALE ────────── */
  {
    id: 'pos',
    icon: 'shopping-cart',
    color: '#4CAF50',
    title: 'Point of Sale (POS)',
    subtitle: 'Sell products, apply discounts, collect payments',
    screens: [
      {
        title: 'Making a Sale',
        route: '/(tabs)',
        description: 'The Sell tab is your main POS screen. Add products to cart, apply discounts, choose payment method, and complete the sale.',
        steps: [
          'Go to the "Sell" tab (shopping cart icon).',
          'Tap the search icon to browse or search products by name.',
          'Alternatively, tap the camera icon to scan a barcode.',
          'Tap a product to add it to your cart. Use + / − buttons to adjust quantity.',
          'To apply a per-item discount, tap the tag icon on a cart item and enter an amount or percentage.',
          'To edit the selling price, tap the pencil icon on a cart item.',
          'Select the tax option for each item (No Tax, 18% VAT, Zero Rated, Exempt).',
          'When your cart is ready, tap "Charge" at the bottom.',
          'Choose a payment method: Cash, Mobile Money, Card, Bank, or Credit.',
          'Optionally select a customer for the invoice.',
          'If paying by Cash, enter the amount tendered to calculate change.',
          'Tap "Complete Sale" to finish. A receipt is generated automatically.',
        ],
        tips: [
          'Use "Clear Cart" (trash icon) to start a fresh sale.',
          'Credit sales automatically create a debt entry for the customer.',
          ...(efris ? [
            'If EFRIS is enabled (Pro plan), the sale is automatically fiscalized with URA.',
            'The receipt includes a QR code for EFRIS verification if fiscalized.',
          ] : []),
          'You can share or print the receipt from the Receipt screen.',
        ],
      },
      {
        title: 'Receipts',
        route: '/receipt',
        description: efris
          ? 'View, print, or share fiscalized receipts with QR codes and URA-compliant tax breakdowns.'
          : 'View, print, or share receipts with tax breakdowns.',
        steps: [
          'After completing a sale, the receipt screen opens automatically.',
          efris
            ? 'The receipt shows: business name, invoice number, items, subtotal, tax breakdown by category (A–F), total, and EFRIS FDN.'
            : 'The receipt shows: business name, invoice number, items, subtotal, tax breakdown, and total.',
          'Tap "Share" to send the receipt as a PDF.',
          'Tap "Print" to print the receipt (requires a connected printer).',
          'Tap "Done" to return to the Sell screen.',
        ],
        tips: [
          'Receipts are accessible later from Sales History → Sale Detail → View Receipt.',
          ...(efris ? ['The QR code on the receipt links to URA\'s EFRIS verification portal.'] : []),
        ],
      },
    ],
  },

  /* ────────── INVENTORY ────────── */
  {
    id: 'inventory',
    icon: 'cube',
    color: '#2196F3',
    title: 'Inventory Management',
    subtitle: 'Track stock, products, purchases, and transfers',
    screens: [
      {
        title: 'Viewing Inventory',
        route: '/(tabs)/inventory',
        description: 'The Inventory tab shows all products at your current branch with stock levels, prices, and filter options.',
        steps: [
          'Go to the "Inventory" tab (cube icon).',
          'Browse your product list sorted by quantity (lowest first).',
          'Use the search bar to find products by name or barcode.',
          'Tap filter buttons: "All", "Low Stock" (below reorder level), or "Out of Stock" (zero).',
          'Each product card shows: name, stock quantity, selling price, and avg cost price.',
          'Tap any product card to edit its details.',
        ],
        tips: [
          'Products highlighted in red or orange are below their reorder level.',
          'The "+" button at top-right lets you add a new product.',
          'Pull down to refresh the inventory list.',
        ],
      },
      {
        title: 'Adding / Editing Products',
        route: '/product/new',
        description: efris
          ? 'Create or modify products with name, barcode, selling price, unit, tax category, and EFRIS registration.'
          : 'Create or modify products with name, barcode, selling price, unit, and tax category.',
        steps: [
          'From Inventory, tap "+" to add a new product, or tap an existing product to edit.',
          'Enter product name (required), barcode, SKU, and description.',
          'Set the selling price and select the measurement unit (pieces, kg, litres, etc.).',
          ...(efris ? [
            'Choose the EFRIS tax category: Standard (18%), Zero Rated, Exempt, or Excise Duty.',
            'Set the EFRIS unit mapping for fiscal compliance.',
          ] : [
            'Choose the tax category: Standard (18%), Zero Rated, Exempt, or Excise Duty.',
          ]),
          'Optionally upload a product image.',
          'Tap "Save" to create or update the product.',
          ...(efris ? ['For EFRIS-enabled businesses, tap "Register with EFRIS" to sync the product with URA.'] : []),
        ],
        tips: [
          'Scanning a barcode auto-fills the barcode field.',
          ...(efris ? ['Products must be registered with EFRIS before they can appear on fiscalized invoices.'] : []),
          'The avg cost price is automatically calculated using AVCO (Average Cost) method when you make purchases.',
        ],
      },
      {
        title: 'Stock Purchases (Stock-In)',
        route: '/purchases',
        description: 'Record new stock purchases from suppliers. Increases inventory and creates accounting entries.',
        steps: [
          'From Dashboard, tap "Purchases" quick action, or navigate to Purchases screen.',
          efris ? 'Select a supplier from the dropdown, or enter a supplier TIN.' : 'Select a supplier from the dropdown.',
          'Tap "Add Item" to select products and enter quantity + cost price per unit.',
          'Choose the payment method (Cash, Mobile Money, Bank, Card).',
          'Tap "Submit Purchase" to save.',
          'Inventory quantities are automatically increased.',
          ...(efris ? ['If EFRIS is enabled, the purchase is submitted as a "Stock Increase" to URA.'] : []),
          'A double-entry accounting journal entry is automatically posted.',
        ],
        tips: [
          'Always record purchases to keep your inventory accurate.',
          'The cost price you enter here is used to calculate your avg cost (AVCO) and COGS.',
          'Add suppliers first in the Suppliers screen for easy selection.',
        ],
      },
      {
        title: 'Stock Transfers',
        route: '/transfers',
        description: 'Transfer stock between your branches. Useful for multi-branch businesses to balance inventory.',
        steps: [
          'From Dashboard, navigate to Stock Transfers.',
          'Select the destination branch from the dropdown.',
          'Choose products and enter the quantity to transfer.',
          'Add optional notes explaining the transfer reason.',
          'Tap "Submit Transfer" to execute.',
          'Source branch stock decreases, destination branch stock increases.',
        ],
        tips: [
          'Only admins and branch managers can initiate transfers.',
          'Transfers are tracked with status: pending or completed.',
          'Check both branches\' inventory after transfer to verify quantities.',
        ],
        adminOnly: true,
      },
      {
        title: 'Low Stock Alerts',
        route: '/low-stock',
        description: 'Monitor products that have fallen below their reorder levels so you know what to restock.',
        steps: [
          'From Dashboard, tap "Low Stock" quick action.',
          'View all products below their reorder level.',
          'Use filters: "Critical" (zero stock), "Low" (above 0 but below reorder), or "All".',
          'Search by product name or barcode.',
          'For admins: see low stock across all branches.',
        ],
        tips: [
          'Set reorder levels when adding products to get meaningful alerts.',
          'Check this screen daily before placing purchase orders.',
          'The dashboard card shows the total low stock count at a glance.',
        ],
      },
    ],
  },

  /* ────────── FINANCIAL MANAGEMENT ────────── */
  {
    id: 'finance',
    icon: 'money',
    color: '#FF9800',
    title: 'Financial Management',
    subtitle: 'Expenses, debts, cash register, and accounting',
    screens: [
      {
        title: 'Recording Expenses',
        route: '/expenses',
        description: 'Track business expenses like rent, electricity, salaries, and transport with automatic accounting entries.',
        steps: [
          'From Dashboard, tap "Expenses" quick action.',
          'Tap "Add Expense" and fill in: category, description, amount, date, and payment method.',
          'Choose from 10 categories: Rent, Electricity, Water, Internet, Transport, Salaries, Office Supplies, Marketing, Repairs, or Other.',
          'Tap "Save" — the expense is recorded and a journal entry is auto-posted.',
          'View your monthly expense total at the top of the screen.',
        ],
        tips: [
          'Expenses reduce your net profit in reports.',
          'Admins can view expenses across all branches.',
          'Use the "Other" category for miscellaneous costs, and add a clear description.',
        ],
      },
      {
        title: 'Customer Debts (Credit Sales)',
        route: '/debts',
        description: 'Track customers who owe you money from credit sales. Record payments and manage outstanding balances.',
        steps: [
          'From Dashboard, tap "Debts" quick action.',
          'View all customers with outstanding credit balances.',
          'Each customer card shows: total debt, amount paid, and remaining balance.',
          'Tap a customer to see their individual credit sales.',
          'Tap "Record Payment" to log a partial or full payment.',
          'Enter the payment amount and select the payment method.',
          'The accounting journal is updated automatically.',
        ],
        tips: [
          'Credit sales are created automatically when you complete a sale with "Credit" payment method.',
          'You can set a customer at sale time so debts are linked to the right person.',
          'Partial payments are supported — pay in installments.',
        ],
      },
      {
        title: 'Cash Register / End of Day',
        route: '/cash-register',
        description: 'Open and close daily cash register sessions. Track expected vs actual cash to identify discrepancies.',
        steps: [
          'From Dashboard, tap "Cash Register" quick action.',
          'If no session is open, tap "Open Register" and enter your opening cash balance.',
          'Sell throughout the day — the register automatically tracks cash, mobile money, and card totals.',
          'At end of day, tap "Close Register".',
          'Enter your actual closing cash balance.',
          'The system calculates the expected balance and shows any variance (over/short).',
          'View past session history with totals and transaction counts.',
        ],
        tips: [
          'Open the register at the start of each shift or day.',
          'The expected balance = Opening + Cash Sales − Cash Expenses.',
          'A small variance is normal; large variances should be investigated.',
          'Session history helps identify patterns in cash discrepancies.',
        ],
      },
      {
        title: 'Credit Notes / Returns',
        route: '/credit-note',
        description: efris
          ? 'Process customer returns by issuing credit notes against original fiscalized sales.'
          : 'Process customer returns by issuing credit notes against original sales.',
        steps: [
          'From Dashboard or Settings, navigate to "Credit Notes".',
          'Search for the original sale by invoice number or browse recent sales.',
          'Select the sale you want to issue a credit note against.',
          'Choose the items and quantities being returned.',
          'Select a return reason code (e.g., defective goods, wrong item, etc.).',
          'Tap "Submit Credit Note".',
          ...(efris ? ['If EFRIS is enabled, the credit note is submitted to URA.'] : []),
          'Accounting entries are automatically reversed (including VAT).',
        ],
        tips: [
          efris
            ? 'Credit notes can only be issued against completed, fiscalized sales.'
            : 'Credit notes can only be issued against completed sales.',
          'The VAT on returned items is automatically reversed in your VAT books.',
          'Returned inventory is added back to stock.',
        ],
        proOnly: true,
      },
    ],
  },

  /* ────────── REPORTING & ANALYTICS ────────── */
  {
    id: 'reports',
    icon: 'bar-chart',
    color: '#9C27B0',
    title: 'Reports & Analytics',
    subtitle: 'Sales reports, P&L, balance sheet, and dashboards',
    screens: [
      {
        title: 'Dashboard',
        route: '/(tabs)/two',
        description: 'Your business command center. See today\'s sales, profit, low stock count, and quick navigation to all features.',
        steps: [
          'The Dashboard is the "Dashboard" tab (bar chart icon).',
          'Top summary cards show: today\'s sales total, transaction count, low stock count, and total products.',
          'Admins see a per-branch performance breakdown with revenue, cost, gross profit, expenses, and net profit.',
          'The Quick Actions grid provides one-tap access to all app features.',
          'Recent Sales feed shows the latest transactions with amounts and status.',
          'Use the period filter (Today / Week / Month / 3mo / 6mo) to change the time range.',
        ],
        tips: [
          'Pull down to refresh all dashboard data.',
          'Admin users see cross-branch data; staff see their own branch only.',
          'The low stock card is a quick way to know if you need to restock.',
        ],
      },
      {
        title: 'Financial Reports',
        route: '/reports',
        description: 'Full financial reporting suite: Dashboard overview, Trial Balance, Profit & Loss, Balance Sheet, and VAT Summary.',
        steps: [
          'From Dashboard, tap "Reports" quick action.',
          'Choose a tab: Dashboard, Trial Balance, P&L, Balance Sheet, or VAT.',
          'Dashboard tab: See per-branch revenue, cost, profit, expenses, and net profit.',
          'Trial Balance tab: View all accounts with debit and credit totals — should always balance.',
          'P&L (Profit & Loss) tab: Revenue, COGS, Gross Profit, Expenses, and Net Profit.',
          'Balance Sheet tab: Assets, Liabilities, and Equity snapshot.',
          'VAT tab: Output VAT, Input VAT, and Net VAT Payable for the period.',
          'Set the period (Today / Week / Month / 3 Months / 6 Months / Year).',
          'Tap "Export as CSV" to download any report for sharing or filing.',
        ],
        tips: [
          'If Trial Balance doesn\'t balance, there may be a data issue — contact support.',
          'The P&L is what you\'ll need for income tax filing.',
          'The VAT summary is ready for your monthly URA VAT return.',
          'Export reports to CSV for use in Excel or Google Sheets.',
        ],
      },
      {
        title: 'Sales History',
        route: '/sales',
        description: 'Browse all past sales with period and payment method filters. Drill into any sale for full details.',
        steps: [
          'From Dashboard, tap "Sales History" quick action.',
          'Browse sales sorted by date (newest first).',
          'Filter by period: Today, 7 Days, Month, 3 Months, or All.',
          'Filter by payment method: Cash, MoMo, Card, or Credit.',
          'Search by customer name or invoice number.',
          efris
            ? 'Tap any sale to view full details (items, tax breakdown, EFRIS status).'
            : 'Tap any sale to view full details (items, tax breakdown, status).',
          'From sale detail, tap "View Receipt" to see or share the receipt.',
        ],
        tips: [
          'Admins see sales from all branches with branch name labels.',
          'The totals at the top show count and total amount for the filtered results.',
          'Credit sales show the customer name and outstanding balance.',
        ],
      },
      {
        title: 'Purchase History',
        route: '/purchase-history',
        description: efris
          ? 'View past stock purchases with supplier info, amounts, and EFRIS submission status.'
          : 'View past stock purchases with supplier info and amounts.',
        steps: [
          'From Dashboard, tap "Purchase History" quick action.',
          'Browse purchases sorted by date (newest first).',
          'Filter by period: Today, 7 Days, Month, 3 Months, or All.',
          efris ? 'Search by supplier name or TIN.' : 'Search by supplier name.',
          'Tap any purchase to view the full breakdown (items, quantities, costs).',
        ],
        tips: [
          ...(efris ? ['EFRIS-submitted purchases show a green checkmark.'] : []),
          'Use purchase history to verify what stock was received and at what cost.',
        ],
      },
      {
        title: 'Sales Targets',
        route: '/sales-targets',
        description: 'Set daily, weekly, or monthly sales goals and track progress in real-time.',
        steps: [
          'From Dashboard, tap "Targets" quick action.',
          'Tap "Create Target" to set a new goal.',
          'Choose: target type (daily, weekly, monthly), target amount, and period.',
          'Optionally assign the target to a specific branch or user.',
          'View active targets with progress bars showing actual vs. target.',
          'Completed targets are highlighted when actual meets or exceeds the goal.',
        ],
        tips: [
          'Use weekly targets for staff motivation and monthly targets for business planning.',
          'Review targets regularly to adjust goals based on trends.',
          'Admins can set targets for any branch or individual.',
        ],
        adminOnly: true,
      },
    ],
  },

  /* ────────── TAX & COMPLIANCE ────────── */
  ...(efris ? [{
    id: 'tax',
    icon: 'university' as const,
    color: '#FF5722',
    title: 'Tax & URA Compliance',
    subtitle: 'EFRIS, VAT returns, income tax, and tax center',
    screens: [
      {
        title: 'Tax Center',
        route: '/tax-center',
        description: 'Your tax compliance dashboard. View VAT summary, income tax estimates, compliance score, and URA filing deadlines.',
        steps: [
          'From Dashboard, tap "Tax Center" quick action.',
          'Compliance Health Check: See if your TIN is set, EFRIS is connected, and if you have unfiscalized sales or missing TINs.',
          'VAT Summary: View output VAT (from sales), input VAT (from purchases), credit note adjustments, and net VAT payable.',
          'Income Tax Estimate: See estimated corporate tax (30%) and presumptive tax (1%) based on your profits.',
          'Quick Actions: Jump to export VAT data, view full reports, or process credit notes.',
          'URA Deadlines: Monthly VAT (15th), PAYE (15th), quarterly income tax, annual returns.',
        ],
        tips: [
          'A 100% compliance score means all sales are fiscalized and all customers have TINs.',
          'VAT returns are due by the 15th of the following month.',
          'The income tax estimate helps you plan for quarterly installments.',
          'Use the "Export VAT" quick action to generate a CSV for your VAT return.',
        ],
        proOnly: true,
      },
      {
        title: 'EFRIS Configuration',
        description: 'Set up your connection to URA\'s Electronic Fiscal Receipting and Invoicing System.',
        steps: [
          'Go to Settings tab (cog icon).',
          'Scroll to the EFRIS section.',
          'Toggle "Enable EFRIS" to turn on fiscal invoicing.',
          'Enter your EFRIS API Key (provided by URA or your EFRIS middleware).',
          'Optionally set a custom API URL (defaults to the standard endpoint).',
          'Toggle "Test Mode" for testing without submitting real invoices.',
          'Tap "Test Connection" to verify your API key works.',
          'Tap "Save Config" to store the settings.',
        ],
        tips: [
          'Get your EFRIS API key from URA\'s e-Tax portal or your EFRIS integration provider.',
          'Always test in "Test Mode" first before going live.',
          'EFRIS requires a Pro subscription plan.',
          'Products must be registered with EFRIS before they appear on fiscal receipts.',
        ],
        proOnly: true,
      },
      {
        title: 'Exporting Data for Tax Filing',
        route: '/export',
        description: 'Export business data as CSV files for URA filing — VAT returns, income tax, sales, expenses, and more.',
        steps: [
          'From Dashboard, tap "Export" quick action.',
          'Choose the data type to export: Sales, Expenses, Inventory, Customers, Purchases, Debts, VAT, or Income Tax.',
          'Set the date range (Today, Week, Month, 3/6 Months, Year, or All Time).',
          'Tap "Export" — a CSV file is generated.',
          'The share sheet opens — send the file via email, WhatsApp, or save to device.',
        ],
        tips: [
          'VAT Export: Includes output VAT, input VAT, credit note adjustments, and net payable — ready for URA portal.',
          'Income Tax Export: Shows your P&L with estimated 30% corporate tax and 1% presumptive tax.',
          'Export "All Time" for annual returns or "Month" for monthly VAT filing.',
          'Open CSV files in Excel or Google Sheets for further analysis.',
        ],
      },
    ],
  }] : []),

  /* ────────── PEOPLE ────────── */
  {
    id: 'people',
    icon: 'users',
    color: '#00BCD4',
    title: 'People Management',
    subtitle: 'Customers, suppliers, loyalty, and team',
    screens: [
      {
        title: 'Managing Customers',
        route: '/customers',
        description: efris
          ? 'Maintain a customer directory with URA buyer types for EFRIS compliance.'
          : 'Maintain a customer directory for invoicing and debt tracking.',
        steps: [
          'From Dashboard, tap "Customers" quick action.',
          'Tap "Add Customer" to create a new record.',
          efris
            ? 'Enter: name (required), TIN, phone, email, address, and contact person.'
            : 'Enter: name (required), phone, email, address, and contact person.',
          ...(efris ? ['Select the EFRIS buyer type: B2B (Business), B2C (Consumer), Foreigner, or B2G (Government).'] : []),
          'Tap "Save" to create the customer.',
          'Search and browse existing customers in the list.',
          'Tap any customer to edit their details.',
        ],
        tips: [
          ...(efris ? ['B2B customers must have a TIN for EFRIS invoicing.'] : []),
          'Linking customers to sales enables debt tracking and loyalty points.',
          ...(efris ? ['Customer TINs appear on exported VAT reports for URA filing.'] : []),
        ],
      },
      {
        title: 'Managing Suppliers',
        route: '/suppliers',
        description: efris
          ? 'Maintain a supplier directory for purchase records and EFRIS stock-in submissions.'
          : 'Maintain a supplier directory for purchase records.',
        steps: [
          'From Dashboard, tap "Suppliers" quick action.',
          'Tap "Add Supplier" to create a new record.',
          efris
            ? 'Enter: name (required), TIN, phone, email, address, and contact person.'
            : 'Enter: name (required), phone, email, address, and contact person.',
          'Tap "Save" to create the supplier.',
          'Suppliers appear in the dropdown when recording purchases.',
        ],
        tips: [
          ...(efris ? ['Supplier TINs are required for EFRIS purchase submissions.'] : []),
          'Having suppliers set up in advance makes purchase recording faster.',
        ],
      },
      {
        title: 'Customer Loyalty Program',
        route: '/loyalty',
        description: 'Reward repeat customers with loyalty points that they can earn on purchases and redeem.',
        steps: [
          'From Dashboard, tap "Loyalty" quick action.',
          'View customers with their loyalty points and total spent.',
          'Customers automatically earn points when purchases are made (configured in settings).',
          'Tap a customer to view their loyalty transaction history.',
          'Use "Adjust Points" to manually add or remove points.',
          'Use "Redeem Points" to apply points as credit toward a purchase.',
        ],
        tips: [
          'Set your points-per-amount ratio in business settings.',
          'Loyalty points are a great way to retain customers.',
          'Transaction history shows all earn, redeem, and adjust events.',
        ],
      },
      {
        title: 'Team / User Management',
        route: '/admin/users',
        description: 'Invite team members, assign roles (admin, branch manager, salesperson), and assign them to branches.',
        steps: [
          'Go to Settings → tap "Manage Users".',
          'Tap "Invite User" to add a new team member.',
          'Enter their full name and email address.',
          'Choose a role: Admin (full access), Branch Manager (branch-level access), or Salesperson (sell & view only).',
          'Assign them to a specific branch.',
          'They\'ll receive an email invitation to create their account.',
        ],
        tips: [
          'Only admins can manage users.',
          'Salespersons can only see their own branch\'s data.',
          'Branch managers can view reports and manage inventory for their branch.',
          'The business owner should always have the admin role.',
        ],
        adminOnly: true,
      },
    ],
  },

  /* ────────── ADMIN & SETUP ────────── */
  {
    id: 'admin',
    icon: 'cog',
    color: '#607D8B',
    title: 'Settings & Administration',
    subtitle: 'Branches, categories, app config, and mode',
    screens: [
      {
        title: 'App Settings',
        route: '/(tabs)/settings',
        description: 'Central hub for profile, subscription, branches, app config, and more.',
        steps: [
          'Go to the "Settings" tab (cog icon).',
          'Profile Card: View your name, role, and business.',
          'Subscription: See your current plan status and days remaining.',
          'Branch Selector: Switch between branches (if your business has multiple).',
          'App Mode: Toggle between Basic and Pro mode.',
          ...(efris ? ['EFRIS Section: Configure API key, test connection, toggle test mode.'] : []),
          'Admin Links: Manage branches, users, and categories.',
        ],
        tips: [
          'Switch branches to view different branch data across the app.',
          ...(efris ? ['Pro mode enables EFRIS fiscal invoicing — requires a Pro subscription.'] : []),
          'Use "Reload Profile" if your role or branch assignment was recently changed.',
        ],
      },
      {
        title: 'Branch Management',
        route: '/admin/branches',
        description: 'Add and manage business branches/locations.',
        steps: [
          'Go to Settings → tap "Manage Branches".',
          'View all existing branches with their locations and phone numbers.',
          'Tap "Add Branch" to create a new location.',
          'Enter: branch name (required), location, and phone.',
          ...(efris ? ['Toggle "EFRIS Enabled" if this branch should fiscalize invoices.'] : []),
          'Tap "Save" to create the branch.',
        ],
        tips: [
          'Each branch has its own inventory, sales, and financial data.',
          'Assign users to branches to control who accesses what data.',
          'You can have one main branch and add more as your business grows.',
        ],
        adminOnly: true,
      },
      {
        title: 'Product Categories',
        route: '/admin/categories',
        description: efris
          ? 'Organize products into categories with optional URA product codes for EFRIS.'
          : 'Organize products into categories for easy browsing and filtering.',
        steps: [
          'Go to Settings → tap "Product Categories".',
          'View existing categories.',
          'Tap "Add Category" to create a new one.',
          efris ? 'Enter the category name and optionally a URA product code.' : 'Enter the category name.',
          'Tap "Save" to create the category.',
        ],
        tips: [
          'Categories help you organize and filter products.',
          ...(efris ? [
            'URA product codes are used in EFRIS for product classification.',
            'Common URA codes can be found on the URA e-Tax portal.',
          ] : []),
        ],
        adminOnly: true,
      },
    ],
  },
];

/* ─── FAQ Data ─── */
const getFaqs = (efris: boolean): { q: string; a: string }[] => [
  ...(efris ? [{
    q: 'What is EFRIS and do I need it?',
    a: 'EFRIS (Electronic Fiscal Receipting and Invoicing System) is URA\'s system for tracking business transactions. If your business is VAT-registered, you are legally required to use EFRIS. YourBooks Lite integrates with EFRIS on the Pro plan — every sale is automatically fiscalized with URA.',
  }] : []),
  {
    q: 'How do I file my VAT return with URA?',
    a: efris
      ? 'Go to Export → select "VAT" → choose the month → tap Export. The CSV shows your Output VAT, Input VAT, Credit Note adjustments, and Net VAT Payable. Use these figures on the URA web portal (efris.ura.go.ug) to complete your monthly return.'
      : 'Go to Export → select "VAT" → choose the month → tap Export. The CSV shows your Output VAT, Input VAT, Credit Note adjustments, and Net VAT Payable. Use these figures to complete your monthly return.',
  },
  {
    q: 'What happens when I sell on credit?',
    a: 'When you choose "Credit" as the payment method, the sale is completed but the amount is recorded as a debt owed by the customer. Go to Dashboard → Debts to track outstanding balances and record payments as customers pay.',
  },
  {
    q: 'Can I use the app offline?',
    a: 'YourBooks Lite requires an internet connection because data is stored in the cloud (Supabase). This ensures your data is always backed up and accessible from any device. If you lose connection, you\'ll see a "check your internet" message.',
  },
  {
    q: 'How are product costs calculated?',
    a: 'YourBooks uses the AVCO (Average Cost) method. Every time you record a stock purchase, the average cost price is recalculated: (existing stock × old avg cost + new qty × new unit cost) ÷ total quantity. This avg cost is used for COGS and profit calculations.',
  },
  {
    q: 'What is the difference between Basic and Pro mode?',
    a: efris
      ? 'Basic mode (70,000/mo) is for businesses that don\'t need EFRIS — you get full POS, inventory, accounting, and reporting features. Pro mode (220,000/mo) adds EFRIS fiscal invoicing, meaning every sale is registered with URA for tax compliance.'
      : 'Basic mode (70,000/mo) gives you full POS, inventory, accounting, and reporting features. Pro mode (220,000/mo) adds advanced features like fiscal invoicing and enhanced compliance tools.',
  },
  {
    q: 'How do I handle product returns?',
    a: efris
      ? 'Go to Credit Notes (from Dashboard or Settings). Search for the original sale, select items to return, choose a reason code, and submit. The return reverses the sale, refunds VAT, adds returned items back to inventory, and submits a credit note to EFRIS if applicable.'
      : 'Go to Credit Notes (from Dashboard or Settings). Search for the original sale, select items to return, choose a reason code, and submit. The return reverses the sale, refunds VAT, and adds returned items back to inventory.',
  },
  {
    q: 'Can I have multiple branches?',
    a: 'Yes! Create branches in Settings → Manage Branches. Each branch has its own inventory and sales data. Admins can view all branches from the Dashboard. Staff members are assigned to specific branches.',
  },
  {
    q: 'How do I export my data?',
    a: 'Go to Dashboard → Export. Choose from 8 data types (Sales, Expenses, Inventory, Customers, Purchases, Debts, VAT, Income Tax). Select a date range and tap Export. The CSV file can be shared via email, WhatsApp, or saved to your device.',
  },
  {
    q: 'What are the URA tax filing deadlines?',
    a: 'VAT: 15th of the following month. PAYE: 15th of the following month. Income Tax: Quarterly installments (Jun 30, Sep 30, Dec 31, Mar 31). Annual Return: June 30. Check the Tax Center for a deadline calendar.',
  },
];

/* ─── Component ─── */
export default function HelpScreen() {
  const router = useRouter();
  const { business } = useAuth();
  const efrisEnabled = business?.is_efris_enabled ?? false;
  const guideSections = getGuideSections(efrisEnabled);
  const faqs = getFaqs(efrisEnabled);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedScreen, setExpandedScreen] = useState<string | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'guide' | 'faq'>('guide');

  const toggleSection = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection(expandedSection === id ? null : id);
    setExpandedScreen(null);
  };

  const toggleScreen = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedScreen(expandedScreen === key ? null : key);
  };

  const toggleFaq = (idx: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedFaq(expandedFaq === idx ? null : idx);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <FontAwesome name="book" size={28} color="#e94560" />
        <View style={{ marginLeft: 12, flex: 1, backgroundColor: 'transparent' }}>
          <Text style={styles.headerTitle}>YourBooks Lite Guide</Text>
          <Text style={styles.headerSub}>Everything you need to know</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'guide' && styles.tabActive]}
          onPress={() => setActiveTab('guide')}
        >
          <FontAwesome name="map" size={14} color={activeTab === 'guide' ? '#fff' : '#888'} />
          <Text style={[styles.tabText, activeTab === 'guide' && styles.tabTextActive]}>
            Feature Guide
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'faq' && styles.tabActive]}
          onPress={() => setActiveTab('faq')}
        >
          <FontAwesome name="question-circle" size={14} color={activeTab === 'faq' ? '#fff' : '#888'} />
          <Text style={[styles.tabText, activeTab === 'faq' && styles.tabTextActive]}>
            FAQ
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {activeTab === 'guide' ? (
          <>
            {guideSections.map(section => (
              <View key={section.id} style={styles.sectionCard}>
                {/* Section Header */}
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSection(section.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.sectionIcon, { backgroundColor: section.color + '20' }]}>
                    <FontAwesome name={section.icon} size={20} color={section.color} />
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionSub}>{section.subtitle}</Text>
                  </View>
                  <FontAwesome
                    name={expandedSection === section.id ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#888"
                  />
                </TouchableOpacity>

                {/* Expanded Screens */}
                {expandedSection === section.id && (
                  <View style={styles.screenList}>
                    {section.screens.map((screen, idx) => {
                      const key = `${section.id}-${idx}`;
                      const isExpanded = expandedScreen === key;
                      return (
                        <View key={key} style={styles.screenCard}>
                          <TouchableOpacity
                            style={styles.screenHeader}
                            onPress={() => toggleScreen(key)}
                            activeOpacity={0.7}
                          >
                            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' }}>
                              <Text style={styles.screenTitle}>{screen.title}</Text>
                              {screen.adminOnly && (
                                <View style={styles.badgeAdmin}>
                                  <Text style={styles.badgeText}>Admin</Text>
                                </View>
                              )}
                              {screen.proOnly && (
                                <View style={styles.badgePro}>
                                  <Text style={styles.badgeText}>Pro</Text>
                                </View>
                              )}
                            </View>
                            <FontAwesome
                              name={isExpanded ? 'minus' : 'plus'}
                              size={12}
                              color="#888"
                            />
                          </TouchableOpacity>

                          {isExpanded && (
                            <View style={styles.screenContent}>
                              <Text style={styles.screenDesc}>{screen.description}</Text>

                              {/* Steps */}
                              <Text style={styles.subHeading}>How to use:</Text>
                              {screen.steps.map((step, si) => (
                                <View key={si} style={styles.stepRow}>
                                  <View style={styles.stepNum}>
                                    <Text style={styles.stepNumText}>{si + 1}</Text>
                                  </View>
                                  <Text style={styles.stepText}>{step}</Text>
                                </View>
                              ))}

                              {/* Tips */}
                              {screen.tips && screen.tips.length > 0 && (
                                <>
                                  <Text style={[styles.subHeading, { marginTop: 12 }]}>Tips:</Text>
                                  {screen.tips.map((tip, ti) => (
                                    <View key={ti} style={styles.tipRow}>
                                      <FontAwesome name="lightbulb-o" size={13} color="#FF9800" style={{ marginTop: 2 }} />
                                      <Text style={styles.tipText}>{tip}</Text>
                                    </View>
                                  ))}
                                </>
                              )}

                              {/* Navigate button */}
                              {screen.route && (
                                <TouchableOpacity
                                  style={[styles.goBtn, { backgroundColor: section.color }]}
                                  onPress={() => router.push(screen.route as any)}
                                >
                                  <Text style={styles.goBtnText}>Go to {screen.title}</Text>
                                  <FontAwesome name="arrow-right" size={12} color="#fff" />
                                </TouchableOpacity>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}

            {/* Quick Reference Card */}
            <View style={styles.quickRef}>
              <Text style={styles.quickRefTitle}>Quick Reference</Text>
              <View style={styles.refRow}><Text style={styles.refLabel}>4 Main Tabs:</Text><Text style={styles.refValue}>Sell, Inventory, Dashboard, Settings</Text></View>
              <View style={styles.refRow}><Text style={styles.refLabel}>Payment Methods:</Text><Text style={styles.refValue}>Cash, Mobile Money, Card, Bank, Credit</Text></View>
              <View style={styles.refRow}><Text style={styles.refLabel}>Tax Options:</Text><Text style={styles.refValue}>No Tax, 18% VAT, Zero Rated, Exempt</Text></View>
              <View style={styles.refRow}><Text style={styles.refLabel}>User Roles:</Text><Text style={styles.refValue}>Admin, Branch Manager, Salesperson</Text></View>
              <View style={styles.refRow}><Text style={styles.refLabel}>Plans:</Text><Text style={styles.refValue}>Free Trial (14d), Basic (70K), Pro (220K)</Text></View>
              {efrisEnabled && (
                <View style={styles.refRow}><Text style={styles.refLabel}>Buyer Types:</Text><Text style={styles.refValue}>B2B, B2C, Foreigner, B2G</Text></View>
              )}
              <View style={styles.refRow}><Text style={styles.refLabel}>VAT Filing:</Text><Text style={styles.refValue}>15th of each month</Text></View>
              <View style={styles.refRow}><Text style={styles.refLabel}>Cost Method:</Text><Text style={styles.refValue}>AVCO (Weighted Average Cost)</Text></View>
            </View>
          </>
        ) : (
          /* ─── FAQ Tab ─── */
          <>
            <View style={styles.faqIntro}>
              <FontAwesome name="question-circle" size={24} color="#e94560" />
              <Text style={styles.faqIntroText}>
                Frequently asked questions about YourBooks Lite
              </Text>
            </View>

            {faqs.map((faq, i) => (
              <View key={i} style={styles.faqCard}>
                <TouchableOpacity
                  style={styles.faqHeader}
                  onPress={() => toggleFaq(i)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.faqQ}>{faq.q}</Text>
                  <FontAwesome
                    name={expandedFaq === i ? 'chevron-up' : 'chevron-down'}
                    size={12}
                    color="#888"
                  />
                </TouchableOpacity>
                {expandedFaq === i && (
                  <Text style={styles.faqA}>{faq.a}</Text>
                )}
              </View>
            ))}
          </>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>YourBooks Lite v1.0</Text>
          <Text style={styles.footerText}>Made for Uganda small businesses</Text>
          <Text style={styles.footerSub}>Need help? Contact support@yourbooks.app</Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ─── Styles ─── */
const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  headerSub: { fontSize: 13, color: '#888', marginTop: 2 },

  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: '#1a1a2e',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  tabActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  tabText: { fontSize: 14, color: '#888', fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  scroll: { flex: 1, paddingHorizontal: 16 },

  /* Section */
  sectionCard: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'transparent',
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  sectionSub: { fontSize: 12, color: '#888', marginTop: 2 },

  /* Screen list */
  screenList: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  screenCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#0f3460',
    overflow: 'hidden',
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: 'transparent',
  },
  screenTitle: { fontSize: 14, fontWeight: '600', color: '#fff' },

  badgeAdmin: { backgroundColor: '#FF9800', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 },
  badgePro: { backgroundColor: '#9C27B0', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 },
  badgeText: { fontSize: 10, fontWeight: 'bold', color: '#fff' },

  screenContent: { paddingHorizontal: 14, paddingBottom: 14, backgroundColor: 'transparent' },
  screenDesc: { fontSize: 13, color: '#ccc', lineHeight: 19, marginBottom: 12 },

  subHeading: { fontSize: 13, fontWeight: 'bold', color: '#e94560', marginBottom: 8 },

  stepRow: { flexDirection: 'row', marginBottom: 8, backgroundColor: 'transparent' },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0f3460',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  stepNumText: { fontSize: 11, fontWeight: 'bold', color: '#e94560' },
  stepText: { flex: 1, fontSize: 13, color: '#ccc', lineHeight: 19 },

  tipRow: { flexDirection: 'row', marginBottom: 6, gap: 8, backgroundColor: 'transparent' },
  tipText: { flex: 1, fontSize: 12, color: '#aaa', lineHeight: 18, fontStyle: 'italic' },

  goBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  goBtnText: { fontSize: 13, fontWeight: 'bold', color: '#fff' },

  /* Quick Reference */
  quickRef: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  quickRefTitle: { fontSize: 16, fontWeight: 'bold', color: '#e94560', marginBottom: 12 },
  refRow: {
    flexDirection: 'row',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  refLabel: { fontSize: 13, fontWeight: '600', color: '#ccc', width: 130 },
  refValue: { flex: 1, fontSize: 13, color: '#888' },

  /* FAQ */
  faqIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#16213e',
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  faqIntroText: { flex: 1, fontSize: 14, color: '#ccc', lineHeight: 20 },

  faqCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#0f3460',
    overflow: 'hidden',
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: '#fff', marginRight: 8 },
  faqA: { fontSize: 13, color: '#ccc', lineHeight: 20, paddingHorizontal: 14, paddingBottom: 14 },

  /* Footer */
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  footerText: { fontSize: 13, color: '#555', marginBottom: 4 },
  footerSub: { fontSize: 12, color: '#444', marginTop: 4 },
});

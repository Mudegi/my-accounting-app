# YourBooks Lite — User Guide & Documentation

**Version 1.0 | For Uganda Small Businesses**
**POS · Inventory · Accounting · Tax Compliance**

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
   - 2.1 Creating an Account
   - 2.2 Business Onboarding
   - 2.3 Choosing a Subscription Plan
3. [App Navigation](#3-app-navigation)
4. [Sell Tab — Point of Sale (POS)](#4-sell-tab--point-of-sale)
   - 4.1 Adding Products to Cart
   - 4.2 Barcode Scanning
   - 4.3 Applying Discounts
   - 4.4 Editing Prices
   - 4.5 Selecting Tax Options
   - 4.6 Completing a Sale
   - 4.7 Payment Methods
   - 4.8 Selecting a Customer
   - 4.9 Receipts & Fiscal Invoices
5. [Inventory Tab — Stock Management](#5-inventory-tab--stock-management)
   - 5.1 Viewing Inventory
   - 5.2 Filtering & Searching Products
   - 5.3 Adding a New Product
   - 5.4 Editing a Product
   - 5.5 Barcode & Image
   - 5.6 EFRIS Product Registration
6. [Dashboard Tab — Business Overview](#6-dashboard-tab--business-overview)
   - 6.1 Summary Cards
   - 6.2 Period Filters
   - 6.3 Branch Performance (Admin)
   - 6.4 Quick Actions
   - 6.5 Recent Sales
7. [Settings Tab — Configuration](#7-settings-tab--configuration)
   - 7.1 Profile & Business Info
   - 7.2 Subscription Status
   - 7.3 Branch Selector
   - 7.4 App Mode (Basic / Pro)
   - 7.5 EFRIS Configuration
   - 7.6 Auto-Print Receipts
8. [Stock Purchases (Stock-In)](#8-stock-purchases)
   - 8.1 Recording a Purchase
   - 8.2 Supplier Selection
   - 8.3 EFRIS Stock Increase
   - 8.4 Accounting Entry
9. [Purchase History](#9-purchase-history)
10. [Expenses](#10-expenses)
    - 10.1 Recording an Expense
    - 10.2 Expense Categories
    - 10.3 Monthly Totals
11. [Customers](#11-customers)
    - 11.1 Adding a Customer
    - 11.2 Buyer Types
    - 11.3 Customer TIN
12. [Suppliers](#12-suppliers)
13. [Sales History](#13-sales-history)
    - 13.1 Filtering Sales
    - 13.2 Sale Detail
    - 13.3 Viewing Receipts
14. [Credit Notes / Returns](#14-credit-notes--returns)
    - 14.1 Issuing a Credit Note
    - 14.2 Credit Note Submission
    - 14.3 VAT Reversal
15. [Customer Debts (Credit Sales)](#15-customer-debts)
    - 15.1 How Credit Sales Work
    - 15.2 Recording Debt Payments
    - 15.3 Partial Payments
16. [Low Stock Alerts](#16-low-stock-alerts)
17. [Cash Register / End of Day](#17-cash-register--end-of-day)
    - 17.1 Opening the Register
    - 17.2 Closing the Register
    - 17.3 Variance & Reconciliation
    - 17.4 Session History
18. [Stock Transfers](#18-stock-transfers)
19. [Reports & Analytics](#19-reports--analytics)
    - 19.1 Dashboard Report
    - 19.2 Trial Balance
    - 19.3 Profit & Loss (Income Statement)
    - 19.4 Balance Sheet
    - 19.5 VAT Summary
    - 19.6 Exporting Reports to CSV
20. [Sales Targets](#20-sales-targets)
21. [Customer Loyalty Program](#21-customer-loyalty-program)
22. [Tax Center — URA Compliance](#22-tax-center--ura-compliance)
    - 22.1 Compliance Health Check
    - 22.2 VAT Summary
    - 22.3 Income Tax Estimate
    - 22.4 URA Filing Deadlines
23. [Data Export for Tax Filing](#23-data-export-for-tax-filing)
    - 23.1 VAT Export
    - 23.2 Income Tax Export
    - 23.3 Other Exports
24. [Administration (Admin Only)](#24-administration)
    - 24.1 Managing Branches
    - 24.2 Managing Users & Roles
    - 24.3 Product Categories
25. [Accounting System](#25-accounting-system)
    - 25.1 Double-Entry Bookkeeping
    - 25.2 Chart of Accounts
    - 25.3 AVCO Cost Method
    - 25.4 Automatic Journal Entries
26. [EFRIS Integration (Optional)](#26-efris-integration)
    - 26.1 What is EFRIS?
    - 26.2 Enabling EFRIS
    - 26.3 Fiscalizing Sales
    - 26.4 Registering Products
    - 26.5 Credit Notes
    - 26.6 Stock Increase (Purchases)
27. [Subscription Plans & Billing](#27-subscription-plans--billing)
28. [User Roles & Permissions](#28-user-roles--permissions)
29. [Frequently Asked Questions](#29-faq)
30. [Troubleshooting](#30-troubleshooting)

---

## 1. Introduction

**YourBooks Lite** is a mobile Point-of-Sale (POS) and accounting application built specifically for small businesses in Uganda. It combines:

- **Point of Sale (POS)** — Sell products with barcode scanning, discounts, multiple payment methods, and automatic receipts.
- **Inventory Management** — Track stock quantities, costs, and reorder levels across multiple branches.
- **Double-Entry Accounting** — Automatic journal entries for every transaction (sales, purchases, expenses, returns).
- **EFRIS Integration** — Optional connection to URA's Electronic Fiscal Receipting and Invoicing System (available on request — contact YourBooks support).
- **Tax Reporting** — VAT returns, income tax estimates, and CSV exports ready for URA filing.
- **Multi-Branch Support** — Manage multiple business locations from a single account.

The app runs on Android phones and uses cloud storage (Supabase), so your data is always backed up and accessible.

---

## 2. Getting Started

### 2.1 Creating an Account

1. Open YourBooks Lite on your phone.
2. On the Login screen, tap **"Create Account"** to switch to sign-up mode.
3. Enter:
   - **Full Name** — Your personal name
   - **Email** — Your email address (used for login)
   - **Password** — At least 6 characters
   - **Business Name** — The name of your business
4. Tap **"Sign Up"** to create your account.
5. If you already have an account, simply enter your email and password and tap **"Sign In"**.

> **Note:** The app requires an internet connection. If sign-in takes more than 10 seconds, check your connection and tap "Retry".

### 2.2 Business Onboarding

After your first sign-in, the app walks you through a 3-step setup:

**Step 1 — Business Details:**
- Business Name
- Phone Number
- Address
- TIN (Tax Identification Number) — Enter your URA TIN if you have one

**Step 2 — Currency:**
- Select your business currency from the list
- Default is **UGX** (Ugandan Shilling)
- Other currencies available: USD, KES, TZS, RWF, etc.

**Step 3 — Subscription Plan:**
- Choose from Free Trial, Basic, or Pro (see [Section 27](#27-subscription-plans--billing))
- You can change this later in Settings

### 2.3 Choosing a Subscription Plan

| Plan | Price | Features |
|------|-------|----------|
| **Free Trial** | Free for 14 days | Full access to all features |
| **Starter** | UGX 30,000/month | POS, Basic Inventory, Receipts (1 branch, 2 users, 100 products) |
| **Basic** | UGX 70,000/month | + Reports, Expenses, Multi-branch, Credit Notes (unlimited) |
| **Pro** | UGX 220,000/month | + Full Accounting, Tax Center, Data Export (unlimited) |

---

## 3. App Navigation

YourBooks Lite has **4 main tabs** at the bottom of the screen:

| Tab | Icon | Purpose |
|-----|------|---------|
| **Sell** | 🛒 Shopping Cart | Point of Sale — make sales |
| **Inventory** | 📦 Cube | View and manage products/stock |
| **Dashboard** | 📊 Bar Chart | Business overview, quick actions, reports |
| **Settings** | ⚙️ Cog | Configuration, branches, profile |

Additional screens are accessed through buttons and links on these tabs.

---

## 4. Sell Tab — Point of Sale (POS)

The Sell tab is where you process customer purchases. It consists of a product browser/scanner and a shopping cart.

### 4.1 Adding Products to Cart

There are two ways to add products:

**Method 1 — Search:**
1. Tap the **search icon** (magnifying glass) at the top.
2. Type the product name in the search bar.
3. All matching products appear as cards showing name, price, and stock.
4. Tap a product to add one unit to your cart.

**Method 2 — Product Grid:**
- All your products are displayed in a scrollable grid.
- Tap any product card to add it to the cart.

Once a product is in the cart, use the **+** and **−** buttons to adjust the quantity.

### 4.2 Barcode Scanning

1. Tap the **camera icon** at the top of the Sell screen.
2. Point your camera at a product barcode.
3. The app automatically detects the barcode and adds the matching product to your cart.
4. The scanner closes after a successful scan but can be reopened to scan more items.

> **Tip:** Products must have a barcode saved in their profile for scanning to work. You can add barcodes when creating or editing products.

### 4.3 Applying Discounts

1. In the cart, tap the **tag icon** on any item.
2. The discount editor expands.
3. Enter a discount value.
4. Toggle between **Amount** (e.g., 500 UGX off) or **Percent** (e.g., 10% off).
5. The price updates automatically.

### 4.4 Editing Prices

1. Tap the **pencil icon** on a cart item.
2. Enter the new selling price.
3. This overrides the default price for this sale only — it does not change the product's stored price.

### 4.5 Selecting Tax Options

Each cart item has a tax selector. Options:

| Option | Tax Code | Rate | When to Use |
|--------|----------|------|-------------|
| **No Tax** | 11 | 0% | Not VAT-registered or tax-free items |
| **18% VAT** | 01 | 18% | Standard VAT-rated goods/services |
| **Zero Rated** | 02 | 0% | Zero-rated goods (e.g., exports, basic foods) |
| **Exempt** | 03 | 0% | VAT-exempt items |

The tax is calculated automatically and shown in the cart total.

### 4.6 Completing a Sale

1. Review your cart — check items, quantities, prices, discounts, and tax.
2. The bottom bar shows the **Cart Total** (including tax).
3. Tap **"Charge [Amount]"** to proceed to checkout.
4. A checkout modal appears with payment options.

### 4.7 Payment Methods

| Method | Description |
|--------|-------------|
| **Cash** | Physical cash — enter amount tendered, change is calculated |
| **Mobile Money** | MTN MoMo, Airtel Money, etc. |
| **Card** | Debit/credit card payment |
| **Bank** | Direct bank transfer |
| **Credit** | Customer pays later — creates a debt record |

When paying by **Cash**, you can enter the amount the customer gives you. The app calculates and displays the **change** to return.

When paying by **Credit**, you must select a customer so the debt is linked to them.

### 4.8 Selecting a Customer

In the checkout modal:
1. Tap the customer dropdown.
2. Search for an existing customer or browse the list.
3. Select the customer.

This is **required** for Credit sales and **recommended** for B2B sales (so TIN appears on the invoice).

### 4.9 Receipts & Fiscal Invoices

After completing a sale, the **Receipt** screen opens showing:
- Business name and address
- Invoice/receipt number
- Date and time
- Line items with quantity, unit price, and amount
- Subtotal, discount, tax breakdown, and total
- Payment method
- **QR Code** (for EFRIS-fiscalized sales) — links to URA's verification portal
- EFRIS FDN (Fiscal Document Number)
- Tax category breakdown (A = Standard, B = Zero Rated, C = Exempt, etc.)

**Actions on the receipt:**
- **Share** — Send the receipt as a file via WhatsApp, email, etc.
- **Print** — Print to a connected printer
- **Done** — Return to the Sell screen

---

## 5. Inventory Tab — Stock Management

### 5.1 Viewing Inventory

The Inventory tab shows all products at your currently selected branch. Each product card displays:
- Product name
- Stock quantity (number of units available)
- Selling price
- Average cost price
- Product image (if uploaded)

Products are sorted by quantity (lowest first) so low-stock items appear at the top.

### 5.2 Filtering & Searching Products

**Search:** Type in the search bar to filter by product name or barcode.

**Filter buttons:**
- **All** — Show all products
- **Low Stock** — Products below their reorder level (but not zero)
- **Out of Stock** — Products with zero quantity

### 5.3 Adding a New Product

1. Tap the **"+"** button at the top-right of the Inventory screen.
2. Fill in the product form:
   - **Name** (required) — Product name
   - **Barcode** — Tap the camera icon to scan, or type manually
   - **SKU** — Stock Keeping Unit code (optional)
   - **Description** — Product description (optional)
   - **Selling Price** — The price you sell at (tax-exclusive)
   - **Unit** — Pieces, Kg, Litres, Metres, etc.
   - **Tax Category** — Standard (18% VAT), Zero Rated, Exempt, or Excise Duty
   - **EFRIS Unit** — The EFRIS unit code mapping (shown if EFRIS is enabled for your business)
   - **Image** — Upload a product photo from your gallery
3. Tap **"Save"** to create the product.

> **Note:** New products start with 0 stock. Record a stock purchase (see [Section 8](#8-stock-purchases)) to add initial quantities.

### 5.4 Editing a Product

1. Tap any product card in the Inventory list.
2. The product form opens with existing values pre-filled.
3. Make your changes and tap **"Save"**.

### 5.5 Barcode & Image

- **Barcode:** On the product form, tap the camera icon next to the barcode field. Point your camera at the barcode. It auto-fills once detected.
- **Image:** Tap "Choose Image" to pick a photo from your device gallery.

### 5.6 EFRIS Product Registration

If EFRIS has been enabled for your business by YourBooks support:
1. After saving a product, a **"Register with EFRIS"** button appears.
2. Tap it to submit the product to URA's EFRIS system.
3. This must be done before the product can appear on fiscalized invoices.
4. You only need to register each product once.

---

## 6. Dashboard Tab — Business Overview

### 6.1 Summary Cards

The top of the Dashboard shows four key metrics:
- **Sales** — Total sales amount for the selected period
- **Transactions** — Number of completed sales
- **Low Stock** — Number of products below reorder level
- **Products** — Total number of products in inventory

### 6.2 Period Filters

Select a time range for dashboard data:
- **Today** — Current day only
- **Week** — Last 7 days
- **Month** — Current calendar month
- **3 Months** — Last 3 months
- **6 Months** — Last 6 months

### 6.3 Branch Performance (Admin Only)

Admin users see a **Branch Performance** section showing each branch with:
- Revenue (total sales)
- Cost (COGS — cost of goods sold)
- Gross Profit (Revenue − Cost)
- Expenses
- Net Profit (Gross Profit − Expenses)
- Transaction count

A **Business Total** row summarizes all branches.

### 6.4 Quick Actions

A grid of shortcut buttons for quick navigation:

| Action | What It Does |
|--------|-------------|
| **Purchases** | Record new stock purchases |
| **Expenses** | Record business expenses |
| **Reports** | View financial reports (Admin) |
| **Tax Center** | Tax compliance dashboard |
| **Suppliers** | Manage supplier directory |
| **Customers** | Manage customer directory |
| **Sales History** | Browse past sales |
| **Purchase History** | Browse past purchases |
| **Debts** | Manage customer credit/debts |
| **Low Stock** | View low stock alerts |
| **Cash Register** | Open/close daily register |
| **Export Data** | Export CSV files |
| **Targets** | Sales targets (Admin) |
| **Loyalty** | Customer loyalty program |
| **Help Guide** | This user guide |

### 6.5 Recent Sales

Below the quick actions, a scrollable list shows the most recent sales with:
- Sale amount
- Time of sale
- Status badge (completed / voided)
- Branch name (for admins viewing cross-branch data)

Tap any sale to view its full details.

---

## 7. Settings Tab — Configuration

### 7.1 Profile & Business Info

At the top of Settings, your profile card shows:
- Your full name
- Your role (Admin, Branch Manager, or Salesperson)
- Business name

### 7.2 Subscription Status

A status card shows:
- Current plan name
- Status (active, trial, expired, cancelled)
- Days remaining (for trial)
- Tap to manage subscription

### 7.3 Branch Selector

If your business has multiple branches:
1. A list of branches appears in Settings.
2. Tap a branch to switch to it.
3. All data in the app (inventory, sales, etc.) updates to show that branch's data.
4. The selected branch is remembered until you change it.

### 7.4 App Mode (Basic / Pro)

- **Basic Mode** — Standard POS and accounting.
- **Pro Mode** — Enables full accounting, tax center, and advanced features.

Toggle the switch to change modes. Pro mode requires a Pro subscription.

### 7.5 EFRIS Configuration

EFRIS is configured and managed by the YourBooks support team. If your business needs EFRIS for URA compliance, contact YourBooks support to discuss enabling it. Once enabled, all sales are automatically fiscalized.

> **Note:** EFRIS is optional. Most businesses do not need EFRIS unless they are VAT-registered with URA.

### 7.6 Auto-Print Receipts

Toggle "Auto-Print" to automatically send receipts to your connected printer after each sale.

---

## 8. Stock Purchases

Stock purchases record when you buy goods from suppliers to sell in your shop.

### 8.1 Recording a Purchase

1. From Dashboard, tap **"Purchases"** quick action.
2. Tap **"Add Item"** to select a product.
3. For each line item, enter:
   - **Product** — Select from your product list
   - **Quantity** — How many units you're buying
   - **Unit Cost** — The price per unit you're paying the supplier
4. Add as many items as needed.
5. Select the **Payment Method** (Cash, Mobile Money, Bank, Card).
6. Tap **"Submit Purchase"**.

### 8.2 Supplier Selection

Before submitting, select a supplier:
- Choose from your existing supplier list (dropdown).
- Or enter a supplier TIN manually.

> **Tip:** Add suppliers to the Suppliers directory first (see [Section 12](#12-suppliers)) for quick selection on future purchases.

### 8.3 EFRIS Stock Increase

If EFRIS has been enabled for your business, the purchase is automatically submitted to URA as a **Stock Increase**. This registers the incoming goods in the fiscal system.

### 8.4 Accounting Entry

Every purchase automatically creates a double-entry journal:
- **Debit:** Inventory (asset increases)
- **Debit:** VAT Input (if applicable — VAT you paid to the supplier)
- **Credit:** Cash / Mobile Money / Bank (payment goes out)

The cost price is used to update the product's **Average Cost Price** using the AVCO method (see [Section 25.3](#253-avco-cost-method)).

---

## 9. Purchase History

1. From Dashboard, tap **"Purchase History"**.
2. Browse purchases sorted by date (newest first).
3. Filter by period: Today, 7 Days, Month, 3 Months, All.
4. Search by supplier name or TIN.
5. Tap any purchase to see the full breakdown:
   - Supplier name and TIN
   - All purchased items with quantity and unit cost
   - EFRIS submission status and timestamp (if EFRIS is enabled)
   - Total amount

---

## 10. Expenses

### 10.1 Recording an Expense

1. From Dashboard, tap **"Expenses"**.
2. Tap **"Add Expense"**.
3. Fill in:
   - **Category** — Select from predefined list
   - **Description** — What the expense was for
   - **Amount** — How much you spent
   - **Date** — When the expense occurred
   - **Payment Method** — How you paid
4. Tap **"Save"**.

### 10.2 Expense Categories

| Category | Examples |
|----------|---------|
| Rent | Office/shop rent |
| Electricity | Power bills |
| Water | Water bills |
| Internet | WiFi, data bundles |
| Transport | Fuel, boda, delivery |
| Salaries | Staff wages |
| Office Supplies | Stationery, cleaning |
| Marketing | Advertising, flyers |
| Repairs | Equipment maintenance |
| Other | Anything else |

### 10.3 Monthly Totals

The top of the Expenses screen shows your total expenses for the current month. Admin users can filter by branch to see expenses per location.

---

## 11. Customers

### 11.1 Adding a Customer

1. From Dashboard, tap **"Customers"**.
2. Tap **"Add Customer"**.
3. Enter:
   - **Name** (required)
   - **TIN** — Tax Identification Number
   - **Phone** — Phone number
   - **Email** — Email address
   - **Address** — Physical address
   - **Contact Person** — Name of contact (for businesses)
   - **Buyer Type** — Classification for invoicing (B2B, B2C, etc.)

### 11.2 Buyer Types

| Type | Code | When to Use |
|------|------|-------------|
| **B2B** | Business to Business | Selling to a registered business |
| **B2C** | Business to Consumer | Selling to an individual consumer |
| **Foreigner** | Foreign Buyer | Selling to a non-Ugandan buyer |
| **B2G** | Business to Government | Selling to a government entity |

### 11.3 Customer TIN

For **B2B** customers, entering their TIN is important because:
- It appears on invoices and fiscal receipts
- It shows in your VAT export data for URA filing
- URA may require TINs for VAT deduction verification

---

## 12. Suppliers

Suppliers are the businesses or individuals you buy stock from.

1. From Dashboard, tap **"Suppliers"**.
2. Tap **"Add Supplier"**.
3. Enter: Name (required), TIN, Phone, Email, Address, Contact Person.
4. Tap **"Save"**.

Suppliers appear in the dropdown when recording purchases. Their TIN is included in stock purchase submissions and VAT input reports.

---

## 13. Sales History

### 13.1 Filtering Sales

1. From Dashboard, tap **"Sales History"**.
2. Browse sales sorted by date (newest first).
3. **Period filter:** Today, 7 Days, Month, 3 Months, All.
4. **Payment filter:** Cash, MoMo, Card, Credit.
5. **Search:** By customer name or invoice number.
6. Totals at the top show transaction count and total amount for filtered results.

### 13.2 Sale Detail

Tap any sale to see the full details:
- **Header:** Total, subtotal, tax, discount, payment method, status
- **Fiscal info:** Fiscalization status, FDN, invoice number (if EFRIS is enabled)
- **Customer:** Name, TIN, buyer type
- **Items:** Each line item with quantity, unit price, cost price, and tax rate

### 13.3 Viewing Receipts

From Sale Detail, tap **"View Receipt"** to see or share the fiscal receipt.

---

## 14. Credit Notes / Returns

Credit notes are used to process customer returns and reverse a previous sale (fully or partially).

### 14.1 Issuing a Credit Note

1. Navigate to **Credit Notes** (from Dashboard actions or Settings).
2. Search for the original sale by invoice number or browse recent sales.
3. Tap the sale you want to return items from.
4. Select the items being returned and enter the return quantities.
5. Choose a **Return Reason Code**:
   - Defective goods
   - Wrong item delivered
   - Customer dissatisfaction
   - (and other URA-defined reasons)
6. Tap **"Submit Credit Note"**.

### 14.2 Credit Note Submission

If EFRIS is enabled for your business, the credit note is automatically submitted to URA with:
- Reference to the original invoice
- Returned items with quantities
- Return reason code
- Per-item tax rate (uses the original sale's tax rate)

### 14.3 VAT Reversal

When a credit note is processed:
- **Sales Returns** account is debited (reduces revenue)
- **VAT Payable** is debited (reverses the output VAT on returned items)
- **Cash/Payment** is credited (refund amount)
- **Inventory** is debited (returned goods go back to stock)
- **COGS** is credited (cost of returned goods is reversed)

This ensures your VAT reporting accurately reflects the return.

---

## 15. Customer Debts (Credit Sales)

### 15.1 How Credit Sales Work

When you complete a sale with **"Credit"** as the payment method:
1. The sale is recorded as completed.
2. The amount is added as a debt linked to the selected customer.
3. The accounting journal debits **Accounts Receivable** (instead of Cash).
4. The customer's outstanding balance increases.

### 15.2 Recording Debt Payments

1. From Dashboard, tap **"Debts"**.
2. View all customers with outstanding credit balances.
3. Each card shows: Total Debt, Amount Paid, and Remaining Balance.
4. Tap a customer to see their individual credit sales.
5. Tap **"Record Payment"**.
6. Enter the payment amount and select the payment method.
7. Tap **"Save"**.

The payment is recorded and the accounting journal:
- Debits Cash (or Mobile Money, Bank, etc.)
- Credits Accounts Receivable

### 15.3 Partial Payments

You can record partial payments. For example, if a customer owes 100,000 UGX, they can pay 50,000 now and 50,000 later. Each payment reduces the outstanding balance.

---

## 16. Low Stock Alerts

1. From Dashboard, tap **"Low Stock"**.
2. See all products that have fallen below their **reorder level**.
3. Filter by:
   - **Critical** — Zero stock (completely out)
   - **Low** — Above zero but below reorder level
   - **All** — Both critical and low
4. Search by product name or barcode.
5. Admins see low stock across all branches.

> **Tip:** Set meaningful reorder levels when creating products. For example, if you sell 10 units per day, set the reorder level to 30 (3-day supply).

---

## 17. Cash Register / End of Day

The cash register helps you track the physical cash in your drawer and reconcile it at the end of each day or shift.

### 17.1 Opening the Register

1. From Dashboard, tap **"Cash Register"**.
2. If no session is open, tap **"Open Register"**.
3. Enter the **Opening Balance** — how much cash is physically in the drawer right now.
4. Tap **"Open"**.

### 17.2 Closing the Register

1. At the end of the day/shift, return to Cash Register.
2. Tap **"Close Register"**.
3. Enter the **Actual Closing Balance** — count the physical cash in the drawer.
4. Tap **"Close"**.

### 17.3 Variance & Reconciliation

When you close the register, the system calculates:

```
Expected Balance = Opening Balance + Cash Sales − Cash Expenses
Variance = Actual Balance − Expected Balance
```

- **Positive variance** (over) — More cash than expected. Could be an unrecorded sale or error.
- **Negative variance** (short) — Less cash than expected. Could be an unrecorded expense, theft, or error.
- **Zero variance** — Perfect reconciliation.

### 17.4 Session History

Below the current session, view past sessions with:
- Opening and closing balances
- Expected vs. actual totals
- Number of transactions
- Variance amount

---

## 18. Stock Transfers

Transfer inventory between your branches.

1. Navigate to **Stock Transfers**.
2. Select the **destination branch** from the dropdown.
3. Choose products and enter the quantity to transfer.
4. Add optional notes (e.g., "Restocking branch 2 for weekend").
5. Tap **"Submit Transfer"**.

What happens:
- Source branch stock decreases by the transfer quantity.
- Destination branch stock increases by the same amount.
- A transfer record is created with status tracking.

> **Note:** Only admins and branch managers can initiate transfers.

---

## 19. Reports & Analytics

Access from Dashboard → **"Reports"** quick action (admin only).

### 19.1 Dashboard Report

Overview of financial performance by branch:
- Revenue, Cost, Gross Profit, Expenses, Net Profit per branch
- Business-wide totals

### 19.2 Trial Balance

Lists all accounts in your chart of accounts with their debit and credit totals. The total debits should always equal total credits — if they don't, there's a data issue.

### 19.3 Profit & Loss (Income Statement)

| Line | Calculation |
|------|------------|
| **Sales Revenue** | Total completed sales |
| − Sales Returns | Credit notes / returns |
| − Sales Discounts | Discounts given |
| = **Net Revenue** | Sales − Returns − Discounts |
| − Cost of Goods Sold (COGS) | Cost of items sold (AVCO method) |
| = **Gross Profit** | Net Revenue − COGS |
| − Operating Expenses | Rent, salaries, utilities, etc. |
| = **Net Profit** | Gross Profit − Expenses |

### 19.4 Balance Sheet

Shows your business's financial position:
- **Assets:** Cash, Mobile Money, Bank, Accounts Receivable, Inventory
- **Liabilities:** VAT Payable, Accounts Payable
- **Equity:** Owner's Equity, Retained Earnings

### 19.5 VAT Summary

| Line | Description |
|------|------------|
| **Output VAT** | VAT collected from customers on sales |
| **Input VAT** | VAT paid to suppliers on purchases |
| **Net VAT Payable** | Output VAT − Input VAT (what you owe URA) |

### 19.6 Exporting Reports to CSV

On any report tab (P&L, Balance Sheet, Trial Balance, VAT):
1. Tap **"Export as CSV"** button below the report.
2. The report is saved as a CSV file.
3. Share it via email, WhatsApp, or save to your device.
4. Open in Excel or Google Sheets for further use.

---

## 20. Sales Targets

Set goals and track performance against them.

1. From Dashboard, tap **"Targets"** (admin only).
2. Tap **"Create Target"**.
3. Set:
   - **Target Type:** Daily, Weekly, or Monthly
   - **Target Amount:** The sales goal in your currency
   - **Period:** Start and end dates
   - **Branch/User:** Assign to a specific branch or team member (optional)
4. Tap **"Save"**.

Active targets show a progress bar:
- **Green** — On track or exceeded
- **Yellow** — Behind but achievable
- **Red** — Significantly behind

---

## 21. Customer Loyalty Program

Reward repeat customers with points.

1. From Dashboard, tap **"Loyalty"**.
2. View customers with their loyalty points and total lifetime spend.
3. Points are automatically earned when customers make purchases.
4. Tap a customer to:
   - View their loyalty transaction history (earn, redeem, adjust)
   - **Adjust Points** — Manually add or remove points
   - **Redeem Points** — Apply points as credit

> **Configuration:** The points-per-amount ratio (e.g., 1 point per 1,000 UGX) is set in your business settings.

---

## 22. Tax Center — URA Compliance

The Tax Center is your central hub for tax compliance. Access from Dashboard → **"Tax Center"**.

### 22.1 Compliance Health Check

Four compliance items are checked:

| Item | What It Checks | How to Fix |
|------|---------------|-----------|
| **Business TIN** | Is your TIN set? | Go to Settings → update business details |
| **EFRIS Connected** | Is EFRIS enabled? (Optional — contact support) | Managed by YourBooks support |
| **Unfiscalized Sales** | Sales not submitted to EFRIS | These need to be submitted via EFRIS |
| **Missing TINs** | Sales to B2B customers without TIN | Update customer records with TINs |

A **Compliance Score** (0–100%) shows your overall compliance level.

### 22.2 VAT Summary

For the selected period:
- **Output VAT** — Total VAT collected from sales
- **Input VAT** — Total VAT paid on purchases
- **Credit Note Adjustments** — VAT reversed on returns
- **Net VAT Payable** — What you owe URA

Formula: `Net VAT = Output VAT − Credit Note VAT − Input VAT`

### 22.3 Income Tax Estimate

Based on your P&L:
- Revenue, COGS, Expenses, and Net Profit
- **Corporate Tax (30%)** — Standard rate for companies
- **Presumptive Tax (1%)** — For businesses with turnover below UGX 150M
- Quarterly installment estimates

### 22.4 URA Filing Deadlines

| Tax | Deadline | Frequency |
|-----|----------|-----------|
| **VAT Return** | 15th of the following month | Monthly |
| **PAYE** | 15th of the following month | Monthly |
| **Income Tax** | Jun 30, Sep 30, Dec 31, Mar 31 | Quarterly |
| **Annual Return** | June 30 | Annual |
| **WHT** | 15th of the following month | As applicable |

---

## 23. Data Export for Tax Filing

Access from Dashboard → **"Export Data"**.

### 23.1 VAT Export

Select **"VAT"** export type and choose a month:

The CSV includes:
- **Header:** Business name, TIN, currency, tax period
- **Output VAT section:** Each sale with customer name, TIN, invoice number, taxable amount, and VAT amount
- **Input VAT section:** Each purchase with supplier name, TIN, and VAT amount
- **Credit Note section:** Returns with VAT adjustment amounts
- **Summary:** Rate breakdown (Standard 18%, Zero Rated, Exempt), totals, and Net VAT Payable formula
- **URA portal link** for convenient filing

### 23.2 Income Tax Export

Select **"Income Tax"** export type:

The CSV includes:
- Full Profit & Loss breakdown (Revenue, COGS, Expenses, Net Profit)
- 30% Corporate Tax estimate
- 1% Presumptive Tax estimate (for turnover < UGX 150M)
- Quarterly installment schedule

### 23.3 Other Exports

| Export Type | What's Included |
|-------------|----------------|
| **Sales** | All sales with date, amount, payment method, customer, status |
| **Expenses** | All expenses with date, category, amount, description |
| **Inventory** | All products with stock, selling price, cost price, value |
| **Customers** | Customer directory with names, TINs, contacts |
| **Purchases** | Purchase records with supplier, items, costs |
| **Debts** | Outstanding credit balances by customer |

All exports:
- Support date range filtering (Today, Week, Month, 3/6 Months, Year, All)
- Generate standard CSV files
- Open the device share sheet for sending via email, WhatsApp, or saving

---

## 24. Administration (Admin Only)

These features are only available to users with the **Admin** role.

### 24.1 Managing Branches

Go to Settings → **"Manage Branches"**.

1. View all existing branches.
2. Tap **"Add Branch"** to create a new location.
3. Enter: Branch Name (required), Location, Phone.
4. Toggle **"EFRIS Enabled"** if this branch should fiscalize invoices.
5. Tap **"Save"**.

Each branch has its own:
- Inventory (separate stock quantities)
- Sales records
- Expense records
- Cash register sessions

### 24.2 Managing Users & Roles

Go to Settings → **"Manage Users"**.

1. View all current users with their roles and branch assignments.
2. Tap **"Invite User"** to add a team member.
3. Enter: Full Name, Email Address.
4. Select a **Role:**

| Role | Permissions |
|------|-------------|
| **Admin** | Full access to everything — all branches, settings, reports, user management |
| **Branch Manager** | Can view reports, manage inventory, and sell at their assigned branch |
| **Salesperson** | Can sell products and view basic data at their assigned branch only |

5. Select the **Branch** they'll work at.
6. Tap **"Invite"** — they receive an email to create their account.

### 24.3 Product Categories

Go to Settings → **"Product Categories"**.

1. View existing categories.
2. Tap **"Add Category"**.
3. Enter: Category Name, URA Product Code (optional).
4. Tap **"Save"**.

Categories help organize products and are used in EFRIS product classification.

---

## 25. Accounting System

YourBooks Lite uses a **full double-entry bookkeeping** system that runs automatically in the background.

### 25.1 Double-Entry Bookkeeping

Every financial transaction creates a journal entry where **total debits = total credits**. You don't need to understand accounting to use the app — it handles everything automatically.

### 25.2 Chart of Accounts

| Account # | Account Name | Type |
|-----------|-------------|------|
| 1000 | Cash | Asset |
| 1010 | Mobile Money | Asset |
| 1020 | Bank | Asset |
| 1100 | Accounts Receivable | Asset |
| 1200 | Inventory | Asset |
| 1400 | VAT Input | Asset |
| 2100 | VAT Payable | Liability |
| 2200 | Accounts Payable | Liability |
| 3000 | Owner's Equity | Equity |
| 3100 | Retained Earnings | Equity |
| 4000 | Sales Revenue | Revenue |
| 4100 | Sales Discounts | Contra-Revenue |
| 4200 | Sales Returns | Contra-Revenue |
| 5000 | Cost of Goods Sold | Expense |
| 6000 | Operating Expenses | Expense |
| 6001–6009 | Rent, Electricity, Water, Internet, Transport, Salaries, Supplies, Marketing, Repairs | Expense |

### 25.3 AVCO Cost Method

YourBooks uses the **Weighted Average Cost (AVCO)** method to calculate cost of goods:

```
New Avg Cost = (Existing Qty × Old Avg Cost + New Qty × New Unit Cost) ÷ Total Qty
```

**Example:**
- You have 10 units at 5,000 UGX each (avg cost = 5,000)
- You buy 5 more at 6,000 UGX each
- New avg cost = (10 × 5,000 + 5 × 6,000) ÷ 15 = 80,000 ÷ 15 = 5,333 UGX

This avg cost is used to calculate COGS when you sell items.

### 25.4 Automatic Journal Entries

Every transaction creates automatic journal entries:

**Sale (Cash):**
- DR Cash 1,180 / DR Cash → CR Sales Revenue 1,000 + CR VAT Payable 180 + DR COGS 600 / CR Inventory 600

**Sale (Credit):**
- DR Accounts Receivable → CR Sales Revenue + CR VAT Payable + DR COGS / CR Inventory

**Purchase:**
- DR Inventory + DR VAT Input → CR Cash/Bank

**Expense:**
- DR Expense Category → CR Cash/Bank

**Credit Note (Return):**
- DR Sales Returns + DR VAT Payable → CR Cash + DR Inventory / CR COGS

**Debt Payment:**
- DR Cash → CR Accounts Receivable

---

## 26. EFRIS Integration (Optional)

> **Note:** EFRIS is an optional service. Most businesses do not need EFRIS unless they are VAT-registered with URA. EFRIS is not visible in the app unless it has been enabled for your business by YourBooks support.

### 26.1 What is EFRIS?

**EFRIS** (Electronic Fiscal Receipting and Invoicing System) is URA's system for tracking business transactions. If your business is VAT-registered in Uganda, you may need to fiscalize invoices through EFRIS. Contact YourBooks support to discuss whether EFRIS is right for your business.

### 26.2 Enabling EFRIS

EFRIS is set up and managed by the YourBooks team:
1. Contact YourBooks support to request EFRIS activation.
2. Agree on pricing and provide your URA/EFRIS API credentials.
3. The YourBooks team configures EFRIS for your business.
4. Once enabled, all sales are automatically fiscalized.

### 26.3 Fiscalizing Sales

When EFRIS is enabled, every completed sale is automatically:
1. Formatted into an EFRIS invoice payload with:
   - Seller details (business name, TIN)
   - Buyer details (customer name, TIN, buyer type)
   - Line items (product name, quantity, price, tax rate, EFRIS unit code)
   - Payment method (EFRIS payment code mapping)
2. Submitted to the EFRIS middleware
3. A **Fiscal Document Number (FDN)** is returned and stored
4. A **QR code** is generated linking to URA's verification portal
5. The receipt shows all fiscal details

### 26.4 Registering Products

Before a product can appear on a fiscal invoice, it must be registered with EFRIS:
1. Create/edit the product.
2. Set the EFRIS tax category and unit mapping.
3. Tap **"Register with EFRIS"**.

### 26.5 Credit Notes

EFRIS credit notes reference the original invoice and include:
- Original FDN and invoice number
- Items being returned with quantities
- Return reason code
- Per-item tax rate from the original sale

### 26.6 Stock Increase (Purchases)

Purchases are submitted to EFRIS as stock increase notifications, registering incoming goods in the fiscal system.

---

## 27. Subscription Plans & Billing

### Plans

| Feature | Free Trial | Starter | Basic | Pro |
|---------|-----------|---------|-------|-----|
| **Price** | Free (14 days) | 30,000 UGX/mo | 70,000 UGX/mo | 220,000 UGX/mo |
| **POS & Sales** | ✅ | ✅ | ✅ | ✅ |
| **Inventory** | ✅ | ✅ | ✅ | ✅ |
| **Receipts** | ✅ | ✅ | ✅ | ✅ |
| **Reports & Expenses** | ✅ | ❌ | ✅ | ✅ |
| **Multi-Branch** | ✅ | ❌ | ✅ | ✅ |
| **Credit Notes** | ✅ | ❌ | ✅ | ✅ |
| **Full Accounting** | ✅ | ❌ | ❌ | ✅ |
| **Tax Center & Export** | ✅ | ❌ | ❌ | ✅ |
| **Branches** | Unlimited | 1 | Unlimited | Unlimited |
| **Users** | Unlimited | 2 | Unlimited | Unlimited |
| **Products** | Unlimited | 100 | Unlimited | Unlimited |

### Managing Your Subscription

1. Go to Settings → tap your subscription card.
2. View available plans.
3. Select a plan and initiate payment.
4. Confirm the payment.
5. Your subscription activates immediately.

---

## 28. User Roles & Permissions

| Capability | Admin | Branch Manager | Salesperson |
|-----------|-------|---------------|-------------|
| Make sales | ✅ | ✅ | ✅ |
| View own branch inventory | ✅ | ✅ | ✅ |
| Add/edit products | ✅ | ✅ | ❌ |
| Record purchases | ✅ | ✅ | ❌ |
| Record expenses | ✅ | ✅ | ❌ |
| View reports | ✅ | ✅ | ❌ |
| View all branches | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Manage branches | ✅ | ❌ | ❌ |
| Set sales targets | ✅ | ❌ | ❌ |
| Stock transfers | ✅ | ✅ | ❌ |
| Export data | ✅ | ✅ | ❌ |

---

## 29. FAQ

**Q: Do I need internet to use the app?**
A: Yes. YourBooks Lite stores all data in the cloud (Supabase). This ensures your data is always backed up and accessible from any device. If you lose connection, you'll see a "check your internet" warning.

**Q: What is EFRIS and do I need it?**
A: EFRIS is URA's Electronic Fiscal Receipting and Invoicing System. If your business is VAT-registered, you may need it. Contact YourBooks support to discuss enabling EFRIS for your business — pricing is agreed on individually.

**Q: How do I file my monthly VAT return?**
A: Go to Export → select "VAT" → pick the month → tap Export. The CSV has your Output VAT (from sales), Input VAT (from purchases), Credit Note adjustments, and Net VAT Payable. Enter these figures on the URA web portal (efris.ura.go.ug).

**Q: What happens when I sell on credit?**
A: The sale is completed but the amount is recorded as a debt owed by the customer. Go to Dashboard → Debts to see outstanding balances and record payments.

**Q: How are product costs calculated?**
A: YourBooks uses the AVCO (Average Cost) method. Each purchase recalculates the average cost: (existing stock × old avg cost + new qty × new cost) ÷ total qty. This cost is used for COGS and profit calculations.

**Q: Can I have multiple branches?**
A: Yes. Create branches in Settings → Manage Branches. Each branch has separate inventory, sales, and expenses. Admins see all branches; staff see their assigned branch.

**Q: How do I process a return?**
A: Go to Credit Notes → search for the original sale → select items to return → choose a reason → submit. Inventory is restored and accounting entries are reversed.

**Q: How do I export data for my accountant?**
A: Go to Export → choose data type (Sales, Expenses, Inventory, etc.) → set date range → tap Export. A CSV file is generated that can be opened in Excel.

**Q: What's the difference between Basic and Pro mode?**
A: Starter (30K/mo) gives basic POS, inventory, and receipts. Basic (70K/mo) adds reports, expenses, multi-branch, and credit notes. Pro (220K/mo) adds full accounting, tax center, and data export.

**Q: Is my data safe?**
A: Yes. All data is stored in Supabase (cloud database) with Row Level Security. Each business can only access its own data. Data is encrypted in transit and at rest.

---

## 30. Troubleshooting

| Problem | Solution |
|---------|---------|
| **"Loading..." takes too long** | Check your internet connection. Tap "Retry" after 10 seconds. If it persists, sign out and sign back in. |
| **"Sale not found" error** | The sale may have been processed on a different branch. Switch branches in Settings and try again. |
| **EFRIS invoice fails** | Check Settings → EFRIS → Test Connection. Verify your API key is correct. Ensure the product is registered with EFRIS. |
| **Products not showing in Sell** | Make sure you have products in inventory for your current branch. Check Inventory tab. |
| **Low stock alert but product has stock** | Check the reorder level — if set too high, products appear as "low" even with decent stock. |
| **Can't see other branches' data** | Only Admin users can view cross-branch data. Branch Managers and Salespersons see their assigned branch only. |
| **Export fails** | Ensure you have storage permission. Try a smaller date range. Check available device storage. |
| **Cash register variance** | Count the physical cash again. Check if all expenses were recorded. A small variance (< 1%) is normal. |
| **Trial expired** | Go to Settings → Subscription to choose a paid plan. The app restricts access until you subscribe. |
| **QR code not showing on receipt** | QR codes only appear on EFRIS-fiscalized receipts. Ensure EFRIS is enabled and the sale was fiscalized. |

---

*YourBooks Lite — Empowering Uganda's small businesses with simple, powerful accounting.*

*For support, contact: support@yourbooks.app*

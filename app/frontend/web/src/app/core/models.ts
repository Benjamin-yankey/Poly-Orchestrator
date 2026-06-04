// Shared API types for the ShopNow storefront. These mirror the JSON shapes
// returned by the Products/core API and the Cart service.

export interface Product {
  id: number;
  name: string;
  price: number | string;
  category: string;
  icon: string;
  // Base64 data URL of an uploaded product photo. Empty string falls back to the
  // emoji icon. Optional so older payloads still type-check.
  image?: string;
  description: string;
  stock: number;
  // Percentage off (0 = full price). Drives the storefront sale-price display.
  discount_pct?: number;
}

// The price a shopper actually pays, after any product discount, rounded to cents.
export function effectivePrice(p: Pick<Product, 'price' | 'discount_pct'>): number {
  const base = +p.price;
  const pct = p.discount_pct || 0;
  return pct > 0 ? Math.round(base * (1 - pct / 100) * 100) / 100 : base;
}

export function hasDiscount(p: Pick<Product, 'discount_pct'>): boolean {
  return (p.discount_pct || 0) > 0;
}

// RBAC roles, most to least privileged. Must match ROLES in the products API.
export type Role = 'admin' | 'staffing_team' | 'employee' | 'customer';

// Display catalog for the admin "Roles" tab. `manage` flags the write-capable
// role; `access` is a short label shown on the role card.
export interface RoleInfo {
  key: Role;
  label: string;
  access: string;
  description: string;
  manage: boolean;
}

export const ROLE_INFO: RoleInfo[] = [
  {
    key: 'admin',
    label: 'ADMIN',
    access: 'Full access',
    description: "Full system access. Can manage other users' roles.",
    manage: true,
  },
  {
    key: 'staffing_team',
    label: 'STAFFING_TEAM',
    access: 'Read-only',
    description: 'Read-only access to management data.',
    manage: false,
  },
  {
    key: 'employee',
    label: 'EMPLOYEE',
    access: 'Basic',
    description: 'Basic authenticated access. Default role for all provisioned users.',
    manage: false,
  },
  {
    key: 'customer',
    label: 'CUSTOMER',
    access: 'Storefront',
    description: 'Storefront shopper: can browse, buy from the store and sell items on the marketplace.',
    manage: false,
  },
];

// Employee departments — the second RBAC axis. Only meaningful when role ===
// 'employee'. Must match DEPARTMENTS in the products API (app/products/capabilities.js).
export type Department =
  | 'support'
  | 'warehouse'
  | 'marketing'
  | 'order_processing'
  | 'content'
  | 'logistics';

// Operational capabilities an employee can hold. Derived from their department,
// never stored per-user. Must match CAPABILITIES in app/products/capabilities.js.
export type Capability =
  | 'orders.manage'
  | 'returns.manage'
  | 'support.manage'
  | 'products.manage'
  | 'coupons.manage'
  | 'reviews.manage'
  | 'reports.view';

// Department -> capabilities. MIRROR of DEPARTMENT_CAPS in app/products/capabilities.js
// (the backend copy is the real enforcement; this copy only gates the UI). Keep
// the two in sync.
export const DEPARTMENT_CAPS: Record<Department, Capability[]> = {
  support: ['support.manage', 'returns.manage', 'orders.manage', 'reports.view'],
  warehouse: ['products.manage', 'orders.manage', 'reports.view'],
  marketing: ['coupons.manage', 'reviews.manage', 'reports.view'],
  order_processing: ['orders.manage', 'returns.manage', 'reports.view'],
  content: ['products.manage', 'reviews.manage', 'reports.view'],
  logistics: ['orders.manage', 'reports.view'],
};

// Display catalog for the department <select> (admin Users tab) and the employee
// dashboard header.
export interface DepartmentInfo {
  key: Department;
  label: string;
  description: string;
}

export const DEPARTMENT_INFO: DepartmentInfo[] = [
  { key: 'support', label: 'Customer Support', description: 'Tickets, returns and order help.' },
  { key: 'warehouse', label: 'Inventory / Warehouse', description: 'Stock levels and fulfilment.' },
  { key: 'marketing', label: 'Sales & Marketing', description: 'Promotions, coupons and reviews.' },
  { key: 'order_processing', label: 'Order Processing', description: 'Order review, status and returns.' },
  { key: 'content', label: 'Content Management', description: 'Product info, photos and reviews.' },
  { key: 'logistics', label: 'Delivery / Logistics', description: 'Shipping and delivery tracking.' },
];

export function departmentLabel(d?: Department | null): string {
  return DEPARTMENT_INFO.find((x) => x.key === d)?.label ?? '—';
}

// True if a department holds a capability. Admins bypass this (handled in
// AuthService.hasCap); use this helper for raw department checks.
export function departmentHasCap(d: Department | null | undefined, cap: Capability): boolean {
  return !!d && (DEPARTMENT_CAPS[d] ?? []).includes(cap);
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  // Only set for internal employees; drives the employee dashboard's access.
  department?: Department | null;
  created_at?: string;
}

// Payload for updating the signed-in user's own profile.
export interface ProfileUpdate {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface CartItem {
  productId: number;
  name: string;
  price: number | string;
  icon: string;
  qty: number;
}

export interface CartState {
  servedBy: string;
  items: CartItem[];
  count: number;
  subtotal: number;
}

// A wishlist / save-for-later line. Same shape as a cart line; qty is only
// meaningful for save-for-later (wishlist entries omit it).
export interface ShelfItem {
  productId: number;
  name: string;
  price: number | string;
  icon: string;
  qty?: number;
}

export interface ShelfState {
  servedBy: string;
  items: ShelfItem[];
  count: number;
}

export interface PaymentDetails {
  cardNumber: string;
  name: string;
  expiry: string;
  cvc: string;
}

// A saved shipping/billing address in the customer's address book.
export interface Address {
  id: number;
  label: string;
  full_name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  phone: string;
  is_default: boolean;
  created_at?: string;
}

// A card on file. Only the brand, last four digits and expiry are stored —
// never the full number.
export interface PaymentMethod {
  id: number;
  brand: string;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  holder: string;
  is_default: boolean;
  created_at?: string;
}

export interface Order {
  id: number;
  total: number | string;
  status: string;
  payment_ref: string;
  carrier?: string;
  tracking?: string;
  ship_to?: string;
  received_at?: string | null;
  created_at: string;
  customer_email?: string;
  customer_name?: string;
  items?: CartItem[];
}

// Order fulfilment lifecycle — must match ORDER_STATUSES in the products API.
export type OrderStatus =
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export const ORDER_STATUSES: OrderStatus[] = [
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
];

export interface OrderDetail {
  order: Order;
  items: CartItem[];
}

// Return-request lifecycle — must match RETURN_STATUSES in the products API.
export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'refunded';
export const RETURN_STATUSES: ReturnStatus[] = ['requested', 'approved', 'rejected', 'refunded'];

// A customer's return request (their own view).
export interface ReturnRequest {
  id: number;
  order_id: number;
  reason: string;
  status: ReturnStatus;
  created_at: string;
  updated_at: string;
  order_total?: number | string;
}

// A return as seen in the admin queue (with order + customer context).
export interface AdminReturn extends ReturnRequest {
  order_status: string;
  customer_name: string;
  customer_email: string;
}

export interface AdminStats {
  products: number;
  orders: number;
  revenue: number;
  users: number;
  listings: number;
  admins: number;
  customers: number;
  roleCounts: Record<Role, number>;
  totalStock: number;
  stockHealth: { out_of_stock: number; low_stock: number; healthy: number };
  revenueByDay: { day: string; orders: number; revenue: number }[];
  topProducts: { name: string; units: number; revenue: number }[];
  ordersByStatus: { status: string; n: number }[];
}

// A user as seen by the admin Users table (with order activity rolled up).
export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  department?: Department | null;
  active: boolean;
  created_at: string;
  orders: number;
  spent: number;
}

// A product review left by a shopper.
export interface Review {
  id: number;
  rating: number;
  comment: string;
  created_at: string;
  author?: string;
}

// A review as seen in the admin moderation tab (with product + author context).
export interface AdminReview extends Review {
  product_id: number;
  product_name: string;
  author_email: string;
  approved: boolean;
}

// Support-ticket lifecycle — must match TICKET_STATUSES in the products API.
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export const TICKET_STATUSES: TicketStatus[] = ['open', 'pending', 'resolved', 'closed'];

// A support ticket as seen in the customer's list.
export interface SupportTicket {
  id: number;
  subject: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  messages?: number;
}

// One message in a ticket thread. author_role is 'customer' or 'staff'.
export interface SupportMessage {
  id: number;
  author_role: 'customer' | 'staff';
  body: string;
  created_at: string;
  author?: string;
}

// A ticket as seen in the admin support queue (with customer context).
export interface AdminTicket extends SupportTicket {
  customer_name: string;
  customer_email: string;
}

// An in-app notification.
export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
}

// A marketing promo code applied at checkout for a percentage off the order.
export interface Coupon {
  id: number;
  code: string;
  percent_off: number;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

// Editable site content (homepage banner, store name), keyed by setting name.
export type SiteSettings = Record<string, string>;

// One row of the admin audit trail (Security tab).
export interface AuditEntry {
  id: number;
  actor_id: number | null;
  actor_email: string;
  action: string;
  entity: string;
  detail: string;
  created_at: string;
}

// A user-posted marketplace listing. Buyers contact the seller by phone to
// arrange the purchase — these never go through the cart/checkout flow.
export interface Listing {
  id: number;
  title: string;
  price: number | string;
  category: string;
  // Base64 data URL of the seller-uploaded photo. Empty string when none.
  image: string;
  description: string;
  phone: string;
  location: string;
  created_at: string;
  seller_id?: number;
  seller_name?: string;
  seller_email?: string;
}

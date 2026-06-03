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

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
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

export interface PaymentDetails {
  cardNumber: string;
  name: string;
  expiry: string;
  cvc: string;
}

export interface Order {
  id: number;
  total: number | string;
  status: string;
  payment_ref: string;
  carrier?: string;
  tracking?: string;
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
  active: boolean;
  created_at: string;
  orders: number;
  spent: number;
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

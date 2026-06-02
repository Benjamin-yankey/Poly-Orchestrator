// Shared API types for the ShopNow storefront. These mirror the JSON shapes
// returned by the Products/core API and the Cart service.

export interface Product {
  id: number;
  name: string;
  price: number | string;
  category: string;
  icon: string;
  description: string;
  stock: number;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'customer' | 'admin';
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
  created_at: string;
  customer_email?: string;
  customer_name?: string;
  items?: CartItem[];
}

export interface OrderDetail {
  order: Order;
  items: CartItem[];
}

export interface AdminStats {
  products: number;
  orders: number;
  revenue: number;
  users: number;
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AdminReturn,
  AdminReview,
  AdminStats,
  AdminUser,
  AuditEntry,
  CartItem,
  Coupon,
  Listing,
  Order,
  OrderStatus,
  ReturnStatus,
  Role,
} from './models';

// Admin-only operations: dashboard stats, order list, user/role management and
// marketplace moderation. All endpoints sit behind authRequired + adminRequired
// on the Products/core API (proxied via /api/admin*).
@Injectable({ providedIn: 'root' })
export class AdminService {
  constructor(private http: HttpClient) {}

  stats(): Observable<AdminStats> {
    return this.http.get<AdminStats>('/api/admin/stats');
  }

  orders(): Observable<{ orders: Order[] }> {
    return this.http.get<{ orders: Order[] }>('/api/admin/orders');
  }

  // Line items for a single order. The core API allows admins to read any order.
  orderDetail(id: number): Observable<{ order: Order; items: CartItem[] }> {
    return this.http.get<{ order: Order; items: CartItem[] }>(`/api/orders/${id}`);
  }

  // Advance an order's status; carrier/tracking are recorded when shipping.
  setOrderStatus(
    id: number,
    body: { status: OrderStatus; carrier?: string; tracking?: string }
  ): Observable<{ order: Order }> {
    return this.http.put<{ order: Order }>(`/api/admin/orders/${id}/status`, body);
  }

  // ---- users + roles ----
  users(): Observable<{ users: AdminUser[] }> {
    return this.http.get<{ users: AdminUser[] }>('/api/admin/users');
  }

  createUser(payload: {
    email: string;
    password: string;
    name: string;
    role: Role;
  }): Observable<{ user: AdminUser }> {
    return this.http.post<{ user: AdminUser }>('/api/admin/users', payload);
  }

  setRole(id: number, role: Role): Observable<{ user: AdminUser }> {
    return this.http.put<{ user: AdminUser }>(`/api/admin/users/${id}/role`, { role });
  }

  removeUser(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/admin/users/${id}`);
  }

  // Reset any user's password (support flow — no current password needed).
  resetPassword(id: number, newPassword: string): Observable<{ ok: boolean; user: AdminUser }> {
    return this.http.post<{ ok: boolean; user: AdminUser }>(
      `/api/admin/users/${id}/reset-password`,
      { newPassword }
    );
  }

  // Enable/disable a user account (disabled users cannot log in).
  setActive(id: number, active: boolean): Observable<{ user: AdminUser }> {
    return this.http.put<{ user: AdminUser }>(`/api/admin/users/${id}/active`, { active });
  }

  // ---- security / monitoring ----
  audit(limit = 100): Observable<{ entries: AuditEntry[] }> {
    return this.http.get<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=${limit}`);
  }

  // ---- marketplace moderation ----
  listings(): Observable<{ listings: Listing[] }> {
    return this.http.get<{ listings: Listing[] }>('/api/admin/listings');
  }

  removeListing(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/listings/${id}`);
  }

  // ---- marketing / coupons ----
  coupons(): Observable<{ coupons: Coupon[] }> {
    return this.http.get<{ coupons: Coupon[] }>('/api/admin/coupons');
  }

  createCoupon(payload: {
    code: string;
    percent_off: number;
    expires_at?: string | null;
  }): Observable<{ coupon: Coupon }> {
    return this.http.post<{ coupon: Coupon }>('/api/admin/coupons', payload);
  }

  updateCoupon(
    id: number,
    payload: { percent_off?: number; active?: boolean; expires_at?: string | null }
  ): Observable<{ coupon: Coupon }> {
    return this.http.put<{ coupon: Coupon }>(`/api/admin/coupons/${id}`, payload);
  }

  removeCoupon(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/admin/coupons/${id}`);
  }

  // ---- review moderation ----
  reviews(): Observable<{ reviews: AdminReview[] }> {
    return this.http.get<{ reviews: AdminReview[] }>('/api/admin/reviews');
  }

  approveReview(id: number, approved: boolean): Observable<{ review: AdminReview }> {
    return this.http.put<{ review: AdminReview }>(`/api/admin/reviews/${id}/approve`, { approved });
  }

  removeReview(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/admin/reviews/${id}`);
  }

  // ---- returns queue ----
  returns(): Observable<{ returns: AdminReturn[] }> {
    return this.http.get<{ returns: AdminReturn[] }>('/api/admin/returns');
  }

  setReturnStatus(id: number, status: ReturnStatus): Observable<{ return: AdminReturn }> {
    return this.http.put<{ return: AdminReturn }>(`/api/admin/returns/${id}/status`, { status });
  }
}

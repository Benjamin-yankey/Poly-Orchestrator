import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminStats, CartItem, Coupon, Order, OrderDetail, PaymentDetails } from './models';

@Injectable({ providedIn: 'root' })
export class OrderService {
  constructor(private http: HttpClient) {}

  // Checkout: send the cart snapshot + (mock) payment details to the core API.
  // An optional promo code is validated and applied server-side.
  place(
    items: CartItem[],
    payment: PaymentDetails,
    couponCode?: string
  ): Observable<{ order: Order }> {
    return this.http.post<{ order: Order }>('/api/orders', { items, payment, couponCode });
  }

  // Validate a promo code before checkout; resolves with the percent off.
  validateCoupon(code: string): Observable<{ coupon: Coupon }> {
    return this.http.post<{ coupon: Coupon }>('/api/coupons/validate', { code });
  }

  mine(): Observable<{ orders: Order[] }> {
    return this.http.get<{ orders: Order[] }>('/api/orders');
  }

  get(id: number): Observable<OrderDetail> {
    return this.http.get<OrderDetail>(`/api/orders/${id}`);
  }

  // ---- admin ----
  all(): Observable<{ orders: Order[] }> {
    return this.http.get<{ orders: Order[] }>('/api/admin/orders');
  }

  stats(): Observable<AdminStats> {
    return this.http.get<AdminStats>('/api/admin/stats');
  }
}

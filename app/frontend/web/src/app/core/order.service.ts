import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AdminStats,
  CartItem,
  Coupon,
  Order,
  OrderDetail,
  PaymentDetails,
  ReturnRequest,
} from './models';

@Injectable({ providedIn: 'root' })
export class OrderService {
  constructor(private http: HttpClient) {}

  // Checkout: send the cart snapshot + (mock) payment details to the core API.
  // An optional promo code is validated and applied server-side. The shopper may
  // also reference a saved address (addressId) and/or a card on file
  // (paymentMethodId) instead of typing a card.
  place(
    items: CartItem[],
    payment: PaymentDetails,
    opts: { couponCode?: string; addressId?: number; paymentMethodId?: number } = {}
  ): Observable<{ order: Order }> {
    return this.http.post<{ order: Order }>('/api/orders', {
      items,
      payment,
      couponCode: opts.couponCode,
      addressId: opts.addressId,
      paymentMethodId: opts.paymentMethodId,
    });
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

  // Customer confirms an order arrived (marks it received / delivered).
  confirmReceipt(id: number): Observable<{ order: Order }> {
    return this.http.put<{ order: Order }>(`/api/orders/${id}/confirm-receipt`, {});
  }

  // Open a return request against one of the caller's orders.
  requestReturn(id: number, reason: string): Observable<{ return: ReturnRequest }> {
    return this.http.post<{ return: ReturnRequest }>(`/api/orders/${id}/return`, { reason });
  }

  // The caller's own return requests.
  myReturns(): Observable<{ returns: ReturnRequest[] }> {
    return this.http.get<{ returns: ReturnRequest[] }>('/api/returns');
  }

  // ---- admin ----
  all(): Observable<{ orders: Order[] }> {
    return this.http.get<{ orders: Order[] }>('/api/admin/orders');
  }

  stats(): Observable<AdminStats> {
    return this.http.get<AdminStats>('/api/admin/stats');
  }
}

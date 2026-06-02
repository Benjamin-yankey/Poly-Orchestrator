import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminStats, CartItem, Order, OrderDetail, PaymentDetails } from './models';

@Injectable({ providedIn: 'root' })
export class OrderService {
  constructor(private http: HttpClient) {}

  // Checkout: send the cart snapshot + (mock) payment details to the core API.
  place(items: CartItem[], payment: PaymentDetails): Observable<{ order: Order }> {
    return this.http.post<{ order: Order }>('/api/orders', { items, payment });
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

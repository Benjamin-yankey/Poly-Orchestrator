import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Address, PaymentMethod } from './models';

// The customer's saved addresses and payment methods (Products/core API,
// Postgres). All endpoints are owner-scoped behind authRequired.
@Injectable({ providedIn: 'root' })
export class AccountService {
  constructor(private http: HttpClient) {}

  // ---- addresses ----
  addresses(): Observable<{ addresses: Address[] }> {
    return this.http.get<{ addresses: Address[] }>('/api/addresses');
  }

  createAddress(a: Partial<Address>): Observable<{ address: Address }> {
    return this.http.post<{ address: Address }>('/api/addresses', a);
  }

  updateAddress(id: number, a: Partial<Address>): Observable<{ address: Address }> {
    return this.http.put<{ address: Address }>(`/api/addresses/${id}`, a);
  }

  setDefaultAddress(id: number): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`/api/addresses/${id}/default`, {});
  }

  removeAddress(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/addresses/${id}`);
  }

  // ---- payment methods ----
  methods(): Observable<{ methods: PaymentMethod[] }> {
    return this.http.get<{ methods: PaymentMethod[] }>('/api/payment-methods');
  }

  // Adds a card on file — the server keeps only brand + last4 + expiry.
  createMethod(body: {
    cardNumber: string;
    holder: string;
    expiry: string;
    is_default?: boolean;
  }): Observable<{ method: PaymentMethod }> {
    return this.http.post<{ method: PaymentMethod }>('/api/payment-methods', body);
  }

  setDefaultMethod(id: number): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`/api/payment-methods/${id}/default`, {});
  }

  removeMethod(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/payment-methods/${id}`);
  }
}

import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { CartState, Product } from './models';

const EMPTY: CartState = { servedBy: '', items: [], count: 0, subtotal: 0 };

@Injectable({ providedIn: 'root' })
export class CartService {
  // Single source of truth for the cart; the navbar badge and cart page read it.
  readonly state = signal<CartState>(EMPTY);

  constructor(private http: HttpClient) {}

  refresh(): void {
    this.http.get<CartState>('/api/cart').subscribe({
      next: (s) => this.state.set(s),
      error: () => this.state.set(EMPTY),
    });
  }

  reset(): void {
    this.state.set(EMPTY);
  }

  add(p: Product, qty = 1): Observable<CartState> {
    return this.http
      .post<CartState>('/api/cart', {
        productId: p.id,
        name: p.name,
        price: p.price,
        icon: p.icon,
        qty,
      })
      .pipe(tap((s) => this.state.set(s)));
  }

  setQty(productId: number, qty: number): Observable<CartState> {
    return this.http
      .put<CartState>('/api/cart', { productId, qty })
      .pipe(tap((s) => this.state.set(s)));
  }

  remove(productId: number): Observable<CartState> {
    return this.http
      .post<CartState>('/api/cart/remove', { productId })
      .pipe(tap((s) => this.state.set(s)));
  }

  clear(): Observable<CartState> {
    return this.http.delete<CartState>('/api/cart').pipe(tap((s) => this.state.set(s)));
  }
}

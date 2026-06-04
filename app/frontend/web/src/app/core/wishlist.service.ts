import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { Product, ShelfItem, ShelfState } from './models';

const EMPTY: ShelfState = { servedBy: '', items: [], count: 0 };

// Wishlist state lives in the Cart service (Redis). Held in a signal so the nav
// badge and the heart toggles across the storefront stay in sync.
@Injectable({ providedIn: 'root' })
export class WishlistService {
  readonly state = signal<ShelfState>(EMPTY);
  readonly count = computed(() => this.state().count);

  constructor(private http: HttpClient) {}

  refresh(): void {
    this.http.get<ShelfState>('/api/wishlist').subscribe({
      next: (s) => this.state.set(s),
      error: () => this.state.set(EMPTY),
    });
  }

  reset(): void {
    this.state.set(EMPTY);
  }

  // True when the given product is already on the wishlist (drives the heart).
  has(productId: number): boolean {
    return this.state().items.some((i) => i.productId === productId);
  }

  add(p: Product): Observable<ShelfState> {
    return this.http
      .post<ShelfState>('/api/wishlist', { productId: p.id, name: p.name, price: p.price, icon: p.icon })
      .pipe(tap((s) => this.state.set(s)));
  }

  remove(productId: number): Observable<ShelfState> {
    return this.http
      .post<ShelfState>('/api/wishlist/remove', { productId })
      .pipe(tap((s) => this.state.set(s)));
  }
}

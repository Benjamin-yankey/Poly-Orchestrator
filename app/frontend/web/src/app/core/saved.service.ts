import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { CartItem, ShelfState } from './models';

const EMPTY: ShelfState = { servedBy: '', items: [], count: 0 };

// Save-for-later state (Cart service / Redis): cart lines parked off to the side,
// keeping their quantity. Surfaced only on the cart page.
@Injectable({ providedIn: 'root' })
export class SavedService {
  readonly state = signal<ShelfState>(EMPTY);

  constructor(private http: HttpClient) {}

  refresh(): void {
    this.http.get<ShelfState>('/api/saved').subscribe({
      next: (s) => this.state.set(s),
      error: () => this.state.set(EMPTY),
    });
  }

  reset(): void {
    this.state.set(EMPTY);
  }

  // Park a cart line for later (keeps its quantity).
  save(it: CartItem): Observable<ShelfState> {
    return this.http
      .post<ShelfState>('/api/saved', {
        productId: it.productId,
        name: it.name,
        price: it.price,
        icon: it.icon,
        qty: it.qty,
      })
      .pipe(tap((s) => this.state.set(s)));
  }

  remove(productId: number): Observable<ShelfState> {
    return this.http
      .post<ShelfState>('/api/saved/remove', { productId })
      .pipe(tap((s) => this.state.set(s)));
  }
}

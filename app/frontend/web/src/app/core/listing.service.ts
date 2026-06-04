import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Listing } from './models';

// Talks to the Products/core API's marketplace endpoints (proxied via /api).
@Injectable({ providedIn: 'root' })
export class ListingService {
  constructor(private http: HttpClient) {}

  list(search = '', category = 'All'): Observable<{ servedBy: string; listings: Listing[] }> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    if (category && category !== 'All') params = params.set('category', category);
    return this.http.get<{ servedBy: string; listings: Listing[] }>('/api/listings', { params });
  }

  categories(): Observable<{ categories: string[] }> {
    return this.http.get<{ categories: string[] }>('/api/listings/categories');
  }

  // The admin-managed category list (includes categories with no listings yet),
  // used to populate the Category dropdown on the sell form.
  managedCategories(): Observable<{ categories: { id: number; name: string }[] }> {
    return this.http.get<{ categories: { id: number; name: string }[] }>('/api/listings/all-categories');
  }

  get(id: number): Observable<{ listing: Listing }> {
    return this.http.get<{ listing: Listing }>(`/api/listings/${id}`);
  }

  // ---- authenticated (any logged-in user) ----
  mine(): Observable<{ listings: Listing[] }> {
    return this.http.get<{ listings: Listing[] }>('/api/listings/mine');
  }

  create(l: Partial<Listing>): Observable<{ listing: Listing }> {
    return this.http.post<{ listing: Listing }>('/api/listings', l);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/listings/${id}`);
  }
}

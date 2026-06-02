import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Product } from './models';

@Injectable({ providedIn: 'root' })
export class ProductService {
  constructor(private http: HttpClient) {}

  list(search = '', category = 'All'): Observable<{ servedBy: string; products: Product[] }> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);
    if (category && category !== 'All') params = params.set('category', category);
    return this.http.get<{ servedBy: string; products: Product[] }>('/api/products', { params });
  }

  categories(): Observable<{ categories: string[] }> {
    return this.http.get<{ categories: string[] }>('/api/categories');
  }

  get(id: number): Observable<{ product: Product }> {
    return this.http.get<{ product: Product }>(`/api/products/${id}`);
  }

  // ---- admin ----
  create(p: Partial<Product>): Observable<{ product: Product }> {
    return this.http.post<{ product: Product }>('/api/products', p);
  }

  update(id: number, p: Partial<Product>): Observable<{ product: Product }> {
    return this.http.put<{ product: Product }>(`/api/products/${id}`, p);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/products/${id}`);
  }
}

import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProductService } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { AuthService } from '../core/auth.service';
import { Product } from '../core/models';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container">
      <div class="page-head">
        <div>
          <h1>Browse the store</h1>
          <p class="muted">Quality gear for your desk. Served by <code>{{ servedBy() || '…' }}</code>.</p>
        </div>
      </div>

      <div class="toolbar">
        <div class="search">
          <input
            type="search"
            placeholder="Search products…"
            [(ngModel)]="search"
            (ngModelChange)="onSearch()"
          />
        </div>
        <div class="chips">
          @for (c of categories(); track c) {
            <button class="chip" [class.active]="c === category()" (click)="setCategory(c)">{{ c }}</button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="spinner">Loading products…</div>
      } @else if (products().length === 0) {
        <div class="empty"><div class="big">🔍</div><p>No products match your search.</p></div>
      } @else {
        <div class="grid">
          @for (p of products(); track p.id) {
            <div class="card product" (click)="open(p)">
              <div class="icon">{{ p.icon }}</div>
              <div class="cat">{{ p.category }}</div>
              <h3>{{ p.name }}</h3>
              <p class="desc">{{ p.description }}</p>
              <div class="row spread">
                <span class="price">\${{ (+p.price).toFixed(2) }}</span>
                <button class="btn sm" (click)="add(p, $event)">Add</button>
              </div>
            </div>
          }
        </div>
      }

      @if (toast()) { <div class="alert ok" style="position:fixed;bottom:20px;right:20px;z-index:60">{{ toast() }}</div> }
    </div>
  `,
})
export class HomeComponent implements OnInit {
  products = signal<Product[]>([]);
  categories = signal<string[]>(['All']);
  category = signal<string>('All');
  servedBy = signal<string>('');
  loading = signal<boolean>(true);
  toast = signal<string>('');
  search = '';
  private debounce?: any;

  constructor(
    private productSvc: ProductService,
    private cart: CartService,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.productSvc.categories().subscribe((r) => this.categories.set(['All', ...r.categories]));
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.productSvc.list(this.search, this.category()).subscribe({
      next: (r) => {
        this.products.set(r.products);
        this.servedBy.set(r.servedBy);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 250);
  }

  setCategory(c: string): void {
    this.category.set(c);
    this.load();
  }

  open(p: Product): void {
    this.router.navigate(['/product', p.id]);
  }

  add(p: Product, ev: Event): void {
    ev.stopPropagation();
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { redirect: '/' } });
      return;
    }
    this.cart.add(p).subscribe(() => this.flash(`${p.name} added to cart`));
  }

  private flash(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 1800);
  }
}

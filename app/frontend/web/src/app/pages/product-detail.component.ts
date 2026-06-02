import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProductService } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { AuthService } from '../core/auth.service';
import { Product } from '../core/models';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="container">
      <p class="muted"><a routerLink="/">← Back to shop</a></p>
      @if (loading()) {
        <div class="spinner">Loading…</div>
      } @else {
        @if (product(); as p) {
          <div class="detail">
            <div class="hero">{{ p.icon }}</div>
            <div>
              <div class="cat" style="color:var(--brand);font-weight:700;text-transform:uppercase;font-size:.78rem">{{ p.category }}</div>
              <h1 style="margin:6px 0">{{ p.name }}</h1>
              <p class="price" style="font-size:1.6rem">\${{ (+p.price).toFixed(2) }}</p>
              <p style="max-width:560px">{{ p.description }}</p>
              <p class="muted">{{ p.stock > 0 ? p.stock + ' in stock' : 'Out of stock' }}</p>
              <div class="row" style="margin-top:20px">
                <div class="qty">
                  <button (click)="dec()">−</button><span>{{ qty() }}</span><button (click)="inc()">+</button>
                </div>
                <button class="btn" [disabled]="p.stock <= 0" (click)="add(p)">Add to cart</button>
              </div>
              @if (toast()) { <div class="alert ok">{{ toast() }}</div> }
            </div>
          </div>
        } @else {
          <div class="empty"><div class="big">🚫</div><p>Product not found.</p></div>
        }
      }
    </div>
  `,
})
export class ProductDetailComponent implements OnInit {
  product = signal<Product | null>(null);
  loading = signal<boolean>(true);
  qty = signal<number>(1);
  toast = signal<string>('');

  constructor(
    private route: ActivatedRoute,
    private productSvc: ProductService,
    private cart: CartService,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.productSvc.get(id).subscribe({
      next: (r) => {
        this.product.set(r.product);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  inc(): void { this.qty.update((q) => q + 1); }
  dec(): void { this.qty.update((q) => Math.max(1, q - 1)); }

  add(p: Product): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { redirect: '/product/' + p.id } });
      return;
    }
    this.cart.add(p, this.qty()).subscribe(() => {
      this.toast.set(`Added ${this.qty()} × ${p.name} to cart`);
      setTimeout(() => this.toast.set(''), 1800);
    });
  }
}

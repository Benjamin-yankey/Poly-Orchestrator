import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProductService } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { WishlistService } from '../core/wishlist.service';
import { AuthService } from '../core/auth.service';
import { SettingsService } from '../core/settings.service';
import { IconComponent } from '../core/icon.component';
import { Product, effectivePrice, hasDiscount } from '../core/models';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="container">
      <div class="page-head">
        <div>
          <h1>{{ settings.current()['store_name'] || 'Browse the store' }}</h1>
          <p class="muted">
            Welcome to {{ settings.current()['store_name'] || 'ShopNow' }} —
            Everything you need, delivered right to your doorstep.
          </p>
        </div>
      </div>

      @if (settings.current()['banner']) {
        <div class="alert info" style="margin-bottom:18px">
          {{ settings.current()['banner'] }}
        </div>
      }

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
            <button
              class="chip"
              [class.active]="c === category()"
              (click)="setCategory(c)"
            >
              {{ c }}
            </button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="spinner">Loading products…</div>
      } @else if (products().length === 0) {
        <div class="empty">
          <div class="big"><app-icon name="search" [size]="56" /></div>
          <p>No products match your search.</p>
        </div>
      } @else {
        <div class="grid">
          @for (p of products(); track p.id) {
            <div class="card product" (click)="open(p)">
              <div class="media">
                @if (p.image) {
                  <img [src]="p.image" [alt]="p.name" />
                } @else if (p.icon) {
                  <span class="emoji">{{ p.icon }}</span>
                } @else {
                  <app-icon name="image" [size]="44" />
                }
                <button
                  class="wish"
                  [class.on]="wishlist.has(p.id)"
                  (click)="toggleWish(p, $event)"
                  [attr.aria-label]="
                    wishlist.has(p.id)
                      ? 'Remove from wishlist'
                      : 'Add to wishlist'
                  "
                  title="Wishlist"
                >
                  <app-icon name="heart" [size]="18" />
                </button>
              </div>
              <div class="cat">{{ p.category }}</div>
              <h3>{{ p.name }}</h3>
              <p class="desc">{{ p.description }}</p>
              <div class="row spread">
                @if (discounted(p)) {
                  <span class="price"
                    ><s class="muted" style="font-weight:400;font-size:.82rem"
                      >\${{ (+p.price).toFixed(2) }}</s
                    >
                    \${{ eff(p).toFixed(2) }}</span
                  >
                } @else {
                  <span class="price">\${{ (+p.price).toFixed(2) }}</span>
                }
                <button class="btn sm" (click)="add(p, $event)">Add</button>
              </div>
            </div>
          }
        </div>
      }

      @if (toast()) {
        <div
          class="alert ok"
          style="position:fixed;bottom:20px;right:20px;z-index:60"
        >
          {{ toast() }}
        </div>
      }
    </div>
  `,
  styles: [
    `
      .product .media {
        position: relative;
      }
      .wish {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid var(--border);
        color: var(--muted);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        transition:
          color 0.15s,
          transform 0.1s;
      }
      .wish:hover {
        transform: scale(1.08);
        color: var(--danger, #dc2626);
      }
      .wish.on {
        color: #dc2626;
      }
      .wish.on app-icon ::ng-deep svg {
        fill: #dc2626;
      }
    `,
  ],
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

  // Exposed to the template for the sale-price display.
  eff = effectivePrice;
  discounted = hasDiscount;

  constructor(
    private productSvc: ProductService,
    private cart: CartService,
    public wishlist: WishlistService,
    private auth: AuthService,
    public settings: SettingsService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.productSvc
      .categories()
      .subscribe((r) => this.categories.set(['All', ...r.categories]));
    this.settings.load();
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

  // Toggle the product on the wishlist. Like add-to-cart, this requires a login.
  toggleWish(p: Product, ev: Event): void {
    ev.stopPropagation();
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { redirect: '/' } });
      return;
    }
    const op = this.wishlist.has(p.id)
      ? this.wishlist.remove(p.id)
      : this.wishlist.add(p);
    op.subscribe(() =>
      this.flash(
        this.wishlist.has(p.id) ? `Saved ${p.name}` : `Removed ${p.name}`,
      ),
    );
  }

  add(p: Product, ev: Event): void {
    ev.stopPropagation();
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { redirect: '/' } });
      return;
    }
    // Add at the effective (post-discount) price so checkout charges the sale price.
    this.cart
      .add({ ...p, price: this.eff(p) })
      .subscribe(() => this.flash(`${p.name} added to cart`));
  }

  private flash(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 1800);
  }
}

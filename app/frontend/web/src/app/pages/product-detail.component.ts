import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProductService } from '../core/product.service';
import { CartService } from '../core/cart.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../core/icon.component';
import { Product, Review, effectivePrice, hasDiscount } from '../core/models';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="container">
      <p class="muted"><a routerLink="/">&larr; Back to shop</a></p>
      @if (loading()) {
        <div class="spinner">Loading…</div>
      } @else {
        @if (product(); as p) {
          <div class="detail">
            <div class="hero">
              @if (p.image) { <img [src]="p.image" [alt]="p.name" /> }
              @else if (p.icon) { <span class="emoji">{{ p.icon }}</span> }
              @else { <app-icon name="image" [size]="96" /> }
            </div>
            <div>
              <div class="cat" style="color:var(--brand);font-weight:700;text-transform:uppercase;font-size:.78rem">{{ p.category }}</div>
              <h1 style="margin:6px 0">{{ p.name }}</h1>
              @if (discounted(p)) {
                <p class="price" style="font-size:1.6rem">
                  <s class="muted" style="font-weight:400;font-size:1rem">\${{ (+p.price).toFixed(2) }}</s>
                  \${{ eff(p).toFixed(2) }}
                  <span class="tag" style="background:#fef2f2;color:#b91c1c;margin-left:8px">-{{ p.discount_pct }}%</span>
                </p>
              } @else {
                <p class="price" style="font-size:1.6rem">\${{ (+p.price).toFixed(2) }}</p>
              }
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

          <!-- Reviews -->
          <div class="reviews">
            <div class="row spread" style="align-items:baseline">
              <h2 style="margin:0">Customer reviews</h2>
              @if (count() > 0) {
                <span class="muted"><span class="stars">{{ stars(average()) }}</span> {{ average().toFixed(1) }} · {{ count() }} {{ count() === 1 ? 'review' : 'reviews' }}</span>
              }
            </div>

            @if (auth.isLoggedIn()) {
              <div class="card pad" style="margin:14px 0">
                <h3 style="margin-top:0">Write a review</h3>
                @if (reviewMsg()) { <div class="alert ok">{{ reviewMsg() }}</div> }
                @if (reviewErr()) { <div class="alert error">{{ reviewErr() }}</div> }
                <div class="row" style="gap:6px;align-items:center;margin-bottom:10px">
                  <span>Rating:</span>
                  @for (n of [1,2,3,4,5]; track n) {
                    <button type="button" class="star-btn" [class.on]="n <= myRating()" (click)="myRating.set(n)" [attr.aria-label]="n + ' stars'">★</button>
                  }
                </div>
                <textarea rows="3" [(ngModel)]="myComment" placeholder="Share your thoughts about this product"></textarea>
                <button class="btn" style="margin-top:12px" [disabled]="submitting()" (click)="submitReview(p.id)">
                  {{ submitting() ? 'Submitting…' : 'Submit review' }}
                </button>
              </div>
            } @else {
              <p class="muted" style="margin:14px 0"><a routerLink="/login">Sign in</a> to write a review.</p>
            }

            @if (reviews().length) {
              @for (rv of reviews(); track rv.id) {
                <div class="review">
                  <div class="row spread">
                    <strong>{{ rv.author || 'Anonymous' }}</strong>
                    <span class="muted" style="font-size:.82rem">{{ rv.created_at | date: 'mediumDate' }}</span>
                  </div>
                  <div class="stars">{{ stars(rv.rating) }}</div>
                  @if (rv.comment) { <p style="margin:6px 0 0">{{ rv.comment }}</p> }
                </div>
              }
            } @else {
              <p class="muted">No reviews yet — be the first to review this product.</p>
            }
          </div>
        } @else {
          <div class="empty"><div class="big"><app-icon name="x-circle" [size]="56" /></div><p>Product not found.</p></div>
        }
      }
    </div>
  `,
  styles: [
    `.reviews { margin-top:40px; }
     .review { padding:14px 0; border-bottom:1px solid var(--border); }
     .review:last-child { border-bottom:none; }
     .stars { color:#f59e0b; letter-spacing:1px; }
     .card.pad { padding:20px; }
     .star-btn { background:none; border:none; cursor:pointer; font-size:1.5rem; line-height:1; color:var(--border); padding:0 2px; }
     .star-btn.on { color:#f59e0b; }`,
  ],
})
export class ProductDetailComponent implements OnInit {
  product = signal<Product | null>(null);
  loading = signal<boolean>(true);
  qty = signal<number>(1);
  toast = signal<string>('');

  // Reviews state.
  reviews = signal<Review[]>([]);
  average = signal<number>(0);
  count = signal<number>(0);
  myRating = signal<number>(5);
  myComment = '';
  submitting = signal<boolean>(false);
  reviewMsg = signal<string>('');
  reviewErr = signal<string>('');

  // Exposed to the template for the sale-price display.
  eff = effectivePrice;
  discounted = hasDiscount;

  constructor(
    private route: ActivatedRoute,
    private productSvc: ProductService,
    private cart: CartService,
    public auth: AuthService,
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
    this.loadReviews(id);
  }

  // Compact 5-star display, e.g. ★★★★☆.
  stars(rating: number): string {
    const n = Math.max(0, Math.min(5, Math.round(rating)));
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  loadReviews(id: number): void {
    this.productSvc.reviews(id).subscribe((r) => {
      this.reviews.set(r.reviews);
      this.average.set(r.average);
      this.count.set(r.count);
    });
  }

  submitReview(id: number): void {
    this.reviewErr.set('');
    this.reviewMsg.set('');
    this.submitting.set(true);
    this.productSvc.submitReview(id, { rating: this.myRating(), comment: this.myComment.trim() }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.myComment = '';
        this.reviewMsg.set('Thanks! Your review will appear once approved by a moderator.');
      },
      error: (e) => {
        this.submitting.set(false);
        this.reviewErr.set(e?.error?.error || 'Could not submit review.');
      },
    });
  }

  inc(): void { this.qty.update((q) => q + 1); }
  dec(): void { this.qty.update((q) => Math.max(1, q - 1)); }

  add(p: Product): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { redirect: '/product/' + p.id } });
      return;
    }
    this.cart.add({ ...p, price: this.eff(p) }, this.qty()).subscribe(() => {
      this.toast.set(`Added ${this.qty()} × ${p.name} to cart`);
      setTimeout(() => this.toast.set(''), 1800);
    });
  }
}

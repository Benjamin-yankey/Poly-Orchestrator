import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WishlistService } from '../core/wishlist.service';
import { CartService } from '../core/cart.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../core/icon.component';
import { ShelfItem } from '../core/models';

// The shopper's wishlist: products saved to buy later. Each item can be moved
// straight into the cart or removed. Guarded by authGuard.
@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  template: `
    <div class="container">
      <div class="page-head"><h1>Your wishlist</h1></div>

      @if (wishlist.state().items.length === 0) {
        <div class="empty">
          <div class="big"><app-icon name="heart" [size]="56" /></div>
          <p>Your wishlist is empty. Tap the heart on any product to save it here.</p>
          <a class="btn" routerLink="/">Browse the store</a>
        </div>
      } @else {
        <div class="grid">
          @for (it of wishlist.state().items; track it.productId) {
            <div class="card product">
              <a class="media" [routerLink]="['/product', it.productId]">
                @if (it.icon) { <span class="emoji">{{ it.icon }}</span> }
                @else { <app-icon name="image" [size]="44" /> }
              </a>
              <h3><a [routerLink]="['/product', it.productId]">{{ it.name }}</a></h3>
              <div class="row spread actions">
                <span class="price">\${{ (+it.price).toFixed(2) }}</span>
                <div class="row btns">
                  <button class="btn sm" (click)="moveToCart(it)">Add to cart</button>
                  <button class="btn ghost sm danger" (click)="remove(it)">Remove</button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      @if (toast()) { <div class="alert ok" style="position:fixed;bottom:20px;right:20px;z-index:60">{{ toast() }}</div> }
    </div>
  `,
  styles: [
    `.media { display:flex; align-items:center; justify-content:center; height:150px; overflow:hidden;
       border-radius:12px; background:var(--bg); color:var(--muted); margin-bottom:10px; }
     .media .emoji { font-size:3rem; }
     .product h3 a { color:var(--ink); }
     .product h3 a:hover { color:var(--brand); }
     /* Price + actions wrap to a second line on narrow cards instead of cramping. */
     .actions { margin-top:10px; flex-wrap:wrap; gap:10px; }
     .actions .btns { gap:8px; flex-wrap:wrap; }`,
  ],
})
export class WishlistComponent implements OnInit {
  toast = signal('');

  constructor(
    public wishlist: WishlistService,
    private cart: CartService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.wishlist.refresh();
  }

  moveToCart(it: ShelfItem): void {
    this.cart.addShelfItem(it, 1).subscribe(() => {
      this.wishlist.remove(it.productId).subscribe();
      this.flash(`${it.name} moved to cart`);
    });
  }

  remove(it: ShelfItem): void {
    this.wishlist.remove(it.productId).subscribe();
  }

  private flash(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(''), 1800);
  }
}

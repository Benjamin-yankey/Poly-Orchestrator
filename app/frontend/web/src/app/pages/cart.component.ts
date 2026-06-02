import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../core/cart.service';
import { AuthService } from '../core/auth.service';
import { CartItem } from '../core/models';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="container">
      <div class="page-head"><h1>Your cart</h1></div>

      @if (!auth.isLoggedIn()) {
        <div class="empty">
          <div class="big">🔒</div>
          <p>Please <a routerLink="/login" [queryParams]="{ redirect: '/cart' }">sign in</a> to view your cart.</p>
        </div>
      } @else if (cart.state().items.length === 0) {
        <div class="empty">
          <div class="big">🛒</div>
          <p>Your cart is empty.</p>
          <a class="btn" routerLink="/">Start shopping</a>
        </div>
      } @else {
        <div class="layout-2">
          <div class="card" style="padding:6px 22px">
            @for (it of cart.state().items; track it.productId) {
              <div class="cart-line">
                <div class="ic">{{ it.icon }}</div>
                <div>
                  <strong>{{ it.name }}</strong><br />
                  <span class="muted">\${{ (+it.price).toFixed(2) }} each</span>
                </div>
                <div class="qty">
                  <button (click)="setQty(it, it.qty - 1)">−</button>
                  <span>{{ it.qty }}</span>
                  <button (click)="setQty(it, it.qty + 1)">+</button>
                </div>
                <div class="price">\${{ (+it.price * it.qty).toFixed(2) }}</div>
                <button class="btn ghost sm danger" style="color:var(--danger)" (click)="remove(it)">Remove</button>
              </div>
            }
          </div>

          <div class="card summary">
            <h3 style="margin-top:0">Order summary</h3>
            <div class="line"><span class="muted">Items</span><span>{{ cart.state().count }}</span></div>
            <div class="line"><span class="muted">Subtotal</span><span>\${{ cart.state().subtotal.toFixed(2) }}</span></div>
            <div class="line"><span class="muted">Shipping</span><span>Free</span></div>
            <div class="line total"><span>Total</span><span>\${{ cart.state().subtotal.toFixed(2) }}</span></div>
            <button class="btn block" style="margin-top:16px" (click)="checkout()">Proceed to checkout</button>
            <button class="btn ghost block sm" style="margin-top:10px" (click)="clear()">Empty cart</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class CartComponent implements OnInit {
  constructor(public cart: CartService, public auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    if (this.auth.isLoggedIn()) this.cart.refresh();
  }

  setQty(it: CartItem, qty: number): void {
    this.cart.setQty(it.productId, qty).subscribe();
  }

  remove(it: CartItem): void {
    this.cart.remove(it.productId).subscribe();
  }

  clear(): void {
    this.cart.clear().subscribe();
  }

  checkout(): void {
    this.router.navigate(['/checkout']);
  }
}

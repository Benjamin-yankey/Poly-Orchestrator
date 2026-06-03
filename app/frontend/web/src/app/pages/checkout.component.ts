import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../core/cart.service';
import { OrderService } from '../core/order.service';
import { IconComponent } from '../core/icon.component';
import { Order, PaymentDetails } from '../core/models';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="container">
      <div class="page-head"><h1>Checkout</h1></div>

      @if (placed(); as o) {
        <div class="card" style="max-width:560px;margin:0 auto;padding:36px;text-align:center">
          <div style="color:var(--success, #16a34a);display:flex;justify-content:center"><app-icon name="check" [size]="56" /></div>
          <h2>Payment successful</h2>
          <p class="muted">Order <strong>#{{ o.id }}</strong> is confirmed.</p>
          <p>Total charged: <strong>\${{ (+o.total).toFixed(2) }}</strong></p>
          <p class="muted">Payment ref: <code>{{ o.payment_ref }}</code></p>
          <div class="row" style="justify-content:center;margin-top:18px">
            <a class="btn" routerLink="/orders">View my orders</a>
            <a class="btn ghost" routerLink="/">Keep shopping</a>
          </div>
        </div>
      } @else if (cart.state().items.length === 0) {
        <div class="empty"><div class="big"><app-icon name="cart" [size]="56" /></div><p>Your cart is empty.</p><a class="btn" routerLink="/">Shop now</a></div>
      } @else {
        <div class="layout-2">
          <div class="card" style="padding:26px">
            <h3 style="margin-top:0">Payment details</h3>
            <div class="alert info" style="display:flex;align-items:flex-start;gap:8px">
              <app-icon name="card" [size]="18" />
              <span><strong>Mock gateway.</strong> Use any card number — e.g. <code>4242 4242 4242 4242</code>.
              Any number <em>ending in 0000</em> is declined so you can test failures.</span>
            </div>
            @if (error()) { <div class="alert error">{{ error() }}</div> }

            <form (ngSubmit)="pay()">
              <label>Name on card</label>
              <input name="name" [(ngModel)]="payment.name" required />
              <label>Card number</label>
              <input name="cardNumber" [(ngModel)]="payment.cardNumber" placeholder="4242 4242 4242 4242" required />
              <div class="field-row">
                <div><label>Expiry</label><input name="expiry" [(ngModel)]="payment.expiry" placeholder="MM/YY" required /></div>
                <div><label>CVC</label><input name="cvc" [(ngModel)]="payment.cvc" placeholder="123" required /></div>
              </div>
              <button class="btn block success" style="margin-top:20px" [disabled]="loading()">
                {{ loading() ? 'Processing…' : 'Pay $' + cart.state().subtotal.toFixed(2) }}
              </button>
            </form>
          </div>

          <div class="card summary">
            <h3 style="margin-top:0">Your order</h3>
            @for (it of cart.state().items; track it.productId) {
              <div class="line"><span>{{ it.name }} × {{ it.qty }}</span><span>\${{ (+it.price * it.qty).toFixed(2) }}</span></div>
            }
            <div class="line total"><span>Total</span><span>\${{ cart.state().subtotal.toFixed(2) }}</span></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class CheckoutComponent implements OnInit {
  payment: PaymentDetails = { cardNumber: '', name: '', expiry: '', cvc: '' };
  loading = signal(false);
  error = signal('');
  placed = signal<Order | null>(null);

  constructor(public cart: CartService, private orders: OrderService, private router: Router) {}

  ngOnInit(): void {
    this.cart.refresh();
  }

  pay(): void {
    this.error.set('');
    this.loading.set(true);
    this.orders.place(this.cart.state().items, this.payment).subscribe({
      next: (r) => {
        // Order persisted + paid -> empty the cart and show confirmation.
        this.cart.clear().subscribe();
        this.placed.set(r.order);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.error || 'Payment failed. Please try again.');
        this.loading.set(false);
      },
    });
  }
}

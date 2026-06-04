import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../core/cart.service';
import { OrderService } from '../core/order.service';
import { AccountService } from '../core/account.service';
import { IconComponent } from '../core/icon.component';
import { Address, Coupon, Order, PaymentDetails, PaymentMethod } from '../core/models';

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
          <div>
            <!-- Shipping address -->
            <div class="card" style="padding:26px;margin-bottom:18px">
              <div class="row spread"><h3 style="margin-top:0">Shipping address</h3><a class="btn ghost sm" routerLink="/addresses">Manage</a></div>
              @if (addresses().length === 0) {
                <p class="muted">No saved addresses. <a routerLink="/addresses">Add one</a> for faster checkout — or just continue (we'll skip shipping for this mock order).</p>
              } @else {
                @for (a of addresses(); track a.id) {
                  <label class="pick">
                    <input type="radio" name="addr" [value]="a.id" [(ngModel)]="addressId" />
                    <span>
                      <strong>{{ a.label }}</strong> @if (a.is_default) { <span class="muted">· default</span> }<br />
                      <span class="muted">{{ a.full_name }}, {{ a.line1 }}, {{ a.city }} {{ a.postal_code }}</span>
                    </span>
                  </label>
                }
              }
            </div>

            <!-- Payment -->
            <div class="card" style="padding:26px">
              <h3 style="margin-top:0">Payment</h3>
              <div class="alert info" style="display:flex;align-items:flex-start;gap:8px">
                <app-icon name="card" [size]="18" />
                <span><strong>Mock gateway.</strong> Use any card number — e.g. <code>4242 4242 4242 4242</code>.
                Any number <em>ending in 0000</em> is declined so you can test failures.</span>
              </div>
              @if (error()) { <div class="alert error">{{ error() }}</div> }

              @if (methods().length > 0) {
                <label>Pay with</label>
                <select [(ngModel)]="paymentMethodId" name="pm">
                  <option [ngValue]="null">A new card</option>
                  @for (m of methods(); track m.id) {
                    <option [ngValue]="m.id">{{ m.brand }} •••• {{ m.last4 }}{{ m.is_default ? ' (default)' : '' }}</option>
                  }
                </select>
              }

              @if (!paymentMethodId) {
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
                    {{ loading() ? 'Processing…' : 'Pay $' + total().toFixed(2) }}
                  </button>
                </form>
              } @else {
                <p class="muted" style="margin-top:14px">Charging your saved {{ savedLabel() }} card.</p>
                <button class="btn block success" (click)="pay()" [disabled]="loading()">
                  {{ loading() ? 'Processing…' : 'Pay $' + total().toFixed(2) }}
                </button>
              }
            </div>
          </div>

          <div class="card summary">
            <h3 style="margin-top:0">Your order</h3>
            @for (it of cart.state().items; track it.productId) {
              <div class="line"><span>{{ it.name }} × {{ it.qty }}</span><span>\${{ (+it.price * it.qty).toFixed(2) }}</span></div>
            }

            <div style="margin:14px 0">
              <label>Promo code</label>
              <div class="row" style="gap:8px">
                <input name="promo" [(ngModel)]="promo" placeholder="e.g. SAVE10" [disabled]="!!coupon()" style="flex:1" />
                @if (coupon()) {
                  <button type="button" class="btn ghost sm" (click)="clearCoupon()">Remove</button>
                } @else {
                  <button type="button" class="btn ghost sm" (click)="applyCoupon()">Apply</button>
                }
              </div>
              @if (couponMsg()) { <p class="muted" style="margin:6px 0 0;font-size:.82rem">{{ couponMsg() }}</p> }
            </div>

            <div class="line"><span>Subtotal</span><span>\${{ cart.state().subtotal.toFixed(2) }}</span></div>
            @if (coupon(); as c) {
              <div class="line" style="color:var(--accent)"><span>Discount ({{ c.code }} −{{ c.percent_off }}%)</span><span>−\${{ discountAmount().toFixed(2) }}</span></div>
            }
            <div class="line total"><span>Total</span><span>\${{ total().toFixed(2) }}</span></div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `.pick { display:flex; align-items:flex-start; gap:10px; padding:12px; border:1px solid var(--border);
       border-radius:10px; margin-bottom:10px; cursor:pointer; }
     .pick input { width:auto; margin-top:3px; }
     .pick:has(input:checked) { border-color:var(--brand); background:#eef2ff; }`,
  ],
})
export class CheckoutComponent implements OnInit {
  payment: PaymentDetails = { cardNumber: '', name: '', expiry: '', cvc: '' };
  loading = signal(false);
  error = signal('');
  placed = signal<Order | null>(null);

  // Promo code state.
  promo = '';
  coupon = signal<Coupon | null>(null);
  couponMsg = signal('');

  // Saved address + card selection (pre-filled from the account on load).
  addresses = signal<Address[]>([]);
  methods = signal<PaymentMethod[]>([]);
  addressId: number | null = null;
  paymentMethodId: number | null = null;

  constructor(
    public cart: CartService,
    private orders: OrderService,
    private account: AccountService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.cart.refresh();
    this.account.addresses().subscribe((r) => {
      this.addresses.set(r.addresses);
      this.addressId = r.addresses.find((a) => a.is_default)?.id ?? null;
    });
    this.account.methods().subscribe((r) => {
      this.methods.set(r.methods);
      this.paymentMethodId = r.methods.find((m) => m.is_default)?.id ?? null;
    });
  }

  // Label for the currently-selected saved card (for the "Charging your…" line).
  savedLabel(): string {
    const m = this.methods().find((x) => x.id === this.paymentMethodId);
    return m ? `${m.brand} •••• ${m.last4}` : '';
  }

  // The discount applied to the current subtotal, and the resulting total.
  discountAmount(): number {
    const c = this.coupon();
    if (!c) return 0;
    return Math.round(this.cart.state().subtotal * (c.percent_off / 100) * 100) / 100;
  }

  total(): number {
    return Math.max(0, Math.round((this.cart.state().subtotal - this.discountAmount()) * 100) / 100);
  }

  applyCoupon(): void {
    this.couponMsg.set('');
    const code = this.promo.trim();
    if (!code) return;
    this.orders.validateCoupon(code).subscribe({
      next: (r) => {
        this.coupon.set(r.coupon);
        this.couponMsg.set(`Applied ${r.coupon.code} — ${r.coupon.percent_off}% off.`);
      },
      error: (e) => {
        this.coupon.set(null);
        this.couponMsg.set(e?.error?.error || 'That code is not valid.');
      },
    });
  }

  clearCoupon(): void {
    this.coupon.set(null);
    this.promo = '';
    this.couponMsg.set('');
  }

  pay(): void {
    this.error.set('');
    this.loading.set(true);
    this.orders
      .place(this.cart.state().items, this.payment, {
        couponCode: this.coupon()?.code,
        addressId: this.addressId ?? undefined,
        paymentMethodId: this.paymentMethodId ?? undefined,
      })
      .subscribe({
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

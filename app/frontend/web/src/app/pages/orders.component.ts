import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrderService } from '../core/order.service';
import { IconComponent } from '../core/icon.component';
import { CartItem, Order, ReturnRequest } from '../core/models';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePipe, IconComponent],
  template: `
    <div class="container">
      <div class="page-head"><h1>Your orders</h1></div>

      @if (loading()) {
        <div class="spinner">Loading…</div>
      } @else if (orders().length === 0) {
        <div class="empty"><div class="big"><app-icon name="orders" [size]="56" /></div><p>You haven't placed any orders yet.</p><a class="btn" routerLink="/">Shop now</a></div>
      } @else {
        @for (o of orders(); track o.id) {
          <div class="card" style="padding:18px 22px;margin-bottom:14px">
            <div class="row spread" style="cursor:pointer" (click)="toggle(o)">
              <div>
                <strong>Order #{{ o.id }}</strong>
                <span class="tag paid" style="margin-left:10px">{{ o.status }}</span>
                @if (returnFor(o.id); as r) {
                  <span class="tag ret" style="margin-left:6px">return: {{ r.status }}</span>
                }
                @if (o.received_at) { <span class="tag ok" style="margin-left:6px">received</span> }
                <div class="muted" style="font-size:.85rem">{{ o.created_at | date: 'medium' }}</div>
              </div>
              <div class="row">
                <span class="price">\${{ (+o.total).toFixed(2) }}</span>
                <span class="muted" style="display:inline-flex">
                  <app-icon [name]="expanded() === o.id ? 'chevron-up' : 'chevron-down'" [size]="18" />
                </span>
              </div>
            </div>
            @if (expanded() === o.id) {
              <table style="margin-top:12px">
                <thead><tr><th>Item</th><th>Price</th><th>Qty</th><th>Line</th></tr></thead>
                <tbody>
                  @for (it of items(); track it.productId) {
                    <tr>
                      <td>{{ it.name }}</td>
                      <td>\${{ (+it.price).toFixed(2) }}</td>
                      <td>{{ it.qty }}</td>
                      <td>\${{ (+it.price * it.qty).toFixed(2) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <p class="muted" style="margin:10px 0 0">Payment ref: <code>{{ o.payment_ref }}</code></p>
              @if (o.ship_to) { <p class="muted" style="margin:6px 0 0"><app-icon name="location" [size]="14" /> Shipped to: {{ o.ship_to }}</p> }
              @if (o.tracking) { <p class="muted" style="margin:6px 0 0"><app-icon name="orders" [size]="14" /> {{ o.carrier }} tracking: <code>{{ o.tracking }}</code></p> }

              @if (actionMsg()[o.id]; as m) { <div class="alert ok" style="margin-top:12px">{{ m }}</div> }
              @if (actionErr()[o.id]; as e) { <div class="alert error" style="margin-top:12px">{{ e }}</div> }

              <div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
                @if (canConfirm(o)) {
                  <button class="btn ghost sm" (click)="confirmReceipt(o)"><app-icon name="check" [size]="15" /> Confirm receipt</button>
                }
                @if (canReturn(o)) {
                  <button class="btn ghost sm" (click)="openReturn(o)"><app-icon name="return" [size]="15" /> Request return</button>
                }
              </div>

              @if (returningId() === o.id) {
                <div class="card pad" style="margin-top:12px;background:var(--bg)">
                  <label>Reason for return</label>
                  <textarea rows="2" [(ngModel)]="returnReason" placeholder="Tell us what went wrong"></textarea>
                  <div class="row" style="margin-top:10px;gap:8px">
                    <button class="btn sm" [disabled]="submitting()" (click)="submitReturn(o)">{{ submitting() ? 'Submitting…' : 'Submit request' }}</button>
                    <button class="btn ghost sm" (click)="returningId.set(null)">Cancel</button>
                  </div>
                </div>
              } @else {
                @if (returnFor(o.id); as r) {
                  <p class="muted" style="margin:12px 0 0">Return <strong>{{ r.status }}</strong>@if (r.reason) { — "{{ r.reason }}"}.</p>
                }
              }
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `.tag.ret { background:#fef3c7; color:#92400e; }
     .tag.ok { background:#ecfdf5; color:var(--accent, #059669); }
     .card.pad { padding:16px; }`,
  ],
})
export class OrdersComponent implements OnInit {
  orders = signal<Order[]>([]);
  loading = signal(true);
  expanded = signal<number | null>(null);
  items = signal<CartItem[]>([]);

  // Return requests keyed by order id, for the per-order badge + status line.
  returns = signal<Record<number, ReturnRequest>>({});
  returningId = signal<number | null>(null);
  returnReason = '';
  submitting = signal(false);

  // Per-order action feedback.
  actionMsg = signal<Record<number, string>>({});
  actionErr = signal<Record<number, string>>({});

  constructor(private orderSvc: OrderService) {}

  ngOnInit(): void {
    this.load();
    this.loadReturns();
  }

  load(): void {
    this.orderSvc.mine().subscribe({
      next: (r) => {
        this.orders.set(r.orders);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadReturns(): void {
    this.orderSvc.myReturns().subscribe((r) => {
      const map: Record<number, ReturnRequest> = {};
      // The list is newest-first, so the first seen per order is the latest.
      for (const ret of r.returns) if (!map[ret.order_id]) map[ret.order_id] = ret;
      this.returns.set(map);
    });
  }

  returnFor(orderId: number): ReturnRequest | undefined {
    return this.returns()[orderId];
  }

  canConfirm(o: Order): boolean {
    return o.status === 'shipped' && !o.received_at;
  }

  canReturn(o: Order): boolean {
    const r = this.returnFor(o.id);
    const active = r && (r.status === 'requested' || r.status === 'approved');
    return (o.status === 'shipped' || o.status === 'delivered') && !active;
  }

  toggle(o: Order): void {
    if (this.expanded() === o.id) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(o.id);
    this.returningId.set(null);
    this.orderSvc.get(o.id).subscribe((d) => this.items.set(d.items));
  }

  confirmReceipt(o: Order): void {
    this.orderSvc.confirmReceipt(o.id).subscribe({
      next: (r) => {
        this.orders.update((list) => list.map((x) => (x.id === o.id ? r.order : x)));
        this.setMsg(o.id, 'Thanks — receipt confirmed.');
      },
      error: (e) => this.setErr(o.id, e?.error?.error || 'Could not confirm receipt.'),
    });
  }

  openReturn(o: Order): void {
    this.returnReason = '';
    this.returningId.set(o.id);
  }

  submitReturn(o: Order): void {
    this.submitting.set(true);
    this.orderSvc.requestReturn(o.id, this.returnReason.trim()).subscribe({
      next: (r) => {
        this.submitting.set(false);
        this.returningId.set(null);
        this.returns.update((m) => ({ ...m, [o.id]: r.return }));
        this.setMsg(o.id, 'Return requested. We will review it shortly.');
      },
      error: (e) => {
        this.submitting.set(false);
        this.setErr(o.id, e?.error?.error || 'Could not request a return.');
      },
    });
  }

  private setMsg(id: number, msg: string): void {
    this.actionErr.update((m) => ({ ...m, [id]: '' }));
    this.actionMsg.update((m) => ({ ...m, [id]: msg }));
  }

  private setErr(id: number, msg: string): void {
    this.actionMsg.update((m) => ({ ...m, [id]: '' }));
    this.actionErr.update((m) => ({ ...m, [id]: msg }));
  }
}

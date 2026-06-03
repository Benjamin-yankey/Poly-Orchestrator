import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService } from '../core/order.service';
import { IconComponent } from '../core/icon.component';
import { CartItem, Order } from '../core/models';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe, IconComponent],
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
            }
          </div>
        }
      }
    </div>
  `,
})
export class OrdersComponent implements OnInit {
  orders = signal<Order[]>([]);
  loading = signal(true);
  expanded = signal<number | null>(null);
  items = signal<CartItem[]>([]);

  constructor(private orderSvc: OrderService) {}

  ngOnInit(): void {
    this.orderSvc.mine().subscribe({
      next: (r) => {
        this.orders.set(r.orders);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggle(o: Order): void {
    if (this.expanded() === o.id) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(o.id);
    this.orderSvc.get(o.id).subscribe((d) => this.items.set(d.items));
  }
}

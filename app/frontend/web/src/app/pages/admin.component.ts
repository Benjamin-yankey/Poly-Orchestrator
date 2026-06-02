import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../core/product.service';
import { OrderService } from '../core/order.service';
import { AdminStats, Order, Product } from '../core/models';

type Tab = 'products' | 'orders';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="container">
      <div class="page-head"><h1>Admin dashboard</h1></div>

      @if (stats(); as s) {
        <div class="stats">
          <div class="card stat"><div class="n">{{ s.products }}</div><div class="l">Products</div></div>
          <div class="card stat"><div class="n">{{ s.orders }}</div><div class="l">Orders</div></div>
          <div class="card stat"><div class="n">\${{ s.revenue.toFixed(2) }}</div><div class="l">Revenue</div></div>
          <div class="card stat"><div class="n">{{ s.users }}</div><div class="l">Customers</div></div>
        </div>
      }

      <div class="chips" style="margin-bottom:20px">
        <button class="chip" [class.active]="tab() === 'products'" (click)="tab.set('products')">Products</button>
        <button class="chip" [class.active]="tab() === 'orders'" (click)="loadOrders()">Orders</button>
      </div>

      @if (msg()) { <div class="alert ok">{{ msg() }}</div> }
      @if (error()) { <div class="alert error">{{ error() }}</div> }

      @if (tab() === 'products') {
        <div class="layout-2">
          <div class="card" style="padding:6px 20px">
            <table>
              <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead>
              <tbody>
                @for (p of products(); track p.id) {
                  <tr>
                    <td style="font-size:1.4rem">{{ p.icon }}</td>
                    <td>{{ p.name }}</td>
                    <td>{{ p.category }}</td>
                    <td>\${{ (+p.price).toFixed(2) }}</td>
                    <td>{{ p.stock }}</td>
                    <td class="row">
                      <button class="btn ghost sm" (click)="edit(p)">Edit</button>
                      <button class="btn ghost sm" style="color:var(--danger)" (click)="del(p)">Delete</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="card" style="padding:22px">
            <h3 style="margin-top:0">{{ form.id ? 'Edit product' : 'Add product' }}</h3>
            <label>Name</label><input [(ngModel)]="form.name" />
            <label>Icon (emoji)</label><input [(ngModel)]="form.icon" placeholder="📦" />
            <label>Category</label><input [(ngModel)]="form.category" placeholder="Accessories" />
            <label>Description</label><textarea rows="3" [(ngModel)]="form.description"></textarea>
            <div class="field-row">
              <div><label>Price</label><input type="number" step="0.01" [(ngModel)]="form.price" /></div>
              <div><label>Stock</label><input type="number" [(ngModel)]="form.stock" /></div>
            </div>
            <button class="btn block" style="margin-top:16px" (click)="save()">{{ form.id ? 'Save changes' : 'Add product' }}</button>
            @if (form.id) { <button class="btn ghost block sm" style="margin-top:8px" (click)="resetForm()">Cancel</button> }
          </div>
        </div>
      } @else {
        <div class="card" style="padding:6px 20px">
          <table>
            <thead><tr><th>#</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th><th>Ref</th></tr></thead>
            <tbody>
              @for (o of orders(); track o.id) {
                <tr>
                  <td>{{ o.id }}</td>
                  <td>{{ o.customer_name || o.customer_email }}<br /><span class="muted" style="font-size:.8rem">{{ o.customer_email }}</span></td>
                  <td>{{ o.created_at | date: 'short' }}</td>
                  <td><span class="tag paid">{{ o.status }}</span></td>
                  <td>\${{ (+o.total).toFixed(2) }}</td>
                  <td><code>{{ o.payment_ref }}</code></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AdminComponent implements OnInit {
  tab = signal<Tab>('products');
  stats = signal<AdminStats | null>(null);
  products = signal<Product[]>([]);
  orders = signal<Order[]>([]);
  msg = signal('');
  error = signal('');
  form: Partial<Product> = this.blank();

  constructor(private productSvc: ProductService, private orderSvc: OrderService) {}

  ngOnInit(): void {
    this.refreshStats();
    this.loadProducts();
  }

  private blank(): Partial<Product> {
    return { name: '', icon: '📦', category: 'General', description: '', price: 0, stock: 100 };
  }

  refreshStats(): void {
    this.orderSvc.stats().subscribe((s) => this.stats.set(s));
  }

  loadProducts(): void {
    this.productSvc.list().subscribe((r) => this.products.set(r.products));
  }

  loadOrders(): void {
    this.tab.set('orders');
    this.orderSvc.all().subscribe((r) => this.orders.set(r.orders));
  }

  edit(p: Product): void {
    this.form = { ...p, price: +p.price };
    this.error.set('');
  }

  resetForm(): void {
    this.form = this.blank();
  }

  save(): void {
    this.error.set('');
    this.msg.set('');
    const body = { ...this.form, price: Number(this.form.price), stock: Number(this.form.stock) };
    const req = this.form.id
      ? this.productSvc.update(this.form.id, body)
      : this.productSvc.create(body);
    req.subscribe({
      next: () => {
        this.flash(this.form.id ? 'Product updated' : 'Product added');
        this.resetForm();
        this.loadProducts();
        this.refreshStats();
      },
      error: (e) => this.error.set(e?.error?.error || 'Save failed'),
    });
  }

  del(p: Product): void {
    if (!confirm(`Delete "${p.name}"?`)) return;
    this.productSvc.remove(p.id).subscribe({
      next: () => {
        this.flash('Product deleted');
        this.loadProducts();
        this.refreshStats();
      },
      error: (e) => this.error.set(e?.error?.error || 'Delete failed'),
    });
  }

  private flash(m: string): void {
    this.msg.set(m);
    setTimeout(() => this.msg.set(''), 2000);
  }
}

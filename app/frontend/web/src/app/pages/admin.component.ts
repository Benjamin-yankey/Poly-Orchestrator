import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../core/product.service';
import { AdminService } from '../core/admin.service';
import { SupportService } from '../core/support.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../core/icon.component';
import { SettingsService } from '../core/settings.service';
import { formatPrice } from '../core/countries';
import {
  AdminReturn,
  AdminReview,
  AdminStats,
  AdminTicket,
  AdminUser,
  AuditEntry,
  CartItem,
  Coupon,
  Department,
  departmentLabel,
  DEPARTMENT_INFO,
  Listing,
  ListingCategory,
  Order,
  OrderStatus,
  ORDER_STATUSES,
  Product,
  ReturnStatus,
  Role,
  ROLE_INFO,
  SupportMessage,
  TicketStatus,
  TICKET_STATUSES,
} from '../core/models';

type Tab =
  | 'overview'
  | 'products'
  | 'inventory'
  | 'orders'
  | 'returns'
  | 'payments'
  | 'users'
  | 'roles'
  | 'listings'
  | 'listing-categories'
  | 'reviews'
  | 'support'
  | 'coupons'
  | 'security'
  | 'settings';

// Full admin console: a dashboard overview plus management of every store
// resource — catalog products (with photo upload), orders, users + roles and
// marketplace listings. All data comes from the admin endpoints on the core API.
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, IconComponent],
  template: `
    <div class="container admin">
      <div class="page-head">
        <div>
          <h1>Admin console</h1>
          <p class="muted">
            Signed in as {{ auth.user()?.name || auth.user()?.email }} ·
            {{ canManage() ? 'full control of the store' : 'read-only management access' }}.
          </p>
        </div>
      </div>

      @if (!canManage()) {
        <div class="alert info"><app-icon name="lock" [size]="15" /> You're signed in as <b>Staffing Team</b> — this is a read-only view. Changes are disabled.</div>
      }

      <div class="tabbar">
        <button class="tab" [class.active]="tab() === 'overview'" (click)="go('overview')"><app-icon name="admin" [size]="16" /> Dashboard</button>
        <button class="tab" [class.active]="tab() === 'products'" (click)="go('products')"><app-icon name="shop" [size]="16" /> Products</button>
        <button class="tab" [class.active]="tab() === 'inventory'" (click)="go('inventory')"><app-icon name="box" [size]="16" /> Inventory</button>
        <button class="tab" [class.active]="tab() === 'orders'" (click)="go('orders')"><app-icon name="orders" [size]="16" /> Orders</button>
        <button class="tab" [class.active]="tab() === 'returns'" (click)="go('returns')"><app-icon name="return" [size]="16" /> Returns</button>
        <button class="tab" [class.active]="tab() === 'payments'" (click)="go('payments')"><app-icon name="card" [size]="16" /> Payments</button>
        <button class="tab" [class.active]="tab() === 'coupons'" (click)="go('coupons')"><app-icon name="tag" [size]="16" /> Coupons</button>
        <button class="tab" [class.active]="tab() === 'users'" (click)="go('users')"><app-icon name="user" [size]="16" /> Users</button>
        <button class="tab" [class.active]="tab() === 'roles'" (click)="go('roles')"><app-icon name="lock" [size]="16" /> Roles</button>
        <button class="tab" [class.active]="tab() === 'listings'" (click)="go('listings')"><app-icon name="marketplace" [size]="16" /> Listings</button>
        <button class="tab" [class.active]="tab() === 'listing-categories'" (click)="go('listing-categories')"><app-icon name="tag" [size]="16" /> Mkt. categories</button>
        <button class="tab" [class.active]="tab() === 'reviews'" (click)="go('reviews')"><app-icon name="star" [size]="16" /> Reviews</button>
        <button class="tab" [class.active]="tab() === 'support'" (click)="go('support')"><app-icon name="message" [size]="16" /> Support</button>
        <button class="tab" [class.active]="tab() === 'security'" (click)="go('security')"><app-icon name="shield" [size]="16" /> Security</button>
        <button class="tab" [class.active]="tab() === 'settings'" (click)="go('settings')"><app-icon name="settings" [size]="16" /> Settings</button>
      </div>

      @if (msg()) { <div class="alert ok">{{ msg() }}</div> }
      @if (error()) { <div class="alert error">{{ error() }}</div> }

      <!-- ============================ DASHBOARD ============================ -->
      @if (tab() === 'overview') {
        @if (stats(); as s) {
          <div class="stats">
            <div class="card stat"><div class="ico brand"><app-icon name="card" [size]="20" /></div><div><div class="n">\${{ s.revenue.toFixed(2) }}</div><div class="l">Total revenue</div></div></div>
            <div class="card stat"><div class="ico accent"><app-icon name="orders" [size]="20" /></div><div><div class="n">{{ s.orders }}</div><div class="l">Orders</div></div></div>
            <div class="card stat"><div class="ico brand"><app-icon name="shop" [size]="20" /></div><div><div class="n">{{ s.products }}</div><div class="l">Products</div></div></div>
            <div class="card stat"><div class="ico accent"><app-icon name="user" [size]="20" /></div><div><div class="n">{{ s.users }}</div><div class="l">{{ s.customers }} customers · {{ s.admins }} admins</div></div></div>
            <div class="card stat"><div class="ico brand"><app-icon name="marketplace" [size]="20" /></div><div><div class="n">{{ s.listings }}</div><div class="l">Marketplace listings</div></div></div>
            <div class="card stat"><div class="ico" [class.danger]="s.stockHealth.out_of_stock > 0" [class.accent]="s.stockHealth.out_of_stock === 0"><app-icon name="check" [size]="20" /></div><div><div class="n">{{ s.totalStock }}</div><div class="l">Units in stock</div></div></div>
          </div>

          <div class="dash-grid">
            <div class="card pad">
              <div class="card-head"><h3>Revenue · last 14 days</h3><span class="muted">\${{ s.revenue.toFixed(2) }} total</span></div>
              @if (s.revenueByDay.length) {
                <div class="bars">
                  @for (d of s.revenueByDay; track d.day) {
                    <div class="bar-col" [title]="d.day + ': $' + d.revenue.toFixed(2) + ' (' + d.orders + ' orders)'">
                      <div class="bar" [style.height.%]="barHeight(d.revenue)"></div>
                      <span class="bar-x">{{ d.day | date: 'd/M' }}</span>
                    </div>
                  }
                </div>
              } @else { <p class="muted">No orders in the last two weeks.</p> }
            </div>

            <div class="card pad">
              <h3>Stock health</h3>
              <div class="health">
                <div class="health-row"><span class="dot healthy"></span> Healthy (&gt;10)<b>{{ s.stockHealth.healthy }}</b></div>
                <div class="health-row"><span class="dot low"></span> Low (1–10)<b>{{ s.stockHealth.low_stock }}</b></div>
                <div class="health-row"><span class="dot out"></span> Out of stock<b>{{ s.stockHealth.out_of_stock }}</b></div>
              </div>
              <div class="meter">
                <span class="seg healthy" [style.flex]="s.stockHealth.healthy || 0"></span>
                <span class="seg low" [style.flex]="s.stockHealth.low_stock || 0"></span>
                <span class="seg out" [style.flex]="s.stockHealth.out_of_stock || 0"></span>
              </div>
            </div>

            <div class="card pad">
              <h3>Top sellers</h3>
              @if (s.topProducts.length) {
                @for (t of s.topProducts; track t.name) {
                  <div class="top-row">
                    <span class="grow">{{ t.name }}</span>
                    <span class="muted">{{ t.units }} sold</span>
                    <b>\${{ t.revenue.toFixed(2) }}</b>
                  </div>
                }
              } @else { <p class="muted">No sales yet.</p> }
            </div>

            <div class="card pad">
              <div class="card-head"><h3>Recent orders</h3><button class="btn ghost sm" (click)="go('orders')">View all</button></div>
              @if (orders().length) {
                @for (o of orders().slice(0, 6); track o.id) {
                  <div class="top-row">
                    <span class="grow">#{{ o.id }} · {{ o.customer_name || o.customer_email }}</span>
                    <span class="muted">{{ o.created_at | date: 'd MMM' }}</span>
                    <b>\${{ (+o.total).toFixed(2) }}</b>
                  </div>
                }
              } @else { <p class="muted">No orders yet.</p> }
            </div>
          </div>
        } @else { <div class="spinner">Loading dashboard…</div> }
      }

      <!-- ============================ PRODUCTS ============================ -->
      @if (tab() === 'products') {
        <div class="layout-2">
          <div class="card" style="padding:6px 20px">
            <div class="table-scroll">
            <table>
              <thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead>
              <tbody>
                @for (p of products(); track p.id) {
                  <tr>
                    <td>
                      <span class="thumb">
                        @if (p.image) { <img [src]="p.image" [alt]="p.name" /> }
                        @else if (p.icon) { <span class="emoji">{{ p.icon }}</span> }
                        @else { <app-icon name="image" [size]="18" /> }
                      </span>
                    </td>
                    <td>{{ p.name }}</td>
                    <td>{{ p.category }}</td>
                    <td>
                      \${{ (+p.price).toFixed(2) }}
                      @if (p.discount_pct) { <span class="tag status-refunded" style="margin-left:6px">-{{ p.discount_pct }}%</span> }
                    </td>
                    <td><span [class.low-stock]="p.stock <= 10" [class.out-stock]="p.stock === 0">{{ p.stock }}</span></td>
                    <td class="row">
                      @if (canManage()) {
                        <button class="btn ghost sm" (click)="edit(p)">Edit</button>
                        <button class="btn ghost sm" style="color:var(--danger)" (click)="del(p)">Delete</button>
                      } @else { <span class="muted">—</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            </div>
          </div>

          <div class="card" style="padding:22px">
            @if (!canManage()) {
              <h3 style="margin-top:0">Catalog</h3>
              <p class="muted">Read-only access — product editing is disabled for the staffing team.</p>
            } @else {
            <h3 style="margin-top:0">{{ form.id ? 'Edit product' : 'Add product' }}</h3>

            <label>Photo</label>
            <div class="uploader" [class.has-image]="form.image">
              @if (form.image) {
                <img [src]="form.image" alt="Product photo preview" />
                <button type="button" class="remove-img" (click)="clearImage()" aria-label="Remove photo"><app-icon name="x-circle" [size]="18" /></button>
              } @else {
                <label class="dropzone">
                  <app-icon name="image" [size]="28" />
                  <span>Upload a product photo</span>
                  <small class="muted">PNG, JPG or WebP · up to 2 MB</small>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" (change)="onFile($event)" hidden />
                </label>
              }
            </div>

            <label>Name</label><input [(ngModel)]="form.name" />
            <div class="field-row">
              <div><label>Category</label><input [(ngModel)]="form.category" placeholder="Accessories" /></div>
              <div><label>Emoji (fallback)</label><input [(ngModel)]="form.icon" placeholder="📦" maxlength="4" /></div>
            </div>
            <label>Description</label><textarea rows="3" [(ngModel)]="form.description"></textarea>
            <div class="field-row">
              <div><label>Price</label><input type="number" step="0.01" [(ngModel)]="form.price" /></div>
              <div><label>Stock</label><input type="number" [(ngModel)]="form.stock" /></div>
            </div>
            <label>Discount % <span class="muted">(0 = full price)</span></label>
            <input type="number" min="0" max="90" [(ngModel)]="form.discount_pct" />
            <button class="btn block" style="margin-top:16px" (click)="save()">{{ form.id ? 'Save changes' : 'Add product' }}</button>
            @if (form.id) { <button class="btn ghost block sm" style="margin-top:8px" (click)="resetForm()">Cancel</button> }
            }
          </div>
        </div>
      }

      <!-- ============================ INVENTORY ============================ -->
      @if (tab() === 'inventory') {
        <div class="stats" style="margin-bottom:18px">
          <div class="card stat"><div class="ico accent"><app-icon name="check" [size]="20" /></div><div><div class="n">{{ stockHealth().healthy }}</div><div class="l">Healthy (&gt;10)</div></div></div>
          <div class="card stat"><div class="ico" style="background:#fffbeb;color:#b45309"><app-icon name="box" [size]="20" /></div><div><div class="n">{{ stockHealth().low }}</div><div class="l">Low stock (1–10)</div></div></div>
          <div class="card stat"><div class="ico danger"><app-icon name="x-circle" [size]="20" /></div><div><div class="n">{{ stockHealth().out }}</div><div class="l">Out of stock</div></div></div>
        </div>

        @if (!canManage()) { <div class="alert info"><app-icon name="lock" [size]="15" /> Read-only — restocking is disabled for the staffing team.</div> }

        <div class="page-head" style="margin-bottom:14px">
          <label class="row" style="gap:8px; font-size:.9rem; cursor:pointer">
            <input type="checkbox" [ngModel]="lowOnly()" (ngModelChange)="lowOnly.set($event)" /> Show only items needing restock
          </label>
        </div>

        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th></th><th>Product</th><th>Category</th><th>Stock</th><th>Restock</th></tr></thead>
            <tbody>
              @for (p of inventoryRows(); track p.id) {
                <tr>
                  <td><span class="thumb">@if (p.image) { <img [src]="p.image" [alt]="p.name" /> } @else if (p.icon) { <span class="emoji">{{ p.icon }}</span> } @else { <app-icon name="image" [size]="18" /> }</span></td>
                  <td>{{ p.name }}</td>
                  <td>{{ p.category }}</td>
                  <td><span [class.low-stock]="p.stock <= 10 && p.stock > 0" [class.out-stock]="p.stock === 0">{{ p.stock }}</span></td>
                  <td>
                    @if (canManage()) {
                      <div class="row">
                        <input class="stock-in" type="number" min="0" [(ngModel)]="restockQty[p.id]" placeholder="qty" />
                        <button class="btn ghost sm" (click)="setStock(p)">Set</button>
                      </div>
                    } @else { <span class="muted">—</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="5" class="muted center" style="padding:30px">Nothing to restock 🎉</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }

      <!-- ============================ ORDERS ============================ -->
      @if (tab() === 'orders') {
        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th></th><th>#</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th><th>Fulfilment</th></tr></thead>
            <tbody>
              @for (o of orders(); track o.id) {
                <tr>
                  <td>
                    <button class="btn ghost sm icon-only" (click)="toggleOrder(o)" [attr.aria-label]="expanded() === o.id ? 'Collapse' : 'Expand'">
                      <app-icon [name]="expanded() === o.id ? 'chevron-down' : 'chevron-right'" [size]="16" />
                    </button>
                  </td>
                  <td>{{ o.id }}</td>
                  <td>{{ o.customer_name || o.customer_email }}<br /><span class="muted" style="font-size:.8rem">{{ o.customer_email }}</span></td>
                  <td>{{ o.created_at | date: 'short' }}</td>
                  <td><span class="tag" [ngClass]="statusClass(o.status)">{{ o.status }}</span></td>
                  <td>\${{ (+o.total).toFixed(2) }}</td>
                  <td>
                    @if (canManage()) {
                      <div class="row">
                        <select class="role-select" [ngModel]="o.status" (ngModelChange)="changeStatus(o, $event)" [disabled]="busyOrder() === o.id">
                          @for (s of orderStatuses; track s) { <option [value]="s">{{ s }}</option> }
                        </select>
                        @if (o.status !== 'refunded' && o.status !== 'cancelled') {
                          <button class="btn ghost sm" style="color:var(--danger)" [disabled]="busyOrder() === o.id" (click)="refund(o)">Refund</button>
                        }
                      </div>
                    } @else { <span class="muted">—</span> }
                  </td>
                </tr>
                @if (expanded() === o.id) {
                  <tr class="detail-row">
                    <td colspan="7">
                      <div class="order-detail">
                        <div class="od-meta">
                          <span><b>Payment ref</b> <code>{{ o.payment_ref }}</code></span>
                          @if (o.carrier || o.tracking) {
                            <span><b>Shipping</b> {{ o.carrier || '—' }} @if (o.tracking) { · <code>{{ o.tracking }}</code> }</span>
                          }
                        </div>
                        @if (orderItems()[o.id]; as items) {
                          <table class="inner">
                            <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Line</th></tr></thead>
                            <tbody>
                              @for (it of items; track it.name) {
                                <tr>
                                  <td>{{ it.name }}</td>
                                  <td>{{ it.qty }}</td>
                                  <td>\${{ (+it.price).toFixed(2) }}</td>
                                  <td>\${{ (+it.price * it.qty).toFixed(2) }}</td>
                                </tr>
                              }
                            </tbody>
                          </table>
                        } @else { <p class="muted" style="margin:6px 0">Loading items…</p> }
                      </div>
                    </td>
                  </tr>
                }
              } @empty { <tr><td colspan="7" class="muted center" style="padding:30px">No orders yet.</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }

      <!-- ============================ PAYMENTS ============================ -->
      @if (tab() === 'payments') {
        <p class="muted" style="margin-top:0">Transactions from the mock payment gateway. Issue a refund to mark an order refunded.</p>
        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Reference</th><th>State</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              @for (o of orders(); track o.id) {
                <tr>
                  <td>#{{ o.id }}</td>
                  <td>{{ o.customer_name || o.customer_email }}</td>
                  <td>{{ o.created_at | date: 'short' }}</td>
                  <td><code>{{ o.payment_ref }}</code></td>
                  <td><span class="tag" [ngClass]="statusClass(o.status)">{{ o.status === 'refunded' ? 'refunded' : 'captured' }}</span></td>
                  <td>\${{ (+o.total).toFixed(2) }}</td>
                  <td>
                    @if (canManage() && o.status !== 'refunded' && o.status !== 'cancelled') {
                      <button class="btn ghost sm" style="color:var(--danger)" [disabled]="busyOrder() === o.id" (click)="refund(o)">Refund</button>
                    } @else { <span class="muted">—</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="7" class="muted center" style="padding:30px">No transactions yet.</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }

      <!-- ============================ USERS ============================ -->
      @if (tab() === 'users') {
        @if (canManage()) {
          <div class="page-head" style="margin-bottom:16px">
            <p class="muted" style="margin:0">Customers sign up themselves. Create internal accounts (employee, staffing, admin) here.</p>
            <button class="btn sm" (click)="toggleCreate()">
              <app-icon [name]="creating() ? 'x-circle' : 'plus'" [size]="15" /> {{ creating() ? 'Close' : 'Add user' }}
            </button>
          </div>

          @if (creating()) {
            <div class="card pad" style="margin-bottom:18px">
              <h3 style="margin-top:0">Create user</h3>
              <div class="create-grid">
                <div><label>Full name</label><input [(ngModel)]="newUser.name" placeholder="e.g. Kofi Mensah" /></div>
                <div><label>Email</label><input type="email" [(ngModel)]="newUser.email" placeholder="user@shopnow.local" /></div>
                <div><label>Password</label><input type="password" [(ngModel)]="newUser.password" placeholder="At least 6 characters" /></div>
                <div>
                  <label>Role</label>
                  <select [(ngModel)]="newUser.role">
                    @for (r of roleInfo; track r.key) { <option [value]="r.key">{{ r.label }}</option> }
                  </select>
                </div>
                @if (newUser.role === 'employee') {
                  <div>
                    <label>Department</label>
                    <select [(ngModel)]="newUser.department">
                      <option [ngValue]="null">— none —</option>
                      @for (d of departmentInfo; track d.key) { <option [ngValue]="d.key">{{ d.label }}</option> }
                    </select>
                  </div>
                }
              </div>
              <button class="btn" style="margin-top:16px" [disabled]="savingUser()" (click)="createUser()">
                {{ savingUser() ? 'Creating…' : 'Create account' }}
              </button>
            </div>
          }
        }
        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Orders</th><th>Spent</th><th>Joined</th><th>Role management</th></tr></thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr>
                  <td>
                    <strong>{{ u.name || '—' }}</strong>
                    @if (u.id === auth.user()?.id) { <span class="tag you">you</span> }
                    @if (!u.active) { <span class="tag status-cancelled">disabled</span> }
                    <br /><span class="muted" style="font-size:.8rem">{{ u.email }}</span>
                  </td>
                  <td>
                    <span class="tag" [class.role-admin]="u.role === 'admin'" [class.role-cust]="u.role !== 'admin'">{{ roleLabel(u.role) }}</span>
                    @if (u.role === 'employee') {
                      <br /><span class="muted" style="font-size:.78rem">{{ departmentLabel(u.department) }}</span>
                    }
                  </td>
                  <td>{{ u.orders }}</td>
                  <td>\${{ u.spent.toFixed(2) }}</td>
                  <td>{{ u.created_at | date: 'mediumDate' }}</td>
                  <td>
                    @if (canManage()) {
                      <div class="row">
                        <select class="role-select" [ngModel]="u.role"
                                (ngModelChange)="setRole(u, $event)"
                                [disabled]="u.id === auth.user()?.id"
                                title="{{ u.id === auth.user()?.id ? 'You cannot change your own role' : 'Change role' }}">
                          @for (r of roleInfo; track r.key) { <option [value]="r.key">{{ r.label }}</option> }
                        </select>
                        @if (u.role === 'employee') {
                          <select class="role-select" [ngModel]="u.department ?? null"
                                  (ngModelChange)="setDepartment(u, $event)" title="Assign department">
                            <option [ngValue]="null">— no department —</option>
                            @for (d of departmentInfo; track d.key) { <option [ngValue]="d.key">{{ d.label }}</option> }
                          </select>
                        }
                        <button class="btn ghost sm" (click)="resetPwd(u)">Reset PW</button>
                        <button class="btn ghost sm" [disabled]="u.id === auth.user()?.id" (click)="toggleActive(u)">{{ u.active ? 'Disable' : 'Enable' }}</button>
                        <button class="btn ghost sm" style="color:var(--danger)" [disabled]="u.id === auth.user()?.id" (click)="delUser(u)">Delete</button>
                      </div>
                    } @else { <span class="muted">—</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted center" style="padding:30px">No users.</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }

      <!-- ============================ ROLES ============================ -->
      @if (tab() === 'roles') {
        <p class="muted" style="margin-top:0">
          Roles define what each account can do. Only <b>ADMIN</b> can change roles — assign them on the
          <a href="javascript:void(0)" (click)="go('users')">Users</a> tab.
        </p>
        <div class="role-grid">
          @for (r of roleInfo; track r.key) {
            <div class="card role-card" [class.is-admin]="r.manage">
              <div class="role-top">
                <span class="role-name">{{ r.label }}</span>
                <span class="tag" [class.role-admin]="r.manage" [class.role-cust]="!r.manage">{{ r.access }}</span>
              </div>
              <p class="role-desc">{{ r.description }}</p>
              <div class="role-foot">
                <span class="muted"><app-icon name="user" [size]="14" /> {{ roleCount(r.key) }} {{ roleCount(r.key) === 1 ? 'user' : 'users' }}</span>
                @if (r.manage) { <span class="cap"><app-icon name="check" [size]="13" /> Can manage roles</span> }
              </div>
            </div>
          }
        </div>
      }

      <!-- ============================ LISTINGS ============================ -->
      @if (tab() === 'listings') {
        <p class="muted" style="margin-top:0">Marketplace items posted by users. Remove anything that violates store policy.</p>
        @if (listings().length === 0) {
          <div class="empty"><div class="big"><app-icon name="marketplace" [size]="56" /></div><p>No listings posted yet.</p></div>
        } @else {
          <div class="grid">
            @for (l of listings(); track l.id) {
              <div class="card product">
                <div class="media">
                  @if (l.image) { <img [src]="l.image" [alt]="l.title" /> }
                  @else { <app-icon name="image" [size]="44" /> }
                </div>
                <div class="cat">{{ l.category }}</div>
                <h3>{{ l.title }}</h3>
                <div class="seller muted">
                  <span><app-icon name="user" [size]="14" /> {{ l.seller_name }}</span>
                  <span style="font-size:.78rem">{{ l.seller_email }}</span>
                </div>
                <div class="row spread" style="margin-top:12px">
                  <span class="price">{{ listingPrice(l) }}</span>
                  @if (canManage()) { <button class="btn sm danger" (click)="delListing(l)">Remove</button> }
                </div>
              </div>
            }
          </div>
        }
      }
      <!-- ===================== MARKETPLACE CATEGORIES ===================== -->
      @if (tab() === 'listing-categories') {
        <p class="muted" style="margin-top:0">Categories sellers choose from when posting to the marketplace. Separate from the shop catalog.</p>
        @if (catError()) { <div class="alert error">{{ catError() }}</div> }
        @if (canManage()) {
          <div class="row" style="gap:8px;margin-bottom:16px;max-width:420px">
            <input [(ngModel)]="newCategory" placeholder="New category name" (keyup.enter)="addCategory()" style="flex:1" />
            <button class="btn" [disabled]="savingCat()" (click)="addCategory()">Add</button>
          </div>
        }
        @if (listingCategories().length === 0) {
          <div class="empty"><div class="big"><app-icon name="tag" [size]="56" /></div><p>No categories yet.</p></div>
        } @else {
          <table class="data">
            <thead><tr><th>Category</th><th>Listings</th><th></th></tr></thead>
            <tbody>
              @for (c of listingCategories(); track c.id) {
                <tr>
                  <td><strong>{{ c.name }}</strong></td>
                  <td>{{ c.listings || 0 }}</td>
                  <td style="text-align:right">
                    @if (canManage()) { <button class="btn sm danger" (click)="removeCategory(c)">Delete</button> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
      <!-- ============================ REVIEWS ============================ -->
      @if (tab() === 'reviews') {
        <p class="muted" style="margin-top:0">Product reviews await approval before they appear on the storefront.</p>
        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th>Product</th><th>Author</th><th>Rating</th><th>Comment</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (rv of reviews(); track rv.id) {
                <tr>
                  <td>{{ rv.product_name }}</td>
                  <td>{{ rv.author || '—' }}<br /><span class="muted" style="font-size:.8rem">{{ rv.author_email }}</span></td>
                  <td><span class="stars">{{ stars(rv.rating) }}</span></td>
                  <td style="max-width:280px">{{ rv.comment || '—' }}</td>
                  <td><span class="tag" [ngClass]="rv.approved ? 'status-delivered' : 'status-processing'">{{ rv.approved ? 'approved' : 'pending' }}</span></td>
                  <td class="row">
                    @if (canManage()) {
                      <button class="btn ghost sm" (click)="approveReview(rv)">{{ rv.approved ? 'Unapprove' : 'Approve' }}</button>
                      <button class="btn ghost sm" style="color:var(--danger)" (click)="delReview(rv)">Remove</button>
                    } @else { <span class="muted">—</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted center" style="padding:30px">No reviews yet.</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }

      <!-- ============================ RETURNS ============================ -->
      @if (tab() === 'returns') {
        <p class="muted" style="margin-top:0">Customer return requests. Approve or reject them, then mark refunded once the money's back — which flips the order to refunded.</p>
        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Reason</th><th>Requested</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (r of returns(); track r.id) {
                <tr>
                  <td>#{{ r.order_id }}<br /><span class="muted" style="font-size:.8rem">\${{ (+(r.order_total || 0)).toFixed(2) }}</span></td>
                  <td>{{ r.customer_name || '—' }}<br /><span class="muted" style="font-size:.8rem">{{ r.customer_email }}</span></td>
                  <td style="max-width:260px">{{ r.reason || '—' }}</td>
                  <td>{{ r.created_at | date: 'short' }}</td>
                  <td><span class="tag" [ngClass]="returnTagClass(r.status)">{{ r.status }}</span></td>
                  <td class="row">
                    @if (canManage()) {
                      @if (r.status === 'requested') {
                        <button class="btn ghost sm" (click)="setReturn(r, 'approved')">Approve</button>
                        <button class="btn ghost sm" style="color:var(--danger)" (click)="setReturn(r, 'rejected')">Reject</button>
                      } @else if (r.status === 'approved') {
                        <button class="btn ghost sm" (click)="setReturn(r, 'refunded')">Mark refunded</button>
                      } @else { <span class="muted">—</span> }
                    } @else { <span class="muted">—</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted center" style="padding:30px">No return requests.</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }

      <!-- ============================ SUPPORT ============================ -->
      @if (tab() === 'support') {
        <p class="muted" style="margin-top:0">Customer support tickets. Open a thread to reply{{ canManage() ? '' : ' (read-only)' }} and set its status.</p>
        <div class="layout-2">
          <div class="card" style="padding:6px 16px">
            <div class="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Customer</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                @for (t of tickets(); track t.id) {
                  <tr style="cursor:pointer" [class.sel]="activeTicket() === t.id" (click)="openTicket(t)">
                    <td>{{ t.subject }}<br /><span class="muted" style="font-size:.8rem">{{ t.messages }} message(s)</span></td>
                    <td>{{ t.customer_name || '—' }}<br /><span class="muted" style="font-size:.8rem">{{ t.customer_email }}</span></td>
                    <td><span class="tag" [ngClass]="ticketTagClass(t.status)">{{ t.status }}</span></td>
                    <td>{{ t.updated_at | date: 'short' }}</td>
                  </tr>
                } @empty { <tr><td colspan="4" class="muted center" style="padding:30px">No tickets.</td></tr> }
              </tbody>
            </table>
            </div>
          </div>

          <div class="card pad">
            @if (activeTicket() === null) {
              <p class="muted">Select a ticket to view the conversation.</p>
            } @else {
              <div class="row spread" style="margin-bottom:10px">
                <h3 style="margin:0">Conversation</h3>
                @if (canManage()) {
                  <select [ngModel]="activeStatus()" (ngModelChange)="setTicketStatus($event)">
                    @for (s of ticketStatuses; track s) { <option [value]="s">{{ s }}</option> }
                  </select>
                }
              </div>
              <div class="thread">
                @for (m of ticketMessages(); track m.id) {
                  <div class="msg" [class.staff]="m.author_role === 'staff'">
                    <div class="bubble">
                      <div class="who">{{ m.author_role === 'staff' ? 'Support' : (m.author || 'Customer') }} · <span class="muted">{{ m.created_at | date: 'short' }}</span></div>
                      <p>{{ m.body }}</p>
                    </div>
                  </div>
                }
              </div>
              @if (canManage()) {
                <div class="row" style="gap:8px;margin-top:10px;align-items:flex-start">
                  <textarea rows="2" [(ngModel)]="ticketReply" placeholder="Reply as support…" style="flex:1"></textarea>
                  <button class="btn" [disabled]="replyingTicket()" (click)="replyTicket()">Send</button>
                </div>
              }
            }
          </div>
        </div>
      }

      <!-- ============================ SECURITY ============================ -->
      @if (tab() === 'security') {
        <p class="muted" style="margin-top:0">Audit trail of admin actions and logins — most recent first.</p>
        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              @for (a of audit(); track a.id) {
                <tr>
                  <td>{{ a.created_at | date: 'short' }}</td>
                  <td>{{ a.actor_email || '—' }}</td>
                  <td><code>{{ a.action }}</code></td>
                  <td><span class="muted">{{ a.entity || '—' }}</span></td>
                  <td>{{ a.detail || '—' }}</td>
                </tr>
              } @empty { <tr><td colspan="5" class="muted center" style="padding:30px">No activity recorded yet.</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }
      <!-- ============================ COUPONS ============================ -->
      @if (tab() === 'coupons') {
        <p class="muted" style="margin-top:0">Promo codes shoppers enter at checkout for a percentage off the order total.</p>

        @if (canManage()) {
          <div class="card pad" style="margin-bottom:18px">
            <h3 style="margin-top:0">Create coupon</h3>
            <div class="create-grid">
              <div><label>Code</label><input [(ngModel)]="newCoupon.code" placeholder="e.g. SAVE10" /></div>
              <div><label>Percent off</label><input type="number" min="1" max="100" [(ngModel)]="newCoupon.percent_off" /></div>
              <div><label>Expires (optional)</label><input type="date" [(ngModel)]="newCoupon.expires_at" /></div>
            </div>
            <button class="btn" style="margin-top:16px" (click)="createCoupon()">Create coupon</button>
          </div>
        }

        <div class="card" style="padding:6px 20px">
          <div class="table-scroll">
          <table>
            <thead><tr><th>Code</th><th>Off</th><th>Status</th><th>Expires</th><th>Created</th><th></th></tr></thead>
            <tbody>
              @for (c of coupons(); track c.id) {
                <tr>
                  <td><code>{{ c.code }}</code></td>
                  <td>{{ c.percent_off }}%</td>
                  <td><span class="tag" [ngClass]="c.active ? 'status-delivered' : 'status-cancelled'">{{ c.active ? 'active' : 'inactive' }}</span></td>
                  <td>{{ c.expires_at ? (c.expires_at | date: 'mediumDate') : '—' }}</td>
                  <td>{{ c.created_at | date: 'mediumDate' }}</td>
                  <td class="row">
                    @if (canManage()) {
                      <button class="btn ghost sm" (click)="toggleCoupon(c)">{{ c.active ? 'Disable' : 'Enable' }}</button>
                      <button class="btn ghost sm" style="color:var(--danger)" (click)="delCoupon(c)">Delete</button>
                    } @else { <span class="muted">—</span> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted center" style="padding:30px">No coupons yet.</td></tr> }
            </tbody>
          </table>
          </div>
        </div>
      }

      <!-- ============================ SETTINGS ============================ -->
      @if (tab() === 'settings') {
        <p class="muted" style="margin-top:0">Editable storefront content. Changes appear on the shop home page.</p>
        @if (!canManage()) { <div class="alert info"><app-icon name="lock" [size]="15" /> Read-only — settings can only be changed by an admin.</div> }
        <div class="card pad" style="max-width:620px">
          <label>Store name</label>
          <input [(ngModel)]="settingsForm.store_name" [disabled]="!canManage()" placeholder="ShopNow" />
          <label>Homepage banner</label>
          <textarea rows="3" [(ngModel)]="settingsForm.banner" [disabled]="!canManage()" placeholder="A short announcement shown on the shop home page"></textarea>
          @if (canManage()) {
            <button class="btn" style="margin-top:16px" [disabled]="savingSettings()" (click)="saveSettings()">
              {{ savingSettings() ? 'Saving…' : 'Save settings' }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `.tabbar { display:flex; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--border); margin-bottom:22px; }
     .tab {
       display:inline-flex; align-items:center; gap:7px; background:none; border:none; cursor:pointer;
       padding:11px 14px; font-weight:700; font-size:.9rem; color:var(--muted);
       border-bottom:2px solid transparent; margin-bottom:-1px;
     }
     .tab:hover { color:var(--ink); }
     .tab.active { color:var(--brand); border-bottom-color:var(--brand); }

     .card.pad { padding:20px; }
     .card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
     .card-head h3, .pad h3 { margin:0 0 14px; font-size:1rem; }
     .card-head h3 { margin:0; }

     .stat { display:flex; align-items:center; gap:14px; }
     .stat .ico { width:42px; height:42px; flex:none; border-radius:11px; display:flex; align-items:center; justify-content:center; }
     .stat .ico.brand { background:#eef2ff; color:var(--brand); }
     .stat .ico.accent { background:#ecfdf5; color:var(--accent); }
     .stat .ico.danger { background:#fef2f2; color:var(--danger); }
     .stat .n { font-size:1.45rem; font-weight:800; line-height:1.1; }
     .stat .l { color:var(--muted); font-size:.8rem; }

     .dash-grid { display:grid; grid-template-columns:2fr 1fr; gap:18px; }
     @media (max-width:820px) { .dash-grid { grid-template-columns:1fr; } }

     .bars { display:flex; align-items:flex-end; gap:6px; height:160px; padding-top:8px; }
     .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:6px; }
     .bar { width:100%; min-height:3px; background:linear-gradient(180deg,var(--brand),#818cf8); border-radius:5px 5px 0 0; transition:height .2s ease; }
     .bar-col:hover .bar { background:var(--brand-dark); }
     .bar-x { font-size:.66rem; color:var(--muted); white-space:nowrap; }

     .health { margin-bottom:14px; }
     .health-row { display:flex; align-items:center; gap:8px; padding:5px 0; font-size:.9rem; }
     .health-row b { margin-left:auto; }
     .dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
     .dot.healthy, .seg.healthy { background:var(--accent); }
     .dot.low, .seg.low { background:var(--warn); }
     .dot.out, .seg.out { background:var(--danger); }
     .meter { display:flex; height:10px; border-radius:999px; overflow:hidden; background:var(--bg); }
     .meter .seg { min-width:0; }

     .top-row { display:flex; align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid var(--border); font-size:.9rem; }
     .top-row:last-child { border-bottom:none; }
     .top-row .grow { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

     .thumb { width:34px; height:34px; border-radius:8px; overflow:hidden; display:inline-flex; align-items:center; justify-content:center; background:var(--bg); border:1px solid var(--border); color:var(--muted); }
     .thumb img { width:100%; height:100%; object-fit:cover; }
     .thumb .emoji { font-size:1.2rem; line-height:1; }
     .low-stock { color:var(--warn); font-weight:700; }
     .out-stock { color:var(--danger); font-weight:700; }

     .tag.you { background:#eef2ff; color:var(--brand); margin-left:6px; }
     .tag.role-admin { background:#eef2ff; color:var(--brand); }
     .tag.role-cust { background:var(--bg); color:var(--muted); }

     /* Order lifecycle pills */
     .tag.status-paid       { background:#eff6ff; color:#1d4ed8; }
     .tag.status-processing { background:#fffbeb; color:#b45309; }
     .tag.status-shipped    { background:#eef2ff; color:#4338ca; }
     .tag.status-delivered  { background:#ecfdf5; color:#047857; }
     .tag.status-cancelled  { background:#f3f4f6; color:#6b7280; }
     .tag.status-refunded   { background:#fef2f2; color:#b91c1c; }

     .icon-only { padding:4px 6px; }
     .detail-row > td { background:var(--bg); padding:0 16px 14px; }
     .order-detail { padding:6px 2px; }
     .od-meta { display:flex; flex-wrap:wrap; gap:18px; padding:8px 0 12px; font-size:.85rem; }
     .od-meta b { color:var(--muted); font-weight:600; margin-right:4px; }
     table.inner { width:100%; font-size:.86rem; }
     table.inner th { color:var(--muted); font-weight:600; text-align:left; }
     .stock-in { width:90px; padding:6px 8px; border-radius:8px; }
     .stars { color:#f59e0b; letter-spacing:1px; white-space:nowrap; }

     .role-select { padding:6px 8px; border-radius:8px; font-size:.84rem; min-width:130px; }

     .create-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:0 16px; }
     @media (max-width:560px) { .create-grid { grid-template-columns:1fr; } }

     .role-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:16px; }
     .role-card { padding:20px; display:flex; flex-direction:column; gap:10px; }
     .role-card.is-admin { border-color:var(--brand); box-shadow:0 0 0 1px var(--brand) inset, var(--shadow); }
     .role-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
     .role-name { font-weight:800; font-size:.95rem; letter-spacing:.02em; }
     .role-desc { color:var(--muted); font-size:.88rem; margin:0; flex:1; }
     .role-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:.8rem; padding-top:10px; border-top:1px solid var(--border); }
     .role-foot .muted { display:inline-flex; align-items:center; gap:5px; }
     .role-foot .cap { display:inline-flex; align-items:center; gap:4px; color:var(--accent); font-weight:700; }

     .seller { display:flex; flex-direction:column; gap:3px; font-size:.82rem; }
     .seller span { display:inline-flex; align-items:center; gap:4px; }

     .uploader { position:relative; margin-bottom:6px; }
     .dropzone { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; text-align:center; padding:22px 14px; cursor:pointer; color:var(--muted); border:1px dashed var(--border); border-radius:12px; background:var(--bg); }
     .dropzone:hover { border-color:var(--brand); color:var(--brand); }
     .dropzone small { font-size:.76rem; }
     .uploader img { width:100%; max-height:180px; object-fit:cover; border-radius:12px; border:1px solid var(--border); display:block; }
     .remove-img { position:absolute; top:10px; right:10px; width:30px; height:30px; padding:0; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; border:none; border-radius:999px; background:rgba(16,24,40,.65); color:#fff; }

     tr.sel { background:#eef2ff; }
     .thread { display:flex; flex-direction:column; gap:10px; max-height:420px; overflow-y:auto; }
     .thread .msg { display:flex; }
     .thread .msg.staff { justify-content:flex-end; }
     .thread .bubble { max-width:80%; background:var(--bg); border:1px solid var(--border); border-radius:12px; padding:9px 13px; }
     .thread .msg.staff .bubble { background:#eef2ff; border-color:#dbe3ff; }
     .thread .bubble .who { font-size:.76rem; font-weight:600; margin-bottom:3px; }
     .thread .bubble p { margin:0; white-space:pre-wrap; }`,
  ],
})
export class AdminComponent implements OnInit {
  // Cap uploads so the base64 payload stays well within the API body limit.
  private static readonly MAX_BYTES = 2 * 1024 * 1024;

  tab = signal<Tab>('overview');
  stats = signal<AdminStats | null>(null);
  products = signal<Product[]>([]);
  orders = signal<Order[]>([]);
  users = signal<AdminUser[]>([]);
  listings = signal<Listing[]>([]);
  listingCategories = signal<ListingCategory[]>([]);
  newCategory = '';
  savingCat = signal(false);
  catError = signal('');
  msg = signal('');
  error = signal('');
  form: Partial<Product> = this.blank();

  // Order management state: which row is expanded, its cached line items, and
  // which order currently has a mutation in flight (disables its controls).
  orderStatuses = ORDER_STATUSES;
  expanded = signal<number | null>(null);
  orderItems = signal<Record<number, CartItem[]>>({});
  busyOrder = signal<number | null>(null);

  // Inventory state: filter to low/out-of-stock, and per-row restock input.
  lowOnly = signal(false);
  restockQty: Record<number, number | null> = {};

  // Security audit trail.
  audit = signal<AuditEntry[]>([]);

  // Marketing: coupons list + create form.
  coupons = signal<Coupon[]>([]);
  newCoupon: { code: string; percent_off: number; expires_at: string } = {
    code: '',
    percent_off: 10,
    expires_at: '',
  };

  // Content: site settings form.
  settingsForm: { store_name: string; banner: string } = { store_name: '', banner: '' };
  savingSettings = signal(false);

  // Review moderation.
  reviews = signal<AdminReview[]>([]);

  // Returns queue.
  returns = signal<AdminReturn[]>([]);

  // Support queue + the open conversation.
  tickets = signal<AdminTicket[]>([]);
  ticketStatuses = TICKET_STATUSES;
  activeTicket = signal<number | null>(null);
  activeStatus = signal<TicketStatus>('open');
  ticketMessages = signal<SupportMessage[]>([]);
  ticketReply = '';
  replyingTicket = signal(false);

  // Role catalog for the Roles tab and the Users role <select>.
  roleInfo = ROLE_INFO;
  // Department catalog for the employee department <select>.
  departmentInfo = DEPARTMENT_INFO;
  departmentLabel = departmentLabel;

  // Admin "create user" form state.
  creating = signal(false);
  savingUser = signal(false);
  newUser: { name: string; email: string; password: string; role: Role; department: Department | null } =
    this.blankUser();

  // Tallest bar in the revenue chart drives the height scale.
  private maxRevenue = computed(() =>
    Math.max(1, ...(this.stats()?.revenueByDay.map((d) => d.revenue) ?? [1]))
  );

  // Live stock-health counts derived from the loaded catalog (Inventory tab).
  stockHealth = computed(() => {
    const ps = this.products();
    return {
      healthy: ps.filter((p) => p.stock > 10).length,
      low: ps.filter((p) => p.stock > 0 && p.stock <= 10).length,
      out: ps.filter((p) => p.stock === 0).length,
    };
  });

  // Catalog rows for the Inventory tab, optionally filtered to items that need a restock.
  inventoryRows = computed(() =>
    this.lowOnly() ? this.products().filter((p) => p.stock <= 10) : this.products()
  );

  constructor(
    private productSvc: ProductService,
    private admin: AdminService,
    private support: SupportService,
    private settingsSvc: SettingsService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.refreshStats();
    this.loadOrders();
    this.loadProducts();
  }

  go(tab: Tab): void {
    this.tab.set(tab);
    this.error.set('');
    // The Roles tab shows per-role user counts, so it needs the users loaded too.
    if ((tab === 'users' || tab === 'roles') && this.users().length === 0) this.loadUsers();
    if (tab === 'listings' && this.listings().length === 0) this.loadListings();
    if (tab === 'listing-categories') this.loadListingCategories();
    if (tab === 'security') this.loadAudit();
    if (tab === 'coupons') this.loadCoupons();
    if (tab === 'settings') this.loadSettings();
    if (tab === 'reviews') this.loadReviews();
    if (tab === 'returns') this.loadReturns();
    if (tab === 'support') this.loadTickets();
  }

  // Compact 5-star display, e.g. ★★★★☆.
  stars(rating: number): string {
    const n = Math.max(0, Math.min(5, Math.round(rating)));
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  // Admins have full control; the staffing team gets a read-only view.
  canManage(): boolean {
    return this.auth.isAdmin();
  }

  roleLabel(role: Role): string {
    return this.roleInfo.find((r) => r.key === role)?.label ?? role;
  }

  roleCount(role: Role): number {
    return this.stats()?.roleCounts?.[role] ?? this.users().filter((u) => u.role === role).length;
  }

  barHeight(revenue: number): number {
    return Math.max(3, Math.round((revenue / this.maxRevenue()) * 100));
  }

  // ---- loaders ----
  refreshStats(): void {
    this.admin.stats().subscribe((s) => this.stats.set(s));
  }
  loadProducts(): void {
    this.productSvc.list().subscribe((r) => this.products.set(r.products));
  }
  loadOrders(): void {
    this.admin.orders().subscribe((r) => this.orders.set(r.orders));
  }
  loadUsers(): void {
    this.admin.users().subscribe((r) => this.users.set(r.users));
  }
  loadListings(): void {
    this.admin.listings().subscribe((r) => this.listings.set(r.listings));
  }
  // Render an admin-listed item's price in its own stored currency.
  listingPrice(l: Listing): string {
    return formatPrice(l.price, l.currency);
  }
  loadListingCategories(): void {
    this.admin.listingCategories().subscribe((r) => this.listingCategories.set(r.categories));
  }
  addCategory(): void {
    const name = this.newCategory.trim();
    this.catError.set('');
    if (!name) return;
    this.savingCat.set(true);
    this.admin.addListingCategory(name).subscribe({
      next: () => {
        this.savingCat.set(false);
        this.newCategory = '';
        this.loadListingCategories();
      },
      error: (e) => {
        this.savingCat.set(false);
        this.catError.set(e?.error?.error || 'Could not add category.');
      },
    });
  }
  removeCategory(c: ListingCategory): void {
    if (!confirm(`Delete the "${c.name}" category?`)) return;
    this.admin.removeListingCategory(c.id).subscribe({
      next: () => this.loadListingCategories(),
      error: (e) => this.catError.set(e?.error?.error || 'Could not delete category.'),
    });
  }
  loadAudit(): void {
    this.admin.audit().subscribe((r) => this.audit.set(r.entries));
  }
  loadCoupons(): void {
    this.admin.coupons().subscribe((r) => this.coupons.set(r.coupons));
  }
  loadSettings(): void {
    this.settingsSvc.get().subscribe((r) => (this.settingsForm = { store_name: '', banner: '', ...r.settings }));
  }
  loadReturns(): void {
    this.admin.returns().subscribe((r) => this.returns.set(r.returns));
  }

  // ---- returns ----
  returnTagClass(status: string): string {
    return {
      requested: 'status-processing',
      approved: 'status-delivered',
      rejected: 'status-cancelled',
      refunded: 'status-cancelled',
    }[status] || '';
  }

  setReturn(r: AdminReturn, status: ReturnStatus): void {
    this.error.set('');
    this.admin.setReturnStatus(r.id, status).subscribe({
      next: () => {
        this.flash(`Return #${r.id} marked ${status}`);
        this.loadReturns();
        if (status === 'refunded') this.loadOrders();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not update return'),
    });
  }

  // ---- support ----
  loadTickets(): void {
    this.support.all().subscribe((r) => this.tickets.set(r.tickets));
  }

  ticketTagClass(status: string): string {
    return {
      open: 'status-processing',
      pending: 'status-processing',
      resolved: 'status-delivered',
      closed: 'status-cancelled',
    }[status] || '';
  }

  openTicket(t: AdminTicket): void {
    this.activeTicket.set(t.id);
    this.activeStatus.set(t.status);
    this.ticketReply = '';
    this.support.get(t.id).subscribe((r) => this.ticketMessages.set(r.messages));
  }

  replyTicket(): void {
    const id = this.activeTicket();
    const body = this.ticketReply.trim();
    if (id === null || !body) return;
    this.replyingTicket.set(true);
    this.support.reply(id, body).subscribe({
      next: (r) => {
        this.replyingTicket.set(false);
        this.ticketReply = '';
        this.ticketMessages.update((list) => [...list, r.message]);
        this.activeStatus.set('pending');
        this.loadTickets();
      },
      error: (e) => {
        this.replyingTicket.set(false);
        this.error.set(e?.error?.error || 'Could not send reply');
      },
    });
  }

  setTicketStatus(status: TicketStatus): void {
    const id = this.activeTicket();
    if (id === null) return;
    this.support.setStatus(id, status).subscribe({
      next: () => {
        this.activeStatus.set(status);
        this.loadTickets();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not update ticket'),
    });
  }

  // ---- coupons ----
  createCoupon(): void {
    this.error.set('');
    const c = this.newCoupon;
    if (!c.code.trim()) return this.error.set('Coupon code is required.');
    const pct = Number(c.percent_off);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      return this.error.set('Percent off must be between 1 and 100.');
    }
    this.admin
      .createCoupon({ code: c.code.trim(), percent_off: pct, expires_at: c.expires_at || null })
      .subscribe({
        next: (r) => {
          this.flash(`Coupon ${r.coupon.code} created`);
          this.newCoupon = { code: '', percent_off: 10, expires_at: '' };
          this.loadCoupons();
        },
        error: (e) => this.error.set(e?.error?.error || 'Could not create coupon'),
      });
  }

  toggleCoupon(c: Coupon): void {
    this.error.set('');
    this.admin.updateCoupon(c.id, { active: !c.active }).subscribe({
      next: () => {
        this.flash(`${c.code} ${c.active ? 'disabled' : 'enabled'}`);
        this.loadCoupons();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not update coupon'),
    });
  }

  delCoupon(c: Coupon): void {
    if (!confirm(`Delete coupon "${c.code}"?`)) return;
    this.error.set('');
    this.admin.removeCoupon(c.id).subscribe({
      next: () => {
        this.flash('Coupon deleted');
        this.loadCoupons();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not delete coupon'),
    });
  }

  // ---- settings ----
  saveSettings(): void {
    this.error.set('');
    this.savingSettings.set(true);
    this.settingsSvc.update(this.settingsForm).subscribe({
      next: () => {
        this.savingSettings.set(false);
        this.flash('Settings saved');
      },
      error: (e) => {
        this.savingSettings.set(false);
        this.error.set(e?.error?.error || 'Could not save settings');
      },
    });
  }

  // ---- review moderation ----
  loadReviews(): void {
    this.admin.reviews().subscribe((r) => this.reviews.set(r.reviews));
  }

  approveReview(rv: AdminReview): void {
    this.error.set('');
    this.admin.approveReview(rv.id, !rv.approved).subscribe({
      next: () => {
        this.flash(rv.approved ? 'Review unapproved' : 'Review approved');
        this.loadReviews();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not update review'),
    });
  }

  delReview(rv: AdminReview): void {
    if (!confirm('Remove this review? This cannot be undone.')) return;
    this.error.set('');
    this.admin.removeReview(rv.id).subscribe({
      next: () => {
        this.flash('Review removed');
        this.loadReviews();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not remove review'),
    });
  }

  // ---- inventory ----
  setStock(p: Product): void {
    const qty = Number(this.restockQty[p.id]);
    if (!Number.isFinite(qty) || qty < 0) return this.error.set('Enter a valid stock quantity.');
    this.error.set('');
    this.productSvc.update(p.id, { stock: qty }).subscribe({
      next: () => {
        this.restockQty[p.id] = null;
        this.flash(`${p.name} stock set to ${qty}`);
        this.loadProducts();
        this.refreshStats();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not update stock'),
    });
  }

  // ---- order management ----
  // CSS class for the status pill, so each lifecycle state reads at a glance.
  statusClass(status: string): string {
    return 'status-' + status;
  }

  // Expand/collapse an order row, lazily fetching its line items on first open.
  toggleOrder(o: Order): void {
    if (this.expanded() === o.id) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(o.id);
    if (!this.orderItems()[o.id]) {
      this.admin.orderDetail(o.id).subscribe({
        next: (r) => this.orderItems.update((m) => ({ ...m, [o.id]: r.items })),
        error: (e) => this.error.set(e?.error?.error || 'Could not load order items'),
      });
    }
  }

  changeStatus(o: Order, status: OrderStatus): void {
    if (status === o.status) return;
    const body: { status: OrderStatus; carrier?: string; tracking?: string } = { status };
    // Shipping captures a carrier + tracking number so the customer can follow it.
    if (status === 'shipped') {
      const carrier = prompt('Carrier (e.g. DHL, UPS):', o.carrier || '');
      if (carrier === null) return this.revertOrders();
      const tracking = prompt('Tracking number:', o.tracking || '');
      if (tracking === null) return this.revertOrders();
      body.carrier = carrier;
      body.tracking = tracking;
    } else if ((status === 'cancelled' || status === 'refunded') &&
               !confirm(`Mark order #${o.id} as ${status}?`)) {
      return this.revertOrders();
    }
    this.applyStatus(o, body);
  }

  refund(o: Order): void {
    if (!confirm(`Refund order #${o.id} ($${(+o.total).toFixed(2)})? This marks it refunded.`)) return;
    this.applyStatus(o, { status: 'refunded' });
  }

  private applyStatus(o: Order, body: { status: OrderStatus; carrier?: string; tracking?: string }): void {
    this.error.set('');
    this.busyOrder.set(o.id);
    this.admin.setOrderStatus(o.id, body).subscribe({
      next: (r) => {
        this.busyOrder.set(null);
        this.orders.update((list) => list.map((x) => (x.id === o.id ? { ...x, ...r.order } : x)));
        this.flash(`Order #${o.id} → ${r.order.status}`);
        this.refreshStats();
      },
      error: (e) => {
        this.busyOrder.set(null);
        this.error.set(e?.error?.error || 'Could not update order');
        this.revertOrders();
      },
    });
  }

  // The status <select> binds optimistically; on cancel/error re-emit the list so
  // it snaps back to each order's real status.
  private revertOrders(): void {
    this.orders.update((list) => [...list]);
  }

  // ---- product form ----
  private blank(): Partial<Product> {
    return { name: '', category: 'General', icon: '📦', image: '', description: '', price: 0, stock: 100, discount_pct: 0 };
  }

  edit(p: Product): void {
    this.form = { ...p, price: +p.price };
    this.error.set('');
  }

  resetForm(): void {
    this.form = this.blank();
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return this.error.set('Please choose an image file.');
    if (file.size > AdminComponent.MAX_BYTES) {
      return this.error.set('That image is larger than 2 MB. Please choose a smaller one.');
    }
    this.error.set('');
    const reader = new FileReader();
    reader.onload = () => (this.form.image = reader.result as string);
    reader.readAsDataURL(file);
  }

  clearImage(): void {
    this.form.image = '';
  }

  save(): void {
    this.error.set('');
    this.msg.set('');
    const body = {
      ...this.form,
      price: Number(this.form.price),
      stock: Number(this.form.stock),
      discount_pct: Number(this.form.discount_pct) || 0,
    };
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

  // ---- user / role management ----
  private blankUser(): { name: string; email: string; password: string; role: Role; department: Department | null } {
    return { name: '', email: '', password: '', role: 'employee', department: null };
  }

  toggleCreate(): void {
    this.creating.update((v) => !v);
    this.newUser = this.blankUser();
    this.error.set('');
  }

  createUser(): void {
    this.error.set('');
    const u = this.newUser;
    if (!u.email.trim() || !u.password) return this.error.set('Email and password are required.');
    if (u.password.length < 6) return this.error.set('Password must be at least 6 characters.');
    this.savingUser.set(true);
    this.admin
      .createUser({
        name: u.name.trim(),
        email: u.email.trim(),
        password: u.password,
        role: u.role,
        department: u.role === 'employee' ? u.department : null,
      })
      .subscribe({
        next: (r) => {
          this.savingUser.set(false);
          this.creating.set(false);
          this.flash(`Created ${r.user.email} as ${this.roleLabel(r.user.role)}`);
          this.loadUsers();
          this.refreshStats();
        },
        error: (e) => {
          this.savingUser.set(false);
          this.error.set(e?.error?.error || 'Could not create user');
        },
      });
  }

  setRole(u: AdminUser, role: Role): void {
    this.error.set('');
    if (role === u.role) return;
    if (!confirm(`Change ${u.name || u.email}'s role to ${this.roleLabel(role)}?`)) {
      // Reset the <select> back to the current role (it bound optimistically).
      this.users.update((list) => [...list]);
      return;
    }
    this.admin.setRole(u.id, role).subscribe({
      next: () => {
        this.flash(`${u.name || u.email} is now ${this.roleLabel(role)}`);
        this.loadUsers();
        this.refreshStats();
      },
      error: (e) => {
        this.error.set(e?.error?.error || 'Could not change role');
        this.loadUsers();
      },
    });
  }

  // Assign an employee's department — this is what unlocks their dashboard areas.
  setDepartment(u: AdminUser, department: Department | null): void {
    this.error.set('');
    if ((u.department ?? null) === department) return;
    this.admin.setDepartment(u.id, department).subscribe({
      next: () => {
        this.flash(`${u.name || u.email} → ${this.departmentLabel(department)}`);
        this.loadUsers();
      },
      error: (e) => {
        this.error.set(e?.error?.error || 'Could not change department');
        this.loadUsers();
      },
    });
  }

  delUser(u: AdminUser): void {
    if (!confirm(`Delete user "${u.name || u.email}"? This cannot be undone.`)) return;
    this.error.set('');
    this.admin.removeUser(u.id).subscribe({
      next: () => {
        this.flash('User deleted');
        this.loadUsers();
        this.refreshStats();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not delete user'),
    });
  }

  resetPwd(u: AdminUser): void {
    this.error.set('');
    const pw = prompt(`Set a new password for ${u.name || u.email} (min 6 characters):`, '');
    if (pw === null) return;
    if (pw.length < 6) return this.error.set('Password must be at least 6 characters.');
    this.admin.resetPassword(u.id, pw).subscribe({
      next: () => this.flash(`Password reset for ${u.email}`),
      error: (e) => this.error.set(e?.error?.error || 'Could not reset password'),
    });
  }

  toggleActive(u: AdminUser): void {
    const next = !u.active;
    if (!confirm(`${next ? 'Enable' : 'Disable'} account for ${u.name || u.email}?`)) return;
    this.error.set('');
    this.admin.setActive(u.id, next).subscribe({
      next: () => {
        this.flash(`${u.email} ${next ? 'enabled' : 'disabled'}`);
        this.loadUsers();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not update account'),
    });
  }

  // ---- listing moderation ----
  delListing(l: Listing): void {
    if (!confirm(`Remove listing "${l.title}"?`)) return;
    this.error.set('');
    this.admin.removeListing(l.id).subscribe({
      next: () => {
        this.flash('Listing removed');
        this.loadListings();
        this.refreshStats();
      },
      error: (e) => this.error.set(e?.error?.error || 'Could not remove listing'),
    });
  }

  private flash(m: string): void {
    this.msg.set(m);
    setTimeout(() => this.msg.set(''), 2200);
  }
}

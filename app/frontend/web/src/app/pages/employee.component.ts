import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { AdminService } from '../core/admin.service';
import { SupportService } from '../core/support.service';
import { ProductService } from '../core/product.service';
import { IconComponent } from '../core/icon.component';
import {
  AdminReturn,
  AdminReview,
  AdminStats,
  AdminTicket,
  Capability,
  Coupon,
  departmentLabel,
  Order,
  OrderStatus,
  ORDER_STATUSES,
  Product,
  ReturnStatus,
  RETURN_STATUSES,
  SupportMessage,
  TicketStatus,
  TICKET_STATUSES,
} from '../core/models';

// One operational area of the employee dashboard. `cap` is the capability that
// unlocks it — a tab is only rendered when AuthService.hasCap(cap) is true, so an
// employee sees exactly the areas their department grants (admins see all).
type EmpTab =
  | 'overview'
  | 'orders'
  | 'inventory'
  | 'support'
  | 'returns'
  | 'coupons'
  | 'reviews';

interface TabDef {
  key: EmpTab;
  label: string;
  icon: string;
  cap: Capability;
}

// Employee operations console. Mirrors the admin console's look, but is scoped to
// operational tasks and gated per-capability. The admin console is left untouched;
// admins can still use this dashboard (they hold every capability).
@Component({
  selector: 'app-employee',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="container">
      <div class="page-head">
        <div>
          <h1>Employee dashboard</h1>
          <p class="muted" style="margin:.3rem 0 0">
            {{ auth.user()?.name }} ·
            {{ auth.isAdmin() ? 'Administrator' : departmentLabel(auth.department()) }}
          </p>
        </div>
      </div>

      @if (msg()) { <div class="alert ok">{{ msg() }}</div> }
      @if (error()) { <div class="alert error">{{ error() }}</div> }

      @if (tabs().length === 0) {
        <div class="alert info">
          Your account has no operational area assigned yet. Ask an administrator to set your
          department from the Admin console → Users.
        </div>
      } @else {
        <div class="tabbar">
          @for (t of tabs(); track t.key) {
            <button class="tab" [class.active]="tab() === t.key" (click)="go(t.key)">
              <app-icon [name]="t.icon" [size]="16" /> {{ t.label }}
            </button>
          }
        </div>

        <!-- ===== Overview ===== -->
        @if (tab() === 'overview') {
          @if (stats(); as s) {
            <div class="stat-grid">
              <div class="card stat"><div class="ico brand"><app-icon name="orders" [size]="20" /></div><div><div class="n">{{ s.orders }}</div><div class="l">orders</div></div></div>
              <div class="card stat"><div class="ico accent"><app-icon name="card" [size]="20" /></div><div><div class="n">\${{ s.revenue | number: '1.0-0' }}</div><div class="l">revenue</div></div></div>
              <div class="card stat"><div class="ico brand"><app-icon name="tag" [size]="20" /></div><div><div class="n">{{ s.products }}</div><div class="l">products</div></div></div>
              <div class="card stat"><div class="ico danger"><app-icon name="box" [size]="20" /></div><div><div class="n">{{ s.totalStock }}</div><div class="l">units in stock</div></div></div>
            </div>
            <div class="card pad" style="margin-top:18px">
              <h3>Stock health</h3>
              <div class="row" style="gap:24px;flex-wrap:wrap">
                <span><span class="tag status-delivered">{{ s.stockHealth.healthy }}</span> healthy</span>
                <span><span class="tag status-processing">{{ s.stockHealth.low_stock }}</span> low</span>
                <span><span class="tag status-refunded">{{ s.stockHealth.out_of_stock }}</span> out of stock</span>
              </div>
            </div>
          } @else {
            <p class="muted">Loading overview…</p>
          }
        }

        <!-- ===== Orders ===== -->
        @if (tab() === 'orders') {
          <p class="muted" style="margin-top:0">Review orders and advance their fulfilment status.</p>
          <div class="card" style="padding:6px 20px">
            <div class="table-scroll">
              <table>
                <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Set status</th></tr></thead>
                <tbody>
                  @for (o of orders(); track o.id) {
                    <tr>
                      <td>#{{ o.id }}<br /><span class="muted" style="font-size:.8rem">{{ o.created_at | date: 'short' }}</span></td>
                      <td>{{ o.customer_name || o.customer_email || '—' }}</td>
                      <td>\${{ +o.total | number: '1.2-2' }}</td>
                      <td><span class="tag" [ngClass]="statusClass(o.status)">{{ o.status }}</span></td>
                      <td>
                        <select class="sel-status" [ngModel]="o.status" (ngModelChange)="changeOrder(o, $event)" [disabled]="busy() === o.id">
                          @for (s of orderStatuses; track s) { <option [value]="s">{{ s }}</option> }
                        </select>
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="5" class="muted center" style="padding:30px">No orders.</td></tr> }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- ===== Products & Inventory ===== -->
        @if (tab() === 'inventory') {
          <div class="page-head" style="margin-bottom:14px">
            <p class="muted" style="margin:0">Update stock, price and product details.</p>
            <button class="btn sm" (click)="toggleCreate()">
              <app-icon [name]="creating() ? 'x-circle' : 'plus'" [size]="15" /> {{ creating() ? 'Close' : 'Add product' }}
            </button>
          </div>
          @if (creating()) {
            <div class="card pad" style="margin-bottom:16px">
              <div class="create-grid">
                <div><label>Name</label><input [(ngModel)]="draft.name" placeholder="Product name" /></div>
                <div><label>Category</label><input [(ngModel)]="draft.category" placeholder="e.g. Accessories" /></div>
                <div><label>Price</label><input type="number" [(ngModel)]="draft.price" placeholder="0.00" /></div>
                <div><label>Stock</label><input type="number" [(ngModel)]="draft.stock" placeholder="0" /></div>
              </div>
              <div style="margin-top:10px"><label>Description</label><input [(ngModel)]="draft.description" placeholder="Short description" /></div>
              <button class="btn" style="margin-top:14px" [disabled]="savingProduct()" (click)="createProduct()">
                {{ savingProduct() ? 'Saving…' : 'Create product' }}
              </button>
            </div>
          }
          <div class="card" style="padding:6px 20px">
            <div class="table-scroll">
              <table>
                <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th></th></tr></thead>
                <tbody>
                  @for (p of products(); track p.id) {
                    <tr>
                      <td><strong>{{ p.name }}</strong><br /><span class="muted" style="font-size:.8rem">{{ p.category }}</span></td>
                      <td style="white-space:nowrap"><input class="mini" type="number" [(ngModel)]="p.price" /></td>
                      <td style="white-space:nowrap"><input class="mini" type="number" [(ngModel)]="p.stock" /></td>
                      <td class="row" style="gap:6px">
                        <button class="btn ghost sm" [disabled]="busy() === p.id" (click)="saveProduct(p)">Save</button>
                        <button class="btn ghost sm" style="color:var(--danger)" (click)="deleteProduct(p)">Delete</button>
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="4" class="muted center" style="padding:30px">No products.</td></tr> }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- ===== Returns ===== -->
        @if (tab() === 'returns') {
          <p class="muted" style="margin-top:0">Review and decide customer return/refund requests.</p>
          <div class="card" style="padding:6px 20px">
            <div class="table-scroll">
              <table>
                <thead><tr><th>Return</th><th>Customer</th><th>Reason</th><th>Status</th><th>Set status</th></tr></thead>
                <tbody>
                  @for (r of returns(); track r.id) {
                    <tr>
                      <td>#{{ r.id }} · order #{{ r.order_id }}</td>
                      <td>{{ r.customer_name || r.customer_email || '—' }}</td>
                      <td class="muted">{{ r.reason || '—' }}</td>
                      <td><span class="tag" [ngClass]="returnClass(r.status)">{{ r.status }}</span></td>
                      <td>
                        <select class="sel-status" [ngModel]="r.status" (ngModelChange)="changeReturn(r, $event)">
                          @for (s of returnStatuses; track s) { <option [value]="s">{{ s }}</option> }
                        </select>
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="5" class="muted center" style="padding:30px">No return requests.</td></tr> }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- ===== Support ===== -->
        @if (tab() === 'support') {
          <p class="muted" style="margin-top:0">Open a ticket to reply and set its status.</p>
          <div class="support-grid">
            <div class="card" style="padding:6px 16px">
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Subject</th><th>Customer</th><th>Status</th></tr></thead>
                  <tbody>
                    @for (t of tickets(); track t.id) {
                      <tr style="cursor:pointer" [class.sel]="activeTicket() === t.id" (click)="openTicket(t)">
                        <td>{{ t.subject }}</td>
                        <td class="muted">{{ t.customer_name || t.customer_email }}</td>
                        <td><span class="tag" [ngClass]="ticketClass(t.status)">{{ t.status }}</span></td>
                      </tr>
                    } @empty { <tr><td colspan="3" class="muted center" style="padding:30px">No tickets.</td></tr> }
                  </tbody>
                </table>
              </div>
            </div>
            <div class="card pad">
              @if (activeTicket() === null) {
                <p class="muted">Select a ticket to view the conversation.</p>
              } @else {
                <div class="row" style="justify-content:space-between;margin-bottom:12px">
                  <strong>Ticket #{{ activeTicket() }}</strong>
                  <select [ngModel]="activeStatus()" (ngModelChange)="setTicketStatus($event)">
                    @for (s of ticketStatuses; track s) { <option [value]="s">{{ s }}</option> }
                  </select>
                </div>
                <div class="thread">
                  @for (m of ticketMessages(); track m.id) {
                    <div class="msg" [class.staff]="m.author_role === 'staff'">
                      <div class="bubble">
                        <div class="who">{{ m.author_role === 'staff' ? 'Support' : (m.author || 'Customer') }} · <span class="muted">{{ m.created_at | date: 'short' }}</span></div>
                        {{ m.body }}
                      </div>
                    </div>
                  }
                </div>
                <div class="row" style="margin-top:12px">
                  <textarea rows="2" [(ngModel)]="ticketReply" placeholder="Reply as support…" style="flex:1"></textarea>
                  <button class="btn" [disabled]="replying()" (click)="replyTicket()">Send</button>
                </div>
              }
            </div>
          </div>
        }

        <!-- ===== Coupons ===== -->
        @if (tab() === 'coupons') {
          <div class="page-head" style="margin-bottom:14px">
            <p class="muted" style="margin:0">Create and manage promotional discount codes.</p>
          </div>
          <div class="card pad" style="margin-bottom:16px">
            <div class="row" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
              <div><label>Code</label><input [(ngModel)]="couponDraft.code" placeholder="SAVE10" /></div>
              <div><label>% off</label><input type="number" [(ngModel)]="couponDraft.percent_off" placeholder="10" /></div>
              <button class="btn" [disabled]="savingCoupon()" (click)="createCoupon()">Add coupon</button>
            </div>
          </div>
          <div class="card" style="padding:6px 20px">
            <div class="table-scroll">
              <table>
                <thead><tr><th>Code</th><th>% off</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  @for (c of coupons(); track c.id) {
                    <tr>
                      <td><code>{{ c.code }}</code></td>
                      <td>{{ c.percent_off }}%</td>
                      <td><span class="tag" [ngClass]="c.active ? 'status-delivered' : 'status-cancelled'">{{ c.active ? 'active' : 'inactive' }}</span></td>
                      <td class="row" style="gap:6px">
                        <button class="btn ghost sm" (click)="toggleCoupon(c)">{{ c.active ? 'Disable' : 'Enable' }}</button>
                        <button class="btn ghost sm" style="color:var(--danger)" (click)="deleteCoupon(c)">Delete</button>
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="4" class="muted center" style="padding:30px">No coupons.</td></tr> }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- ===== Reviews ===== -->
        @if (tab() === 'reviews') {
          <p class="muted" style="margin-top:0">Moderate product reviews before they appear on the storefront.</p>
          <div class="card" style="padding:6px 20px">
            <div class="table-scroll">
              <table>
                <thead><tr><th>Product</th><th>Rating</th><th>Comment</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  @for (rv of reviews(); track rv.id) {
                    <tr>
                      <td>{{ rv.product_name }}<br /><span class="muted" style="font-size:.8rem">{{ rv.author_email }}</span></td>
                      <td>{{ rv.rating }} / 5</td>
                      <td class="muted">{{ rv.comment || '—' }}</td>
                      <td><span class="tag" [ngClass]="rv.approved ? 'status-delivered' : 'status-processing'">{{ rv.approved ? 'approved' : 'pending' }}</span></td>
                      <td class="row" style="gap:6px">
                        @if (!rv.approved) { <button class="btn ghost sm" (click)="approveReview(rv)">Approve</button> }
                        <button class="btn ghost sm" style="color:var(--danger)" (click)="deleteReview(rv)">Remove</button>
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="5" class="muted center" style="padding:30px">No reviews.</td></tr> }
                </tbody>
              </table>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `.tabbar { display:flex; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--border); margin-bottom:22px; }
     .tab { background:none; border:none; border-bottom:2px solid transparent; padding:10px 14px; cursor:pointer; color:var(--muted); font-weight:600; font-size:.9rem; display:inline-flex; align-items:center; gap:6px; }
     .tab:hover { color:var(--brand); }
     .tab.active { color:var(--brand); border-bottom-color:var(--brand); }
     .card.pad { padding:20px; }
     .pad h3 { margin:0 0 14px; font-size:1rem; }
     .stat-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:16px; }
     .stat { display:flex; align-items:center; gap:14px; padding:18px; }
     .stat .ico { width:42px; height:42px; flex:none; border-radius:11px; display:flex; align-items:center; justify-content:center; }
     .stat .ico.brand { background:#eef2ff; color:var(--brand); }
     .stat .ico.accent { background:#ecfdf5; color:var(--accent); }
     .stat .ico.danger { background:#fef2f2; color:var(--danger); }
     .stat .n { font-size:1.45rem; font-weight:800; line-height:1.1; }
     .stat .l { color:var(--muted); font-size:.8rem; }
     .sel-status { padding:6px 8px; border-radius:8px; font-size:.84rem; min-width:120px; }
     .mini { width:90px; padding:6px 8px; }
     .create-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:0 16px; }
     @media (max-width:560px) { .create-grid { grid-template-columns:1fr; } }
     .support-grid { display:grid; grid-template-columns:1fr 1.2fr; gap:16px; align-items:start; }
     @media (max-width:860px) { .support-grid { grid-template-columns:1fr; } }
     tr.sel { background:#eef2ff; }
     .thread { display:flex; flex-direction:column; gap:8px; max-height:340px; overflow:auto; }
     .thread .msg { display:flex; }
     .thread .msg.staff { justify-content:flex-end; }
     .thread .bubble { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:8px 12px; font-size:.9rem; max-width:80%; }
     .thread .msg.staff .bubble { background:#eef2ff; border-color:#dbe3ff; }
     .thread .who { font-size:.74rem; margin-bottom:3px; }
     .tag.status-paid       { background:#eff6ff; color:#1d4ed8; }
     .tag.status-processing { background:#fffbeb; color:#b45309; }
     .tag.status-shipped    { background:#eef2ff; color:#4338ca; }
     .tag.status-delivered  { background:#ecfdf5; color:#047857; }
     .tag.status-cancelled  { background:#f3f4f6; color:#6b7280; }
     .tag.status-refunded   { background:#fef2f2; color:#b91c1c; }`,
  ],
})
export class EmployeeComponent implements OnInit {
  // Catalog of every possible tab with the capability that unlocks it.
  private readonly allTabs: TabDef[] = [
    { key: 'overview', label: 'Overview', icon: 'box', cap: 'reports.view' },
    { key: 'orders', label: 'Orders', icon: 'orders', cap: 'orders.manage' },
    { key: 'inventory', label: 'Products & Inventory', icon: 'tag', cap: 'products.manage' },
    { key: 'returns', label: 'Returns', icon: 'return', cap: 'returns.manage' },
    { key: 'support', label: 'Support', icon: 'message', cap: 'support.manage' },
    { key: 'coupons', label: 'Coupons', icon: 'tag', cap: 'coupons.manage' },
    { key: 'reviews', label: 'Reviews', icon: 'star', cap: 'reviews.manage' },
  ];
  // Only the tabs the signed-in user is allowed to use.
  readonly tabs = computed(() => this.allTabs.filter((t) => this.auth.hasCap(t.cap)));

  tab = signal<EmpTab>('overview');
  msg = signal('');
  error = signal('');
  busy = signal<number | null>(null);

  stats = signal<AdminStats | null>(null);
  orders = signal<Order[]>([]);
  products = signal<Product[]>([]);
  returns = signal<AdminReturn[]>([]);
  coupons = signal<Coupon[]>([]);
  reviews = signal<AdminReview[]>([]);

  tickets = signal<AdminTicket[]>([]);
  activeTicket = signal<number | null>(null);
  activeStatus = signal<TicketStatus>('open');
  ticketMessages = signal<SupportMessage[]>([]);
  ticketReply = '';
  replying = signal(false);

  creating = signal(false);
  savingProduct = signal(false);
  draft: Partial<Product> = this.blankProduct();
  savingCoupon = signal(false);
  couponDraft: { code: string; percent_off: number } = { code: '', percent_off: 10 };

  readonly orderStatuses = ORDER_STATUSES;
  readonly returnStatuses = RETURN_STATUSES;
  readonly ticketStatuses = TICKET_STATUSES;
  readonly departmentLabel = departmentLabel;

  constructor(
    public auth: AuthService,
    private admin: AdminService,
    private support: SupportService,
    private products$: ProductService
  ) {}

  ngOnInit(): void {
    // Land on the first tab the user can actually see, then load it.
    const first = this.tabs()[0];
    if (first) this.go(first.key);
  }

  go(tab: EmpTab): void {
    this.tab.set(tab);
    this.error.set('');
    if (tab === 'overview' && !this.stats()) this.loadStats();
    if (tab === 'orders') this.loadOrders();
    if (tab === 'inventory') this.loadProducts();
    if (tab === 'returns') this.loadReturns();
    if (tab === 'support') this.loadTickets();
    if (tab === 'coupons') this.loadCoupons();
    if (tab === 'reviews') this.loadReviews();
  }

  private flash(m: string): void {
    this.msg.set(m);
    setTimeout(() => this.msg.set(''), 2200);
  }
  private fail(e: unknown, fallback: string): void {
    this.error.set((e as { error?: { error?: string } })?.error?.error || fallback);
  }

  // ---- overview ----
  private loadStats(): void {
    this.admin.stats().subscribe({ next: (s) => this.stats.set(s), error: (e) => this.fail(e, 'Could not load stats') });
  }

  // ---- orders ----
  private loadOrders(): void {
    this.admin.orders().subscribe({ next: (r) => this.orders.set(r.orders), error: (e) => this.fail(e, 'Could not load orders') });
  }
  statusClass(status: string): string {
    return 'status-' + status;
  }
  changeOrder(o: Order, status: OrderStatus): void {
    if (status === o.status) return;
    const body: { status: OrderStatus; carrier?: string; tracking?: string } = { status };
    if (status === 'shipped') {
      const carrier = prompt('Carrier (e.g. DHL, UPS):', o.carrier || '');
      if (carrier === null) return this.loadOrders();
      const tracking = prompt('Tracking number:', o.tracking || '');
      if (tracking === null) return this.loadOrders();
      body.carrier = carrier;
      body.tracking = tracking;
    }
    this.busy.set(o.id);
    this.admin.setOrderStatus(o.id, body).subscribe({
      next: () => { this.busy.set(null); this.flash(`Order #${o.id} → ${status}`); this.loadOrders(); },
      error: (e) => { this.busy.set(null); this.fail(e, 'Could not update order'); this.loadOrders(); },
    });
  }

  // ---- products / inventory ----
  private blankProduct(): Partial<Product> {
    return { name: '', category: 'General', price: 0, stock: 0, description: '' };
  }
  private loadProducts(): void {
    this.products$.list().subscribe({ next: (r) => this.products.set(r.products), error: (e) => this.fail(e, 'Could not load products') });
  }
  toggleCreate(): void {
    this.creating.update((v) => !v);
    this.draft = this.blankProduct();
  }
  createProduct(): void {
    if (!this.draft.name?.trim()) return this.error.set('Product name is required.');
    this.savingProduct.set(true);
    this.products$.create(this.draft).subscribe({
      next: () => { this.savingProduct.set(false); this.creating.set(false); this.flash('Product created'); this.loadProducts(); },
      error: (e) => { this.savingProduct.set(false); this.fail(e, 'Could not create product'); },
    });
  }
  saveProduct(p: Product): void {
    this.busy.set(p.id);
    this.products$.update(p.id, { price: +p.price, stock: +p.stock }).subscribe({
      next: () => { this.busy.set(null); this.flash(`Saved ${p.name}`); },
      error: (e) => { this.busy.set(null); this.fail(e, 'Could not save product'); },
    });
  }
  deleteProduct(p: Product): void {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    this.products$.remove(p.id).subscribe({
      next: () => { this.flash('Product deleted'); this.loadProducts(); },
      error: (e) => this.fail(e, 'Could not delete product'),
    });
  }

  // ---- returns ----
  private loadReturns(): void {
    this.admin.returns().subscribe({ next: (r) => this.returns.set(r.returns), error: (e) => this.fail(e, 'Could not load returns') });
  }
  returnClass(status: string): string {
    return { requested: 'status-processing', approved: 'status-delivered', rejected: 'status-cancelled', refunded: 'status-cancelled' }[status] || '';
  }
  changeReturn(r: AdminReturn, status: ReturnStatus): void {
    if (status === r.status) return;
    this.admin.setReturnStatus(r.id, status).subscribe({
      next: () => { this.flash(`Return #${r.id} → ${status}`); this.loadReturns(); },
      error: (e) => { this.fail(e, 'Could not update return'); this.loadReturns(); },
    });
  }

  // ---- support ----
  private loadTickets(): void {
    this.support.all().subscribe({ next: (r) => this.tickets.set(r.tickets), error: (e) => this.fail(e, 'Could not load tickets') });
  }
  ticketClass(status: string): string {
    return { open: 'status-processing', pending: 'status-processing', resolved: 'status-delivered', closed: 'status-cancelled' }[status] || '';
  }
  openTicket(t: AdminTicket): void {
    this.activeTicket.set(t.id);
    this.activeStatus.set(t.status);
    this.ticketReply = '';
    this.support.get(t.id).subscribe({ next: (r) => this.ticketMessages.set(r.messages), error: (e) => this.fail(e, 'Could not load ticket') });
  }
  setTicketStatus(status: TicketStatus): void {
    const id = this.activeTicket();
    if (id === null) return;
    this.support.setStatus(id, status).subscribe({
      next: () => { this.activeStatus.set(status); this.flash(`Ticket #${id} → ${status}`); this.loadTickets(); },
      error: (e) => this.fail(e, 'Could not update ticket'),
    });
  }
  replyTicket(): void {
    const id = this.activeTicket();
    if (id === null || !this.ticketReply.trim()) return;
    this.replying.set(true);
    this.support.reply(id, this.ticketReply.trim()).subscribe({
      next: () => { this.replying.set(false); this.ticketReply = ''; this.openTicket({ id } as AdminTicket); this.loadTickets(); },
      error: (e) => { this.replying.set(false); this.fail(e, 'Could not send reply'); },
    });
  }

  // ---- coupons ----
  private loadCoupons(): void {
    this.admin.coupons().subscribe({ next: (r) => this.coupons.set(r.coupons), error: (e) => this.fail(e, 'Could not load coupons') });
  }
  createCoupon(): void {
    const code = this.couponDraft.code.trim().toUpperCase();
    if (!code) return this.error.set('Coupon code is required.');
    this.savingCoupon.set(true);
    this.admin.createCoupon({ code, percent_off: +this.couponDraft.percent_off }).subscribe({
      next: () => { this.savingCoupon.set(false); this.couponDraft = { code: '', percent_off: 10 }; this.flash('Coupon created'); this.loadCoupons(); },
      error: (e) => { this.savingCoupon.set(false); this.fail(e, 'Could not create coupon'); },
    });
  }
  toggleCoupon(c: Coupon): void {
    this.admin.updateCoupon(c.id, { active: !c.active }).subscribe({
      next: () => { this.flash(`Coupon ${c.code} ${c.active ? 'disabled' : 'enabled'}`); this.loadCoupons(); },
      error: (e) => this.fail(e, 'Could not update coupon'),
    });
  }
  deleteCoupon(c: Coupon): void {
    if (!confirm(`Delete coupon ${c.code}?`)) return;
    this.admin.removeCoupon(c.id).subscribe({
      next: () => { this.flash('Coupon deleted'); this.loadCoupons(); },
      error: (e) => this.fail(e, 'Could not delete coupon'),
    });
  }

  // ---- reviews ----
  private loadReviews(): void {
    this.admin.reviews().subscribe({ next: (r) => this.reviews.set(r.reviews), error: (e) => this.fail(e, 'Could not load reviews') });
  }
  approveReview(rv: AdminReview): void {
    this.admin.approveReview(rv.id, true).subscribe({
      next: () => { this.flash('Review approved'); this.loadReviews(); },
      error: (e) => this.fail(e, 'Could not approve review'),
    });
  }
  deleteReview(rv: AdminReview): void {
    if (!confirm('Remove this review?')) return;
    this.admin.removeReview(rv.id).subscribe({
      next: () => { this.flash('Review removed'); this.loadReviews(); },
      error: (e) => this.fail(e, 'Could not remove review'),
    });
  }
}

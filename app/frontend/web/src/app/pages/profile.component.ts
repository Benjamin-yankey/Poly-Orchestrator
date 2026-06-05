import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ListingService } from '../core/listing.service';
import { OrderService } from '../core/order.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../core/icon.component';
import { Listing, Order } from '../core/models';

// Account profile: identity header, account stats, an editable details form
// (name + password) and the user's marketplace listings. Guarded by authGuard,
// so auth.user() is always populated here.
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePipe, IconComponent],
  template: `
    <div class="container">
      <div class="page-head"><h1>Your profile</h1></div>

      @if (auth.user(); as u) {
        <!-- Identity header -->
        <div class="card profile-head">
          <div class="avatar lg">{{ initials() }}</div>
          <div class="who">
            <h2>{{ u.name || 'Unnamed user' }}</h2>
            <p class="muted">{{ u.email }}</p>
            <div class="badges">
              <span class="tag" [class.role-admin]="u.role === 'admin'" [class.role-cust]="u.role === 'customer'">
                <app-icon [name]="u.role === 'admin' ? 'admin' : 'user'" [size]="13" /> {{ u.role }}
              </span>
              @if (u.created_at) { <span class="muted small">Member since {{ u.created_at | date: 'mediumDate' }}</span> }
            </div>
          </div>
          <a class="btn" routerLink="/sell"><app-icon name="sell" [size]="16" /> Sell an item</a>
        </div>

        <!-- Account stats -->
        <div class="stats" style="margin-top:22px">
          <div class="card stat"><div class="ico brand"><app-icon name="orders" [size]="18" /></div><div><div class="n">{{ orders().length }}</div><div class="l">Orders placed</div></div></div>
          <div class="card stat"><div class="ico accent"><app-icon name="card" [size]="18" /></div><div><div class="n">\${{ totalSpent().toFixed(2) }}</div><div class="l">Total spent</div></div></div>
          <div class="card stat"><div class="ico brand"><app-icon name="marketplace" [size]="18" /></div><div><div class="n">{{ listings().length }}</div><div class="l">Active listings</div></div></div>
        </div>

        <div class="layout-2" style="margin-top:8px">
          <!-- Account details / edit -->
          <div class="card pad">
            <div class="card-head">
              <h3>Account details</h3>
              @if (!editing()) { <button class="btn ghost sm" (click)="startEdit()">Edit</button> }
            </div>

            @if (msg()) { <div class="alert ok">{{ msg() }}</div> }
            @if (error()) { <div class="alert error">{{ error() }}</div> }

            @if (!editing()) {
              <dl class="details">
                <div><dt>Full name</dt><dd>{{ u.name || '—' }}</dd></div>
                <div><dt>Email</dt><dd>{{ u.email }}</dd></div>
                <div><dt>Account type</dt><dd style="text-transform:capitalize">{{ u.role }}</dd></div>
                <div><dt>Member since</dt><dd>{{ (u.created_at | date: 'fullDate') || '—' }}</dd></div>
                <div><dt>Account ID</dt><dd>#{{ u.id }}</dd></div>
              </dl>
            } @else {
              <label>Full name</label>
              <input [(ngModel)]="formName" autocomplete="name" />

              <label>Email</label>
              <input [value]="u.email" disabled />
              <small class="muted">Email can't be changed.</small>

              <details class="pw-details">
                <summary>Change password</summary>
                <label>Current password</label>
                <input type="password" [(ngModel)]="currentPassword" autocomplete="current-password" />
                <label>New password</label>
                <input type="password" [(ngModel)]="newPassword" autocomplete="new-password" placeholder="At least 6 characters" />
              </details>

              <div class="row" style="margin-top:16px">
                <button class="btn" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save changes' }}</button>
                <button class="btn ghost" (click)="cancelEdit()">Cancel</button>
              </div>
            }
          </div>

          <!-- Quick links -->
          <div class="card pad">
            <h3>Quick links</h3>
            <a class="ql" routerLink="/orders"><app-icon name="orders" [size]="18" /> <span>Order history</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            <a class="ql" routerLink="/wishlist"><app-icon name="heart" [size]="18" /> <span>Your wishlist</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            <a class="ql" routerLink="/addresses"><app-icon name="location" [size]="18" /> <span>Saved addresses</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            <a class="ql" routerLink="/payment-methods"><app-icon name="card" [size]="18" /> <span>Payment methods</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            <a class="ql" routerLink="/support"><app-icon name="message" [size]="18" /> <span>Support center</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            <a class="ql" routerLink="/sell"><app-icon name="sell" [size]="18" /> <span>Post a new listing</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            <a class="ql" routerLink="/marketplace"><app-icon name="marketplace" [size]="18" /> <span>Browse marketplace</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            @if (auth.isAdmin()) {
              <a class="ql" routerLink="/admin"><app-icon name="admin" [size]="18" /> <span>Admin console</span> <app-icon name="chevron-down" [size]="16" class="chev" /></a>
            }
          </div>
        </div>

        <!-- Listings -->
        <div class="page-head" style="margin-top:28px">
          <div>
            <h2 style="margin:0">Your listings</h2>
            <p class="muted" style="margin:4px 0 0">Items you've posted to the marketplace.</p>
          </div>
        </div>

        @if (loading()) {
          <div class="spinner">Loading…</div>
        } @else if (listings().length === 0) {
          <div class="empty">
            <div class="big"><app-icon name="marketplace" [size]="56" /></div>
            <p>You haven't posted anything yet. <a routerLink="/sell">Post your first item.</a></p>
          </div>
        } @else {
          <div class="grid">
            @for (l of listings(); track l.id) {
              <div class="card product">
                <div class="media">
                  @if (l.image) { <img [src]="l.image" [alt]="l.title" /> }
                  @else { <app-icon name="image" [size]="40" /> }
                </div>
                <div class="cat">{{ l.category }}</div>
                <h3>{{ l.title }}</h3>
                <div class="row spread" style="margin-top:10px">
                  <span class="price">\${{ (+l.price).toFixed(2) }}</span>
                  <button class="btn sm danger" (click)="remove(l)">Delete</button>
                </div>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `.profile-head { display:flex; align-items:center; gap:20px; padding:24px; flex-wrap:wrap; }
     .profile-head .who { flex:1; min-width:0; }
     .profile-head .who h2 { margin:0 0 2px; }
     .profile-head .who p { margin:0 0 8px; }
     .profile-head .btn { display:inline-flex; align-items:center; gap:6px; text-decoration:none; }
     .badges { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
     .badges .small { font-size:.82rem; }
     .tag { display:inline-flex; align-items:center; gap:5px; }
     .tag.role-admin { background:var(--tint-brand); color:var(--brand); }
     .tag.role-cust { background:var(--bg); color:var(--muted); }
     .avatar {
       display:inline-flex; align-items:center; justify-content:center; flex:none;
       border-radius:999px; background:color-mix(in srgb, var(--brand) 14%, transparent);
       color:var(--brand); font-weight:800;
     }
     .avatar.lg { width:72px; height:72px; font-size:1.6rem; }

     .stat { display:flex; align-items:center; gap:14px; }
     .stat .ico { width:40px; height:40px; flex:none; border-radius:11px; display:flex; align-items:center; justify-content:center; }
     .stat .ico.brand { background:var(--tint-brand); color:var(--brand); }
     .stat .ico.accent { background:var(--tint-accent); color:var(--accent); }
     .stat .n { font-size:1.4rem; font-weight:800; line-height:1.1; }
     .stat .l { color:var(--muted); font-size:.82rem; }

     .card.pad { padding:22px; }
     .card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
     .card-head h3, .pad h3 { margin:0 0 14px; font-size:1rem; }
     .card-head h3 { margin:0; }

     .details { margin:8px 0 0; display:grid; gap:0; }
     .details > div { display:flex; justify-content:space-between; gap:16px; padding:11px 0; border-bottom:1px solid var(--border); }
     .details > div:last-child { border-bottom:none; }
     .details dt { color:var(--muted); font-size:.86rem; margin:0; }
     .details dd { margin:0; font-weight:600; text-align:right; word-break:break-word; }

     .pw-details { margin-top:10px; border:1px solid var(--border); border-radius:10px; padding:10px 14px; }
     .pw-details summary { cursor:pointer; font-weight:600; font-size:.88rem; color:var(--brand); }

     .ql { display:flex; align-items:center; gap:12px; padding:12px 4px; border-bottom:1px solid var(--border); color:var(--ink); font-weight:600; }
     .ql:last-child { border-bottom:none; }
     .ql:hover { text-decoration:none; color:var(--brand); }
     .ql span { flex:1; }
     .ql .chev { transform:rotate(-90deg); color:var(--muted); }

     .media {
       display:flex; align-items:center; justify-content:center; height:150px; overflow:hidden;
       border-radius:12px; background:var(--bg); color:var(--muted); margin-bottom:10px;
     }
     .media img { width:100%; height:100%; object-fit:cover; }`,
  ],
})
export class ProfileComponent implements OnInit {
  listings = signal<Listing[]>([]);
  orders = signal<Order[]>([]);
  loading = signal<boolean>(true);

  editing = signal<boolean>(false);
  saving = signal<boolean>(false);
  msg = signal<string>('');
  error = signal<string>('');
  formName = '';
  currentPassword = '';
  newPassword = '';

  totalSpent = computed(() => this.orders().reduce((s, o) => s + Number(o.total), 0));

  initials = computed(() => {
    const u = this.auth.user();
    const base = (u?.name || u?.email || '?').trim();
    const parts = base.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2);
    return letters.toUpperCase();
  });

  constructor(
    public auth: AuthService,
    private listingSvc: ListingService,
    private orderSvc: OrderService
  ) {}

  ngOnInit(): void {
    this.load();
    this.orderSvc.mine().subscribe((r) => this.orders.set(r.orders));
  }

  load(): void {
    this.loading.set(true);
    this.listingSvc.mine().subscribe({
      next: (r) => {
        this.listings.set(r.listings);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  startEdit(): void {
    this.formName = this.auth.user()?.name || '';
    this.currentPassword = '';
    this.newPassword = '';
    this.msg.set('');
    this.error.set('');
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.error.set('');
  }

  save(): void {
    this.error.set('');
    this.msg.set('');
    if (!this.formName.trim()) return this.error.set('Name cannot be empty.');
    if (this.newPassword && !this.currentPassword) {
      return this.error.set('Enter your current password to set a new one.');
    }
    this.saving.set(true);
    this.auth
      .updateProfile({
        name: this.formName.trim(),
        currentPassword: this.currentPassword || undefined,
        newPassword: this.newPassword || undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editing.set(false);
          this.msg.set('Profile updated.');
          setTimeout(() => this.msg.set(''), 2500);
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(e?.error?.error || 'Could not update profile.');
        },
      });
  }

  remove(l: Listing): void {
    if (!confirm(`Delete "${l.title}"?`)) return;
    this.listingSvc.remove(l.id).subscribe(() => this.load());
  }
}

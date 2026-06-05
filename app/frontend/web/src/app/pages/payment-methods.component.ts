import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AccountService } from '../core/account.service';
import { IconComponent } from '../core/icon.component';
import { PaymentMethod } from '../core/models';

// Cards on file. The app never stores a full card number — only the brand, last
// four digits and expiry are kept. Guarded by authGuard.
@Component({
  selector: 'app-payment-methods',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="container">
      <p class="muted"><a routerLink="/profile">&larr; Back to profile</a></p>
      <div class="page-head">
        <div><h1>Payment methods</h1><p class="muted">Cards on file for faster checkout.</p></div>
        @if (!adding()) { <button class="btn" (click)="startAdd()"><app-icon name="plus" [size]="16" /> Add card</button> }
      </div>

      <div class="alert info" style="display:flex;align-items:flex-start;gap:8px">
        <app-icon name="lock" [size]="18" />
        <span>For your security we store only the card brand, last 4 digits and expiry — never the full number.</span>
      </div>

      @if (error()) { <div class="alert error">{{ error() }}</div> }

      @if (adding()) {
        <div class="card pad" style="margin-bottom:18px">
          <h3 style="margin-top:0">Add a card</h3>
          <label>Name on card</label>
          <input [(ngModel)]="form.holder" autocomplete="cc-name" />
          <label>Card number</label>
          <input [(ngModel)]="form.cardNumber" autocomplete="cc-number" placeholder="4242 4242 4242 4242" />
          <label>Expiry</label>
          <input [(ngModel)]="form.expiry" autocomplete="cc-exp" placeholder="MM/YY" style="max-width:140px" />
          <label class="check"><input type="checkbox" [(ngModel)]="form.is_default" /> Use as my default card</label>
          <div class="row" style="margin-top:16px">
            <button class="btn" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save card' }}</button>
            <button class="btn ghost" (click)="cancel()">Cancel</button>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="spinner">Loading…</div>
      } @else if (methods().length === 0) {
        <div class="empty"><div class="big"><app-icon name="card" [size]="56" /></div><p>No cards saved yet.</p></div>
      } @else {
        <div class="grid">
          @for (m of methods(); track m.id) {
            <div class="card pad">
              <div class="row spread">
                <strong><app-icon name="card" [size]="16" /> {{ m.brand }} •••• {{ m.last4 }}</strong>
                @if (m.is_default) { <span class="tag role-admin">Default</span> }
              </div>
              <p class="muted" style="margin:8px 0 0">
                {{ m.holder || 'Cardholder' }}
                @if (m.exp_month) { · expires {{ pad(m.exp_month) }}/{{ m.exp_year }} }
              </p>
              <div class="row" style="margin-top:14px;gap:8px">
                @if (!m.is_default) { <button class="btn ghost sm" (click)="makeDefault(m)">Set default</button> }
                <button class="btn ghost sm danger" style="color:var(--danger)" (click)="remove(m)">Delete</button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `.card.pad { padding:20px; }
     .tag.role-admin { background:var(--tint-brand); color:var(--brand); }
     .check { display:flex; align-items:center; gap:8px; margin-top:14px; font-weight:500; }
     .check input { width:auto; }
     strong app-icon { vertical-align:-3px; margin-right:4px; }`,
  ],
})
export class PaymentMethodsComponent implements OnInit {
  methods = signal<PaymentMethod[]>([]);
  loading = signal(true);
  adding = signal(false);
  saving = signal(false);
  error = signal('');
  form = { holder: '', cardNumber: '', expiry: '', is_default: false };

  constructor(private account: AccountService) {}

  ngOnInit(): void {
    this.load();
  }

  pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  load(): void {
    this.loading.set(true);
    this.account.methods().subscribe({
      next: (r) => {
        this.methods.set(r.methods);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  startAdd(): void {
    this.form = { holder: '', cardNumber: '', expiry: '', is_default: false };
    this.error.set('');
    this.adding.set(true);
  }

  cancel(): void {
    this.adding.set(false);
    this.error.set('');
  }

  save(): void {
    this.error.set('');
    if (this.form.cardNumber.replace(/\D/g, '').length < 12) {
      return this.error.set('Enter a valid card number.');
    }
    this.saving.set(true);
    this.account.createMethod(this.form).subscribe({
      next: () => {
        this.saving.set(false);
        this.adding.set(false);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.error || 'Could not save card.');
      },
    });
  }

  makeDefault(m: PaymentMethod): void {
    this.account.setDefaultMethod(m.id).subscribe(() => this.load());
  }

  remove(m: PaymentMethod): void {
    if (!confirm(`Remove the ${m.brand} card ending ${m.last4}?`)) return;
    this.account.removeMethod(m.id).subscribe(() => this.load());
  }
}

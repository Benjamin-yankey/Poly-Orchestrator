import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AccountService } from '../core/account.service';
import { IconComponent } from '../core/icon.component';
import { Address } from '../core/models';

// Address book: list saved addresses, add / edit / delete, and pick a default
// that's pre-selected at checkout. Guarded by authGuard.
@Component({
  selector: 'app-addresses',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="container">
      <p class="muted"><a routerLink="/profile">&larr; Back to profile</a></p>
      <div class="page-head">
        <div><h1>Saved addresses</h1><p class="muted">Manage where your orders ship.</p></div>
        @if (!editing()) { <button class="btn" (click)="startAdd()"><app-icon name="plus" [size]="16" /> Add address</button> }
      </div>

      @if (error()) { <div class="alert error">{{ error() }}</div> }

      @if (editing()) {
        <div class="card pad" style="margin-bottom:18px">
          <h3 style="margin-top:0">{{ form.id ? 'Edit address' : 'New address' }}</h3>
          <div class="field-row">
            <div><label>Label</label><input [(ngModel)]="form.label" placeholder="Home, Work…" /></div>
            <div><label>Full name</label><input [(ngModel)]="form.full_name" autocomplete="name" /></div>
          </div>
          <label>Address line 1</label>
          <input [(ngModel)]="form.line1" autocomplete="address-line1" placeholder="Street address" />
          <label>Address line 2</label>
          <input [(ngModel)]="form.line2" autocomplete="address-line2" placeholder="Apt, suite (optional)" />
          <div class="field-row">
            <div><label>City</label><input [(ngModel)]="form.city" autocomplete="address-level2" /></div>
            <div><label>Region / State</label><input [(ngModel)]="form.region" autocomplete="address-level1" /></div>
          </div>
          <div class="field-row">
            <div><label>Postal code</label><input [(ngModel)]="form.postal_code" autocomplete="postal-code" /></div>
            <div><label>Country</label><input [(ngModel)]="form.country" autocomplete="country-name" /></div>
          </div>
          <label>Phone</label>
          <input [(ngModel)]="form.phone" autocomplete="tel" />
          <label class="check"><input type="checkbox" [(ngModel)]="form.is_default" /> Make this my default address</label>
          <div class="row" style="margin-top:16px">
            <button class="btn" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save address' }}</button>
            <button class="btn ghost" (click)="cancel()">Cancel</button>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="spinner">Loading…</div>
      } @else if (addresses().length === 0) {
        <div class="empty"><div class="big"><app-icon name="location" [size]="56" /></div><p>No saved addresses yet.</p></div>
      } @else {
        <div class="grid">
          @for (a of addresses(); track a.id) {
            <div class="card pad addr">
              <div class="row spread">
                <strong>{{ a.label }}</strong>
                @if (a.is_default) { <span class="tag role-admin">Default</span> }
              </div>
              <p style="margin:8px 0 0">
                {{ a.full_name }}<br />
                {{ a.line1 }}@if (a.line2) {<br />{{ a.line2 }}}<br />
                {{ a.city }}{{ a.region ? ', ' + a.region : '' }} {{ a.postal_code }}<br />
                {{ a.country }}
                @if (a.phone) { <br /><span class="muted">{{ a.phone }}</span> }
              </p>
              <div class="row" style="margin-top:14px;gap:8px">
                @if (!a.is_default) { <button class="btn ghost sm" (click)="makeDefault(a)">Set default</button> }
                <button class="btn ghost sm" (click)="startEdit(a)">Edit</button>
                <button class="btn ghost sm danger" style="color:var(--danger)" (click)="remove(a)">Delete</button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `.card.pad { padding:20px; }
     .addr p { line-height:1.5; }
     .tag.role-admin { background:var(--tint-brand); color:var(--brand); }
     .check { display:flex; align-items:center; gap:8px; margin-top:14px; font-weight:500; }
     .check input { width:auto; }`,
  ],
})
export class AddressesComponent implements OnInit {
  addresses = signal<Address[]>([]);
  loading = signal(true);
  editing = signal(false);
  saving = signal(false);
  error = signal('');
  form: Partial<Address> = this.blank();

  constructor(private account: AccountService) {}

  ngOnInit(): void {
    this.load();
  }

  blank(): Partial<Address> {
    return {
      id: undefined,
      label: 'Home',
      full_name: '',
      line1: '',
      line2: '',
      city: '',
      region: '',
      postal_code: '',
      country: '',
      phone: '',
      is_default: false,
    };
  }

  load(): void {
    this.loading.set(true);
    this.account.addresses().subscribe({
      next: (r) => {
        this.addresses.set(r.addresses);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  startAdd(): void {
    this.form = this.blank();
    this.error.set('');
    this.editing.set(true);
  }

  startEdit(a: Address): void {
    this.form = { ...a };
    this.error.set('');
    this.editing.set(true);
  }

  cancel(): void {
    this.editing.set(false);
    this.error.set('');
  }

  save(): void {
    this.error.set('');
    if (!this.form.line1?.trim()) return this.error.set('Address line 1 is required.');
    this.saving.set(true);
    const done = () => {
      this.saving.set(false);
      this.editing.set(false);
      this.load();
    };
    const fail = (e: any) => {
      this.saving.set(false);
      this.error.set(e?.error?.error || 'Could not save address.');
    };
    if (this.form.id) {
      this.account.updateAddress(this.form.id, this.form).subscribe({ next: done, error: fail });
    } else {
      this.account.createAddress(this.form).subscribe({ next: done, error: fail });
    }
  }

  makeDefault(a: Address): void {
    this.account.setDefaultAddress(a.id).subscribe(() => this.load());
  }

  remove(a: Address): void {
    if (!confirm(`Delete the "${a.label}" address?`)) return;
    this.account.removeAddress(a.id).subscribe(() => this.load());
  }
}

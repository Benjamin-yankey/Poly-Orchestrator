import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ListingService } from '../core/listing.service';
import { IconComponent } from '../core/icon.component';
import { Listing } from '../core/models';
import { COUNTRIES, Country, findCountry, formatPrice } from '../core/countries';

// "Sell" page: post a new item for sale and manage your own listings. Reachable
// only when logged in (guarded by authGuard). Buyers will call the phone number.
//
// The seller picks a Country, which drives three fields: the Price currency, the
// phone dial code, and the Location (city) dropdown. Category is an admin-managed
// dropdown loaded from the backend.
@Component({
  selector: 'app-sell',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="container">
      <div class="page-head">
        <div>
          <h1>Sell an item</h1>
          <p class="muted">Post something for sale. Buyers will call the phone number you provide.</p>
        </div>
      </div>

      <div class="layout-2">
        <!-- Post form -->
        <div class="card" style="padding:24px">
          <h3 style="margin-top:0">New listing</h3>

          @if (error()) { <div class="alert error">{{ error() }}</div> }
          @if (success()) { <div class="alert ok">{{ success() }}</div> }

          <label>Photo</label>
          <div class="uploader" [class.has-image]="form.image">
            @if (form.image) {
              <img [src]="form.image" alt="Item photo preview" />
              <button type="button" class="remove-img" (click)="clearImage()" aria-label="Remove photo">
                <app-icon name="x-circle" [size]="18" />
              </button>
            } @else {
              <label class="dropzone">
                <app-icon name="image" [size]="30" />
                <span>Click to upload a photo</span>
                <small class="muted">PNG, JPG or WebP · up to 2 MB</small>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" (change)="onFile($event)" hidden />
              </label>
            }
          </div>

          <label>Title</label>
          <input [(ngModel)]="form.title" placeholder="e.g. Used mountain bike" />

          <label>Country</label>
          <select [(ngModel)]="form.country" (ngModelChange)="onCountryChange()">
            @for (c of countries; track c.iso) {
              <option [value]="c.name">{{ c.name }} ({{ c.dial }})</option>
            }
          </select>

          <div class="field-row">
            <div>
              <label>Price ({{ cc().symbol }})</label>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.price" placeholder="0.00" />
            </div>
            <div>
              <label>Category</label>
              <select [(ngModel)]="form.category">
                @if (categories().length === 0) { <option value="">Loading…</option> }
                @for (c of categories(); track c) { <option [value]="c">{{ c }}</option> }
              </select>
            </div>
          </div>

          <div class="field-row">
            <div>
              <label>Phone (buyers call this)</label>
              <div class="phone-input">
                <span class="dial">{{ cc().dial }}</span>
                <input
                  type="tel"
                  inputmode="numeric"
                  [(ngModel)]="phoneNational"
                  (ngModelChange)="onPhoneInput()"
                  placeholder="24 123 4567"
                />
              </div>
              <small class="muted">Numbers only — e.g. {{ cc().dial }} 24 123 4567</small>
            </div>
            <div>
              <label>Location</label>
              <select [(ngModel)]="form.location">
                <option value="">Select a city…</option>
                @for (city of cc().cities; track city) { <option [value]="city">{{ city }}</option> }
              </select>
            </div>
          </div>

          <label>Description</label>
          <textarea rows="3" [(ngModel)]="form.description" placeholder="Condition, details, why you're selling…"></textarea>

          <button class="btn block" style="margin-top:16px" [disabled]="saving()" (click)="submit()">
            {{ saving() ? 'Posting…' : 'Post listing' }}
          </button>
        </div>

        <!-- My listings -->
        <div class="card" style="padding:24px">
          <h3 style="margin-top:0">Your listings</h3>
          @if (loadingMine()) {
            <p class="muted">Loading…</p>
          } @else if (mine().length === 0) {
            <p class="muted">You haven't posted anything yet.</p>
          } @else {
            @for (l of mine(); track l.id) {
              <div class="mine-line">
                <div class="thumb">
                  @if (l.image) { <img [src]="l.image" [alt]="l.title" /> }
                  @else { <app-icon name="image" [size]="22" /> }
                </div>
                <div class="grow">
                  <strong>{{ l.title }}</strong>
                  <div class="muted line-meta">
                    {{ price(l) }} · {{ l.category }}
                    <span class="meta-phone"><app-icon name="phone" [size]="13" /> {{ l.phone }}</span>
                  </div>
                </div>
                <button class="btn sm danger" (click)="remove(l)">Delete</button>
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `.uploader { position: relative; margin-bottom: 6px; }
     .dropzone {
       display: flex; flex-direction: column; align-items: center; justify-content: center;
       gap: 6px; text-align: center; padding: 28px 16px; cursor: pointer; color: var(--muted);
       border: 1px dashed var(--border); border-radius: 12px; background: var(--bg);
     }
     .dropzone:hover { border-color: var(--brand); color: var(--brand); }
     .dropzone small { font-size: 0.78rem; }
     .uploader img { width: 100%; max-height: 220px; object-fit: cover; border-radius: 12px; border: 1px solid var(--border); display: block; }
     .remove-img {
       position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; padding: 0;
       display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
       border: none; border-radius: 999px; background: rgba(16,24,40,.65); color: #fff;
     }
     .phone-input { display:flex; align-items:stretch; }
     .phone-input .dial {
       display:inline-flex; align-items:center; padding:0 12px; white-space:nowrap;
       border:1px solid var(--border); border-right:none; border-radius:10px 0 0 10px;
       background:var(--bg); color:var(--muted); font-weight:600;
     }
     .phone-input input { border-radius:0 10px 10px 0; flex:1; min-width:0; }
     .mine-line { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); }
     .mine-line:last-child { border-bottom:none; }
     .mine-line .thumb {
       width: 48px; height: 48px; flex: none; border-radius: 10px; overflow: hidden;
       display: inline-flex; align-items: center; justify-content: center;
       background: var(--bg); border: 1px solid var(--border); color: var(--muted);
     }
     .mine-line .thumb img { width: 100%; height: 100%; object-fit: cover; }
     .mine-line .grow { flex:1; min-width: 0; }
     .line-meta { font-size:0.82rem; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
     .meta-phone { display:inline-flex; align-items:center; gap:3px; }`,
  ],
})
export class SellComponent implements OnInit {
  // Cap uploads so the base64 payload stays well within the API body limit.
  private static readonly MAX_BYTES = 2 * 1024 * 1024;
  readonly countries = COUNTRIES;
  // Default to Ghana; country drives currency, dial code and the city list.
  form: Partial<Listing> = { country: 'Ghana' };
  phoneNational = '';
  categories = signal<string[]>([]);
  mine = signal<Listing[]>([]);
  loadingMine = signal<boolean>(true);
  saving = signal<boolean>(false);
  error = signal<string>('');
  success = signal<string>('');

  constructor(private listingSvc: ListingService) {}

  ngOnInit(): void {
    this.loadMine();
    this.listingSvc.managedCategories().subscribe((r) => {
      const names = r.categories.map((c) => c.name);
      this.categories.set(names);
      if (!this.form.category && names.length) this.form.category = names[0];
    });
  }

  // The currently selected country (falls back to the first in the list).
  cc(): Country {
    return findCountry(this.form.country) ?? COUNTRIES[0];
  }

  // Render a listing's price in its own stored currency.
  price(l: Listing): string {
    return formatPrice(l.price, l.currency);
  }

  onCountryChange(): void {
    // City list changed; clear any city that no longer belongs to this country.
    if (this.form.location && !this.cc().cities.includes(this.form.location)) {
      this.form.location = '';
    }
  }

  // Keep the national number digits-only as the user types.
  onPhoneInput(): void {
    this.phoneNational = (this.phoneNational || '').replace(/[^\d]/g, '');
  }

  loadMine(): void {
    this.loadingMine.set(true);
    this.listingSvc.mine().subscribe({
      next: (r) => {
        this.mine.set(r.listings);
        this.loadingMine.set(false);
      },
      error: () => this.loadingMine.set(false),
    });
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error.set('Please choose an image file.');
      return;
    }
    if (file.size > SellComponent.MAX_BYTES) {
      this.error.set('That image is larger than 2 MB. Please choose a smaller one.');
      return;
    }
    this.error.set('');
    const reader = new FileReader();
    reader.onload = () => (this.form.image = reader.result as string);
    reader.readAsDataURL(file);
  }

  clearImage(): void {
    this.form.image = '';
  }

  submit(): void {
    this.error.set('');
    this.success.set('');
    const country = this.cc();
    if (!this.form.title || this.form.price == null || `${this.form.price}` === '') {
      this.error.set('Title and price are required.');
      return;
    }
    if (this.phoneNational.length < 6 || this.phoneNational.length > 14) {
      this.error.set('Enter a valid phone number (digits only, e.g. 24 123 4567).');
      return;
    }
    // Compose the international phone and stamp the country's currency.
    const payload: Partial<Listing> = {
      ...this.form,
      phone: `${country.dial} ${this.phoneNational}`,
      currency: country.currency,
    };
    this.saving.set(true);
    this.listingSvc.create(payload).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.success.set(`"${r.listing.title}" is now live on the marketplace.`);
        // Reset, keeping the chosen country/category for the next post.
        this.form = { country: country.name, category: this.form.category };
        this.phoneNational = '';
        this.loadMine();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.error || 'Could not post listing.');
      },
    });
  }

  remove(l: Listing): void {
    if (!confirm(`Delete "${l.title}"?`)) return;
    this.listingSvc.remove(l.id).subscribe(() => this.loadMine());
  }
}

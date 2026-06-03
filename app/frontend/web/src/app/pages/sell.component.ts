import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ListingService } from '../core/listing.service';
import { IconComponent } from '../core/icon.component';
import { Listing } from '../core/models';

// "Sell" page: post a new item for sale and manage your own listings. Reachable
// only when logged in (guarded by authGuard). Buyers will call the phone number.
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

          <div class="field-row">
            <div>
              <label>Price ($)</label>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.price" placeholder="0.00" />
            </div>
            <div>
              <label>Category</label>
              <input [(ngModel)]="form.category" placeholder="e.g. Sports" />
            </div>
          </div>

          <div class="field-row">
            <div>
              <label>Phone (buyers call this)</label>
              <input [(ngModel)]="form.phone" placeholder="e.g. +233 24 123 4567" />
            </div>
            <div>
              <label>Location</label>
              <input [(ngModel)]="form.location" placeholder="e.g. Accra" />
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
                    \${{ (+l.price).toFixed(2) }} · {{ l.category }}
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
  form: Partial<Listing> = {};
  mine = signal<Listing[]>([]);
  loadingMine = signal<boolean>(true);
  saving = signal<boolean>(false);
  error = signal<string>('');
  success = signal<string>('');

  constructor(private listingSvc: ListingService) {}

  ngOnInit(): void {
    this.loadMine();
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
    if (!this.form.title || this.form.price == null || `${this.form.price}` === '' || !this.form.phone) {
      this.error.set('Title, price and phone are required.');
      return;
    }
    this.saving.set(true);
    this.listingSvc.create(this.form).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.success.set(`"${r.listing.title}" is now live on the marketplace.`);
        this.form = {};
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

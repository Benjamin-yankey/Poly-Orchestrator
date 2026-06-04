import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ListingService } from '../core/listing.service';
import { IconComponent } from '../core/icon.component';
import { Listing } from '../core/models';
import { formatPrice } from '../core/countries';

// Public marketplace listing detail. Reached by clicking a card on /marketplace.
// Shows the full item, the seller and a click-to-call button (no cart — buying
// happens over the phone).
@Component({
  selector: 'app-marketplace-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink, IconComponent],
  template: `
    <div class="container">
      <a routerLink="/marketplace" class="back muted">← Back to marketplace</a>

      @if (loading()) {
        <div class="spinner">Loading…</div>
      } @else if (!listing()) {
        <div class="empty">
          <div class="big"><app-icon name="marketplace" [size]="56" /></div>
          <p>This listing could not be found. It may have been removed.</p>
          <a routerLink="/marketplace" class="btn ghost">Browse the marketplace</a>
        </div>
      } @else {
        <div class="detail">
          <div class="media card">
            @if (listing()!.image) { <img [src]="listing()!.image" [alt]="listing()!.title" /> }
            @else { <div class="ph"><app-icon name="image" [size]="64" /></div> }
          </div>

          <div class="info card">
            <div class="cat">{{ listing()!.category }}</div>
            <h1>{{ listing()!.title }}</h1>
            <div class="price">{{ price(listing()!) }}</div>

            <div class="meta">
              <span><app-icon name="user" [size]="16" /> {{ listing()!.seller_name || 'Seller' }}</span>
              @if (listing()!.location) {
                <span><app-icon name="location" [size]="16" /> {{ listing()!.location }}{{ listing()!.country ? ', ' + listing()!.country : '' }}</span>
              }
              <span><app-icon name="orders" [size]="16" /> Posted {{ listing()!.created_at | date: 'mediumDate' }}</span>
            </div>

            @if (listing()!.description) {
              <h3>Description</h3>
              <p class="desc">{{ listing()!.description }}</p>
            }

            <div class="call-box">
              <p class="muted" style="margin:0 0 8px">Interested? Call the seller to arrange the purchase.</p>
              <a class="btn block success" [href]="'tel:' + listing()!.phone">
                <app-icon name="phone" [size]="16" /> {{ listing()!.phone }}
              </a>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `.back { display:inline-flex; align-items:center; gap:4px; text-decoration:none; margin-bottom:16px; }
     .detail { display:grid; grid-template-columns: 1fr 1fr; gap:20px; align-items:start; }
     @media (max-width: 820px) { .detail { grid-template-columns: 1fr; } }
     .media { padding:0; overflow:hidden; display:flex; align-items:center; justify-content:center; min-height:320px; }
     .media img { width:100%; height:100%; max-height:480px; object-fit:cover; display:block; }
     .media .ph { color:var(--muted); }
     .info { padding:24px; }
     .info .cat { color:var(--muted); font-size:.82rem; text-transform:uppercase; letter-spacing:.04em; }
     .info h1 { margin:6px 0 10px; }
     .info .price { font-size:1.8rem; font-weight:700; color:var(--brand); margin-bottom:16px; }
     .meta { display:flex; flex-direction:column; gap:8px; color:var(--muted); font-size:.9rem; margin-bottom:18px; }
     .meta span { display:inline-flex; align-items:center; gap:6px; }
     .desc { white-space:pre-wrap; line-height:1.6; }
     .call-box { margin-top:20px; padding-top:18px; border-top:1px solid var(--border); }
     a.btn.block { display:flex; align-items:center; justify-content:center; gap:6px; text-decoration:none; }`,
  ],
})
export class MarketplaceDetailComponent implements OnInit {
  listing = signal<Listing | null>(null);
  loading = signal<boolean>(true);

  constructor(private route: ActivatedRoute, private listingSvc: ListingService) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.listingSvc.get(id).subscribe({
      next: (r) => {
        this.listing.set(r.listing);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  price(l: Listing): string {
    return formatPrice(l.price, l.currency);
  }
}

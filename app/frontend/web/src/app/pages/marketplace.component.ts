import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ListingService } from '../core/listing.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../core/icon.component';
import { Listing } from '../core/models';
import { formatPrice } from '../core/countries';

// Public marketplace: browse items other users have posted and call the seller
// to arrange the purchase. No cart — buying happens over the phone.
@Component({
  selector: 'app-marketplace',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="container">
      <div class="page-head">
        <div>
          <h1>Marketplace</h1>
          <p class="muted">Items posted by people in the community. See something you like? Call the seller.</p>
        </div>
        @if (auth.isLoggedIn()) {
          <a routerLink="/sell" class="btn cta"><app-icon name="plus" [size]="16" /> Post an item</a>
        } @else {
          <a routerLink="/login" [queryParams]="{ redirect: '/sell' }" class="btn ghost">Sign in to sell</a>
        }
      </div>

      <div class="toolbar">
        <div class="search">
          <input
            type="search"
            placeholder="Search the marketplace…"
            [(ngModel)]="search"
            (ngModelChange)="onSearch()"
          />
        </div>
        <div class="chips">
          @for (c of categories(); track c) {
            <button class="chip" [class.active]="c === category()" (click)="setCategory(c)">{{ c }}</button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="spinner">Loading listings…</div>
      } @else if (listings().length === 0) {
        <div class="empty">
          <div class="big"><app-icon name="marketplace" [size]="56" /></div>
          <p>No listings yet. @if (auth.isLoggedIn()) { <a routerLink="/sell">Be the first to post one.</a> }</p>
        </div>
      } @else {
        <div class="grid">
          @for (l of listings(); track l.id) {
            <div class="card product" (click)="open(l)" style="cursor:pointer">
              <div class="media">
                @if (l.image) { <img [src]="l.image" [alt]="l.title" /> }
                @else { <app-icon name="image" [size]="44" /> }
              </div>
              <div class="cat">{{ l.category }}</div>
              <h3>{{ l.title }}</h3>
              <p class="desc">{{ l.description }}</p>
              <div class="seller muted">
                <span><app-icon name="user" [size]="14" /> {{ l.seller_name || 'Seller' }}</span>
                @if (l.location) { <span><app-icon name="location" [size]="14" /> {{ l.location }}{{ l.country ? ', ' + l.country : '' }}</span> }
              </div>
              <div class="row spread" style="margin-top:12px">
                <span class="price">{{ price(l) }}</span>
                <a class="btn sm success" [href]="'tel:' + l.phone" title="Call the seller" (click)="$event.stopPropagation()">
                  <app-icon name="phone" [size]="14" /> {{ l.phone }}
                </a>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `.btn.cta { display:inline-flex; align-items:center; gap:6px; text-decoration:none; }
     .media {
       display:flex; align-items:center; justify-content:center; height:160px; overflow:hidden;
       border-radius:12px; background:var(--bg); color:var(--muted); margin-bottom:12px;
     }
     .media img { width:100%; height:100%; object-fit:cover; }
     .seller { display:flex; flex-wrap:wrap; gap:12px; font-size:0.82rem; }
     .seller span { display:inline-flex; align-items:center; gap:4px; }
     a.btn.sm { display:inline-flex; align-items:center; gap:5px; text-decoration:none; }`,
  ],
})
export class MarketplaceComponent implements OnInit {
  listings = signal<Listing[]>([]);
  categories = signal<string[]>(['All']);
  category = signal<string>('All');
  loading = signal<boolean>(true);
  search = '';
  private debounce?: any;

  constructor(
    private listingSvc: ListingService,
    public auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.listingSvc.categories().subscribe((r) => this.categories.set(['All', ...r.categories]));
    this.load();
  }

  open(l: Listing): void {
    this.router.navigate(['/marketplace', l.id]);
  }

  price(l: Listing): string {
    return formatPrice(l.price, l.currency);
  }

  load(): void {
    this.loading.set(true);
    this.listingSvc.list(this.search, this.category()).subscribe({
      next: (r) => {
        this.listings.set(r.listings);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 250);
  }

  setCategory(c: string): void {
    this.category.set(c);
    this.load();
  }
}

import { Component, OnInit, computed, effect, signal, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CartService } from './core/cart.service';
import { WishlistService } from './core/wishlist.service';
import { NotificationService } from './core/notification.service';
import { ThemeService } from './core/theme.service';
import { TourService } from './core/tour.service';
import { IconComponent } from './core/icon.component';
import { ChatWidgetComponent } from './chat-widget.component';

const COLLAPSE_KEY = 'shopnow.sidebarCollapsed';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ChatWidgetComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  // Sidebar is always visible on desktop; on mobile it slides in/out.
  readonly sidebarOpen = signal(false);

  // Desktop only: collapse the sidebar to a slim icon rail. Persisted so the
  // user's preference survives reloads.
  readonly collapsed = signal(this.readCollapsed());

  // Initials shown in the sidebar profile avatar (e.g. "Demo Customer" -> "DC").
  readonly initials = computed(() => {
    const u = this.auth.user();
    const base = (u?.name || u?.email || '?').trim();
    const parts = base.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2);
    return letters.toUpperCase();
  });

  constructor(
    public auth: AuthService,
    public cart: CartService,
    public wishlist: WishlistService,
    public notif: NotificationService,
    public theme: ThemeService,
    public tour: TourService,
    private router: Router
  ) {
    // Whenever the logged-in user changes, sync per-user state: load the cart,
    // wishlist and notifications on login, empty the in-memory copies on logout.
    effect(() => {
      const loggedIn = this.auth.isLoggedIn();
      // These calls write other services' signals. Run them untracked so the
      // writes aren't attributed to this reactive context / the change-detection
      // pass that scheduled the effect (avoids NG0600).
      untracked(() => {
        if (loggedIn) {
          this.cart.refresh();
          this.wishlist.refresh();
          this.notif.refresh();
        } else {
          this.cart.reset();
          this.wishlist.reset();
          this.notif.reset();
        }
      });
    });
  }

  ngOnInit(): void {
    this.theme.init();
    // First-visit walkthrough (desktop only; no-op once seen).
    this.tour.maybeAutoStart();
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  toggleCollapse(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* storage may be unavailable — collapse still applies for the session */
    }
  }

  private readCollapsed(): boolean {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  }

  logout(): void {
    this.auth.logout();
    this.closeSidebar();
    this.router.navigate(['/']);
  }
}

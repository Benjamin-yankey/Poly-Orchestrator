import { Component, computed, effect, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CartService } from './core/cart.service';
import { WishlistService } from './core/wishlist.service';
import { NotificationService } from './core/notification.service';
import { IconComponent } from './core/icon.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Sidebar is always visible on desktop; on mobile it slides in/out.
  readonly sidebarOpen = signal(false);

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
    private router: Router
  ) {
    // Whenever the logged-in user changes, sync per-user state: load the cart,
    // wishlist and notifications on login, empty the in-memory copies on logout.
    effect(() => {
      if (this.auth.isLoggedIn()) {
        this.cart.refresh();
        this.wishlist.refresh();
        this.notif.refresh();
      } else {
        this.cart.reset();
        this.wishlist.reset();
        this.notif.reset();
      }
    });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  logout(): void {
    this.auth.logout();
    this.closeSidebar();
    this.router.navigate(['/']);
  }
}

import { Component, effect } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CartService } from './core/cart.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  constructor(public auth: AuthService, public cart: CartService, private router: Router) {
    // Whenever the logged-in user changes, sync the cart: load it on login,
    // empty the in-memory copy on logout.
    effect(() => {
      if (this.auth.isLoggedIn()) this.cart.refresh();
      else this.cart.reset();
    });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}

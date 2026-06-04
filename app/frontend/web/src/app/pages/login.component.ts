import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../core/icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <div class="auth-page">
      <div class="auth-hero">
        <span class="pill"><app-icon name="marketplace" [size]="14" /> ShopNow Marketplace</span>
        <h2>Welcome back to the marketplace</h2>
        <p>Sign in to shop the catalog, track your orders and sell to the community.</p>
      </div>
      <div class="card auth-card">
        <h1>Welcome back</h1>
        <p class="muted">Sign in to your ShopNow account.</p>

        @if (error()) { <div class="alert error">{{ error() }}</div> }

        <form (ngSubmit)="submit()">
          <label>Email</label>
          <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" />
          <label>Password</label>
          <input type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" />
          <button class="btn block" style="margin-top:18px" [disabled]="loading()">
            {{ loading() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <p class="muted center" style="margin-top:18px">
          New here? <a routerLink="/register" [queryParams]="{ redirect }">Create an account</a>
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  email = '';
  password = '';
  loading = signal(false);
  error = signal('');
  redirect = '/';

  constructor(private auth: AuthService, private router: Router, route: ActivatedRoute) {
    this.redirect = route.snapshot.queryParamMap.get('redirect') || '/';
  }

  submit(): void {
    this.error.set('');
    this.loading.set(true);
    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigateByUrl(this.redirect),
      error: (e) => {
        this.error.set(e?.error?.error || 'Sign in failed');
        this.loading.set(false);
      },
    });
  }
}

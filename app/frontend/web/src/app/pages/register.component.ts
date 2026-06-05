import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../core/icon.component';
import { GoogleButtonComponent } from './google-button.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, GoogleButtonComponent],
  template: `
    <div class="auth-page">
      <div class="auth-hero">
        <span class="pill"><app-icon name="marketplace" [size]="14" /> ShopNow Marketplace</span>
        <h2>Join the marketplace</h2>
        <p>Create an account to buy quality gear and post your own items for sale.</p>
      </div>
      <div class="card auth-card">
        <h1>Create your account</h1>
        <p class="muted">Join ShopNow in a few seconds. Your name shows on your profile and listings.</p>

        @if (error()) { <div class="alert error">{{ error() }}</div> }

        <form (ngSubmit)="submit()">
          <label>Full name</label>
          <input type="text" name="name" [(ngModel)]="name" required autocomplete="name" placeholder="e.g. Ama Mensah" />

          <label>Email</label>
          <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" placeholder="you@example.com" />

          <label>Password</label>
          <input type="password" name="password" [(ngModel)]="password" required minlength="6"
                 autocomplete="new-password" placeholder="At least 6 characters" />
          @if (password) {
            <div class="pw-meter"><span class="bar" [class]="strengthClass()" [style.width.%]="strengthPct()"></span></div>
            <small class="muted">Password strength: {{ strengthLabel() }}</small>
          }

          <label>Confirm password</label>
          <input type="password" name="confirm" [(ngModel)]="confirm" required autocomplete="new-password"
                 placeholder="Re-enter your password" />
          @if (confirm && confirm !== password) {
            <small style="color:var(--danger)">Passwords don't match.</small>
          }

          <button class="btn block" style="margin-top:18px" [disabled]="loading()">
            {{ loading() ? 'Creating…' : 'Create account' }}
          </button>
        </form>

        <app-google-button [redirect]="redirect" (failed)="error.set($event)" />

        <p class="muted center" style="margin-top:18px">
          Already have an account? <a routerLink="/login" [queryParams]="{ redirect }">Sign in</a>
        </p>
      </div>
    </div>
  `,
  styles: [
    `.pw-meter { height:6px; border-radius:999px; background:var(--bg); overflow:hidden; margin:8px 0 4px; }
     .pw-meter .bar { display:block; height:100%; transition:width .2s ease, background .2s ease; }
     .pw-meter .bar.weak { background:var(--danger); }
     .pw-meter .bar.fair { background:var(--warn); }
     .pw-meter .bar.strong { background:var(--accent); }`,
  ],
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  confirm = '';
  loading = signal(false);
  error = signal('');
  redirect = '/';

  constructor(private auth: AuthService, private router: Router, route: ActivatedRoute) {
    this.redirect = route.snapshot.queryParamMap.get('redirect') || '/';
  }

  // 0–3 score from length + character variety, used by the strength meter.
  private score(): number {
    const p = this.password;
    let s = 0;
    if (p.length >= 6) s++;
    if (p.length >= 10) s++;
    if (/[0-9]/.test(p) && /[A-Za-z]/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
    return s;
  }
  strengthPct(): number { return [10, 45, 75, 100][this.score()]; }
  strengthClass(): string { return ['weak', 'weak', 'fair', 'strong'][this.score()]; }
  strengthLabel(): string { return ['too short', 'weak', 'fair', 'strong'][this.score()]; }

  submit(): void {
    this.error.set('');
    if (!this.name.trim()) return this.error.set('Please enter your name.');
    if (this.password.length < 6) return this.error.set('Password must be at least 6 characters.');
    if (this.password !== this.confirm) return this.error.set('Passwords do not match.');

    this.loading.set(true);
    this.auth.register(this.email.trim(), this.password, this.name.trim()).subscribe({
      next: () => this.router.navigateByUrl(this.redirect),
      error: (e) => {
        this.error.set(e?.error?.error || 'Registration failed');
        this.loading.set(false);
      },
    });
  }
}

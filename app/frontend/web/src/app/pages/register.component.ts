import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="container">
      <div class="card auth-card">
        <h1>Create your account</h1>
        <p class="muted">Join ShopNow in a few seconds.</p>

        @if (error()) { <div class="alert error">{{ error() }}</div> }

        <form (ngSubmit)="submit()">
          <label>Full name</label>
          <input type="text" name="name" [(ngModel)]="name" autocomplete="name" />
          <label>Email</label>
          <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" />
          <label>Password</label>
          <input type="password" name="password" [(ngModel)]="password" required minlength="6" autocomplete="new-password" />
          <button class="btn block" style="margin-top:18px" [disabled]="loading()">
            {{ loading() ? 'Creating…' : 'Create account' }}
          </button>
        </form>

        <p class="muted center" style="margin-top:18px">
          Already have an account? <a routerLink="/login" [queryParams]="{ redirect }">Sign in</a>
        </p>
      </div>
    </div>
  `,
})
export class RegisterComponent {
  name = '';
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
    this.auth.register(this.email, this.password, this.name).subscribe({
      next: () => this.router.navigateByUrl(this.redirect),
      error: (e) => {
        this.error.set(e?.error?.error || 'Registration failed');
        this.loading.set(false);
      },
    });
  }
}

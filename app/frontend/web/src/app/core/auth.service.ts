import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AuthResponse, ProfileUpdate, User } from './models';

const TOKEN_KEY = 'shopnow_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  // Reactive auth state. Components read these signals directly.
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  // Admins manage everything; the staffing team has read-only management access.
  // Both may open the admin console — write controls are gated on isAdmin().
  readonly canViewAdmin = computed(
    () => this.user()?.role === 'admin' || this.user()?.role === 'staffing_team'
  );

  constructor(private http: HttpClient) {
    // If a token survived a refresh, re-hydrate the profile from the server.
    if (localStorage.getItem(TOKEN_KEY)) {
      this.http.get<{ user: User }>('/api/auth/me').subscribe({
        next: (r) => this.user.set(r.user),
        error: () => this.clear(),
      });
    }
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(tap((r) => this.persist(r)));
  }

  register(email: string, password: string, name: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/register', { email, password, name })
      .pipe(tap((r) => this.persist(r)));
  }

  // Update the signed-in user's profile (name and/or password). On success the
  // reactive user signal is refreshed so the whole app reflects the new name.
  updateProfile(changes: ProfileUpdate): Observable<{ user: User }> {
    return this.http
      .put<{ user: User }>('/api/auth/me', changes)
      .pipe(tap((r) => this.user.set(r.user)));
  }

  logout(): void {
    this.clear();
  }

  private persist(r: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, r.token);
    this.user.set(r.user);
  }

  private clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.user.set(null);
  }
}

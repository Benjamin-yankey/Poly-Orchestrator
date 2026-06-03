import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { SiteSettings } from './models';

// Editable site content (homepage banner, store name). The public GET is open;
// the PUT is admin-only on the core API. The reactive `current` signal lets the
// storefront render the banner/store name without re-fetching.
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly current = signal<SiteSettings>({});

  constructor(private http: HttpClient) {}

  load(): void {
    this.http.get<{ settings: SiteSettings }>('/api/settings').subscribe({
      next: (r) => this.current.set(r.settings),
      error: () => {},
    });
  }

  get(): Observable<{ settings: SiteSettings }> {
    return this.http
      .get<{ settings: SiteSettings }>('/api/settings')
      .pipe(tap((r) => this.current.set(r.settings)));
  }

  update(changes: SiteSettings): Observable<{ settings: SiteSettings }> {
    return this.http
      .put<{ settings: SiteSettings }>('/api/admin/settings', changes)
      .pipe(tap((r) => this.current.set(r.settings)));
  }
}

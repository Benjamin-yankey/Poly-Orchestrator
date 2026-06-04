import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AppNotification } from './models';

// In-app notifications (Products/core API, Postgres). Held in a signal so the
// sidebar bell badge and the notifications page stay in sync.
@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly items = signal<AppNotification[]>([]);
  readonly unread = signal<number>(0);
  readonly hasUnread = computed(() => this.unread() > 0);

  constructor(private http: HttpClient) {}

  refresh(): void {
    this.http
      .get<{ notifications: AppNotification[]; unread: number }>('/api/notifications')
      .subscribe({
        next: (r) => {
          this.items.set(r.notifications);
          this.unread.set(r.unread);
        },
        error: () => this.reset(),
      });
  }

  reset(): void {
    this.items.set([]);
    this.unread.set(0);
  }

  markRead(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`/api/notifications/${id}/read`, {}).pipe(
      tap(() => {
        this.items.update((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
        this.unread.update((n) => Math.max(0, n - 1));
      })
    );
  }

  markAllRead(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/notifications/read-all', {}).pipe(
      tap(() => {
        this.items.update((list) => list.map((n) => ({ ...n, read: true })));
        this.unread.set(0);
      })
    );
  }
}

import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationService } from '../core/notification.service';
import { IconComponent } from '../core/icon.component';
import { AppNotification } from '../core/models';

// In-app notification feed. Clicking a notification marks it read and follows
// its link (order/return/support). Guarded by authGuard.
@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, DatePipe, IconComponent],
  template: `
    <div class="container">
      <div class="page-head">
        <div><h1>Notifications</h1><p class="muted">Order updates, returns and support replies.</p></div>
        @if (notif.hasUnread()) { <button class="btn ghost" (click)="markAll()">Mark all read</button> }
      </div>

      @if (notif.items().length === 0) {
        <div class="empty"><div class="big"><app-icon name="bell" [size]="56" /></div><p>You're all caught up.</p></div>
      } @else {
        <div class="card" style="padding:6px 8px">
          @for (n of notif.items(); track n.id) {
            <div class="note" [class.unread]="!n.read" (click)="open(n)">
              <div class="dot" [class.on]="!n.read"></div>
              <div class="body">
                <div class="row spread">
                  <strong>{{ n.title }}</strong>
                  <span class="muted" style="font-size:.78rem">{{ n.created_at | date: 'short' }}</span>
                </div>
                @if (n.body) { <p class="muted" style="margin:2px 0 0">{{ n.body }}</p> }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `.note { display:flex; gap:12px; align-items:flex-start; padding:14px 12px; border-bottom:1px solid var(--border); cursor:pointer; border-radius:8px; }
     .note:last-child { border-bottom:none; }
     .note:hover { background:var(--bg); }
     .note.unread { background:color-mix(in srgb, var(--brand) 5%, transparent); }
     .dot { width:9px; height:9px; border-radius:999px; flex:none; margin-top:6px; background:transparent; }
     .dot.on { background:var(--brand); }
     .body { flex:1; min-width:0; }`,
  ],
})
export class NotificationsComponent implements OnInit {
  constructor(public notif: NotificationService, private router: Router) {}

  ngOnInit(): void {
    this.notif.refresh();
  }

  open(n: AppNotification): void {
    if (!n.read) this.notif.markRead(n.id).subscribe();
    if (n.link) this.router.navigateByUrl(n.link);
  }

  markAll(): void {
    this.notif.markAllRead().subscribe();
  }
}

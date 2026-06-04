import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupportService } from '../core/support.service';
import { IconComponent } from '../core/icon.component';
import { SupportMessage, SupportTicket } from '../core/models';

// Support center: open tickets, browse your existing ones and chat with the
// support team. Guarded by authGuard.
@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, IconComponent],
  template: `
    <div class="container">
      <div class="page-head">
        <div><h1>Support center</h1><p class="muted">Questions, problems or feedback — we're here to help.</p></div>
        @if (!composing()) { <button class="btn" (click)="startCompose()"><app-icon name="plus" [size]="16" /> New ticket</button> }
      </div>

      @if (composing()) {
        <div class="card pad" style="margin-bottom:18px">
          <h3 style="margin-top:0">Open a new ticket</h3>
          @if (error()) { <div class="alert error">{{ error() }}</div> }
          <label>Subject</label>
          <input [(ngModel)]="subject" placeholder="Brief summary of your issue" />
          <label>How can we help?</label>
          <textarea rows="4" [(ngModel)]="message" placeholder="Describe your question or problem"></textarea>
          <div class="row" style="margin-top:14px">
            <button class="btn" [disabled]="sending()" (click)="submit()">{{ sending() ? 'Sending…' : 'Submit ticket' }}</button>
            <button class="btn ghost" (click)="composing.set(false)">Cancel</button>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="spinner">Loading…</div>
      } @else if (tickets().length === 0) {
        <div class="empty"><div class="big"><app-icon name="message" [size]="56" /></div><p>No support tickets yet.</p></div>
      } @else {
        @for (t of tickets(); track t.id) {
          <div class="card" style="padding:16px 20px;margin-bottom:12px">
            <div class="row spread" style="cursor:pointer" (click)="openThread(t)">
              <div>
                <strong>{{ t.subject }}</strong>
                <span class="tag" [ngClass]="statusClass(t.status)" style="margin-left:8px">{{ t.status }}</span>
                <div class="muted" style="font-size:.82rem">Updated {{ t.updated_at | date: 'medium' }} · {{ t.messages }} message(s)</div>
              </div>
              <app-icon [name]="active() === t.id ? 'chevron-up' : 'chevron-down'" [size]="18" class="muted" />
            </div>

            @if (active() === t.id) {
              <div class="thread">
                @for (m of messages(); track m.id) {
                  <div class="msg" [class.staff]="m.author_role === 'staff'">
                    <div class="bubble">
                      <div class="who">{{ m.author_role === 'staff' ? 'Support' : (m.author || 'You') }} · <span class="muted">{{ m.created_at | date: 'short' }}</span></div>
                      <p>{{ m.body }}</p>
                    </div>
                  </div>
                }
              </div>
              @if (t.status !== 'closed') {
                <div class="row" style="gap:8px;margin-top:10px;align-items:flex-start">
                  <textarea rows="2" [(ngModel)]="replyBody" placeholder="Write a reply…" style="flex:1"></textarea>
                  <button class="btn" [disabled]="replying()" (click)="sendReply(t)">Send</button>
                </div>
              } @else {
                <p class="muted" style="margin-top:10px">This ticket is closed.</p>
              }
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `.card.pad { padding:20px; }
     .tag.status-open { background:#eef2ff; color:var(--brand); }
     .tag.status-pending { background:#fef3c7; color:#92400e; }
     .tag.status-resolved { background:#ecfdf5; color:#059669; }
     .tag.status-closed { background:var(--bg); color:var(--muted); }
     .thread { margin-top:14px; border-top:1px solid var(--border); padding-top:14px; display:flex; flex-direction:column; gap:10px; }
     .msg { display:flex; }
     .msg.staff { justify-content:flex-end; }
     .bubble { max-width:75%; background:var(--bg); border:1px solid var(--border); border-radius:12px; padding:10px 14px; }
     .msg.staff .bubble { background:#eef2ff; border-color:#dbe3ff; }
     .bubble .who { font-size:.78rem; font-weight:600; margin-bottom:4px; }
     .bubble p { margin:0; white-space:pre-wrap; }`,
  ],
})
export class SupportComponent implements OnInit {
  tickets = signal<SupportTicket[]>([]);
  loading = signal(true);
  composing = signal(false);
  sending = signal(false);
  error = signal('');
  subject = '';
  message = '';

  active = signal<number | null>(null);
  messages = signal<SupportMessage[]>([]);
  replyBody = '';
  replying = signal(false);

  constructor(private support: SupportService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.support.myTickets().subscribe({
      next: (r) => {
        this.tickets.set(r.tickets);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  statusClass(status: string): string {
    return 'status-' + status;
  }

  startCompose(): void {
    this.subject = '';
    this.message = '';
    this.error.set('');
    this.composing.set(true);
  }

  submit(): void {
    this.error.set('');
    if (!this.subject.trim() || !this.message.trim()) {
      return this.error.set('Please fill in both a subject and a message.');
    }
    this.sending.set(true);
    this.support.open(this.subject.trim(), this.message.trim()).subscribe({
      next: () => {
        this.sending.set(false);
        this.composing.set(false);
        this.load();
      },
      error: (e) => {
        this.sending.set(false);
        this.error.set(e?.error?.error || 'Could not open ticket.');
      },
    });
  }

  openThread(t: SupportTicket): void {
    if (this.active() === t.id) {
      this.active.set(null);
      return;
    }
    this.active.set(t.id);
    this.replyBody = '';
    this.support.get(t.id).subscribe((r) => this.messages.set(r.messages));
  }

  sendReply(t: SupportTicket): void {
    const body = this.replyBody.trim();
    if (!body) return;
    this.replying.set(true);
    this.support.reply(t.id, body).subscribe({
      next: (r) => {
        this.replying.set(false);
        this.replyBody = '';
        this.messages.update((list) => [...list, r.message]);
        this.load();
      },
      error: () => this.replying.set(false),
    });
  }
}

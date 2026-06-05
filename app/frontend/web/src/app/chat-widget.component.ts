import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from './core/auth.service';
import { SupportService } from './core/support.service';
import { ChatService } from './core/chat.service';
import { IconComponent } from './core/icon.component';

interface ChatMsg {
  from: 'bot' | 'user';
  text: string;
  at: Date;
  // Optional inline link rendered under a bot message (e.g. sign-in / support).
  link?: { href: string; label: string };
}

// Floating assistant widget, present on every page via the app shell. There's no
// AI behind it yet — "for now" every question the visitor sends is forwarded to
// the support team and admin by opening a support ticket (and threading follow-up
// messages onto it), so it shows up in the support queue and pings management.
@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  template: `
    <!-- Launcher -->
    <button
      class="launcher"
      [class.is-open]="open()"
      (click)="toggle()"
      [attr.aria-label]="open() ? 'Close assistant' : 'Open assistant'"
    >
      <app-icon [name]="open() ? 'x' : 'chat'" [size]="26" />
    </button>

    @if (open()) {
      <section class="panel" role="dialog" aria-label="ShopNow Assistant">
        <header class="head">
          <span class="avatar">S</span>
          <div class="who">
            <strong>ShopNow Assistant</strong>
            <span class="status"><span class="ping"></span> Online</span>
          </div>
          <button class="close" (click)="toggle()" aria-label="Close"><app-icon name="x" [size]="18" /></button>
        </header>

        <div class="log" #log>
          @for (m of messages(); track $index) {
            <div class="msg" [class.user]="m.from === 'user'">
              <div class="bubble">
                {{ m.text }}
                @if (m.link) {
                  <a class="inline-link" [routerLink]="m.link.href" (click)="toggle()">{{ m.link.label }}</a>
                }
                <span class="time">{{ m.at | date: 'shortTime' }}</span>
              </div>
            </div>
          }
          @if (sending()) {
            <div class="msg"><div class="bubble typing"><span></span><span></span><span></span></div></div>
          }
        </div>

        <!-- Quick replies (shown until the conversation gets going). -->
        @if (messages().length <= 1) {
          <div class="quick">
            @for (q of quickReplies; track q) {
              <button class="chip" (click)="send(q)">{{ q }}</button>
            }
          </div>
        }

        <form class="composer" (ngSubmit)="send(draft)">
          <input
            [(ngModel)]="draft"
            name="draft"
            placeholder="Ask a question…"
            autocomplete="off"
            [disabled]="sending()"
          />
          <button type="submit" class="send" [disabled]="sending() || !draft.trim()" aria-label="Send">
            <app-icon name="send" [size]="18" />
          </button>
        </form>
      </section>
    }
  `,
  styles: [
    `
      :host { position: fixed; right: 22px; bottom: 22px; z-index: 56; }

      /* Floating launcher button. */
      .launcher {
        width: 58px; height: 58px; border-radius: 999px; border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center; color: #fff;
        background: linear-gradient(135deg, var(--brand), #7c3aed);
        box-shadow: 0 10px 26px rgba(79, 70, 229, 0.45);
        transition: transform .15s ease, box-shadow .15s ease;
      }
      .launcher:hover { transform: translateY(-2px); }
      .launcher.is-open { background: var(--surface); color: var(--ink); border: 1px solid var(--border); }

      /* Conversation panel. */
      .panel {
        position: absolute; right: 0; bottom: 72px; width: 360px; max-width: calc(100vw - 32px);
        height: 540px; max-height: calc(100vh - 120px);
        display: flex; flex-direction: column; overflow: hidden;
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 18px; box-shadow: 0 24px 60px rgba(16, 24, 40, 0.28);
        animation: pop .16s ease;
      }
      @keyframes pop { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

      .head {
        display: flex; align-items: center; gap: 12px; padding: 14px 16px; color: #fff;
        background: linear-gradient(120deg, var(--brand), #7c3aed);
      }
      .head .avatar {
        width: 38px; height: 38px; flex: none; border-radius: 999px; display: flex;
        align-items: center; justify-content: center; font-weight: 800;
        background: rgba(255, 255, 255, 0.22);
      }
      .head .who { display: flex; flex-direction: column; line-height: 1.2; margin-right: auto; }
      .head .who strong { font-size: 0.98rem; }
      .head .status { display: inline-flex; align-items: center; gap: 6px; font-size: 0.76rem; opacity: 0.92; }
      .head .ping { width: 8px; height: 8px; border-radius: 999px; background: #4ade80; box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.3); }
      .head .close { border: none; background: transparent; color: #fff; cursor: pointer; opacity: 0.9; padding: 4px; }
      .head .close:hover { opacity: 1; }

      .log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: var(--bg); }
      .msg { display: flex; }
      .msg.user { justify-content: flex-end; }
      .bubble {
        max-width: 80%; padding: 9px 12px 18px; border-radius: 14px; position: relative;
        font-size: 0.9rem; background: var(--surface); border: 1px solid var(--border); color: var(--ink);
      }
      .msg.user .bubble { background: var(--brand); border-color: var(--brand); color: #fff; }
      .bubble .time { position: absolute; right: 10px; bottom: 4px; font-size: 0.64rem; opacity: 0.6; }
      .bubble .inline-link { display: inline-block; margin-top: 6px; font-weight: 700; }
      .msg.user .bubble .inline-link { color: #fff; text-decoration: underline; }

      /* Typing indicator. */
      .typing { display: inline-flex; gap: 4px; padding: 12px; }
      .typing span { width: 7px; height: 7px; border-radius: 999px; background: var(--muted); animation: blink 1.2s infinite both; }
      .typing span:nth-child(2) { animation-delay: .2s; }
      .typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

      .quick { display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; }
      .chip {
        border: 1px solid var(--brand); background: var(--surface); color: var(--brand);
        border-radius: 999px; padding: 9px 14px; font-weight: 700; font-size: 0.85rem; cursor: pointer;
        transition: background .15s ease, color .15s ease;
      }
      .chip:hover { background: var(--brand); color: #fff; }

      .composer { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--border); background: var(--surface); }
      .composer input { flex: 1; border-radius: 999px; padding: 10px 14px; }
      .composer .send {
        flex: none; width: 42px; height: 42px; border-radius: 12px; border: none; cursor: pointer; color: #fff;
        background: var(--brand); display: flex; align-items: center; justify-content: center;
      }
      .composer .send:hover { background: var(--brand-dark); }
      .composer .send:disabled { opacity: .5; cursor: not-allowed; }

      @media (max-width: 480px) {
        :host { right: 14px; bottom: 14px; }
        .panel { right: 0; bottom: 70px; }
      }
    `,
  ],
})
export class ChatWidgetComponent {
  readonly sending = signal(false);
  readonly messages = signal<ChatMsg[]>([this.greeting()]);
  draft = '';

  readonly quickReplies = ['Track my order', 'Return or refund', 'Talk to support'];

  // The ticket this chat session is threaded onto (created on the first send).
  private ticketId: number | null = null;

  constructor(
    private auth: AuthService,
    private support: SupportService,
    private chat: ChatService,
  ) {}

  // Open/closed state is shared so other pages can launch the assistant.
  get open() {
    return this.chat.isOpen;
  }

  toggle(): void {
    this.chat.toggle();
  }

  send(text: string): void {
    const body = (text || '').trim();
    if (!body || this.sending()) return;
    this.push({ from: 'user', text: body, at: new Date() });
    this.draft = '';

    // No auth = no way to route to the team (and no place for them to reply).
    if (!this.auth.isLoggedIn()) {
      this.push({
        from: 'bot',
        text: 'Please sign in so our team can pick this up and reply to you.',
        at: new Date(),
        link: { href: '/login', label: 'Sign in / Register →' },
      });
      return;
    }

    this.sending.set(true);
    const done = () => {
      this.sending.set(false);
      this.push({
        from: 'bot',
        text: "Thanks! I've shared this with our support team and admin. You can follow the conversation in your Support center.",
        at: new Date(),
        link: { href: '/support', label: 'Open Support center →' },
      });
    };
    const fail = () => {
      this.sending.set(false);
      this.push({
        from: 'bot',
        text: "Sorry — I couldn't send that just now. Please try again in a moment.",
        at: new Date(),
      });
    };

    if (this.ticketId === null) {
      // First message opens the ticket; the subject is a short preview of it.
      this.support.open(this.subject(body), body).subscribe({
        next: (r) => {
          this.ticketId = r.ticket.id;
          done();
        },
        error: fail,
      });
    } else {
      this.support.reply(this.ticketId, body).subscribe({ next: done, error: fail });
    }
  }

  private subject(body: string): string {
    const s = body.replace(/\s+/g, ' ').trim();
    return s.length <= 48 ? s : s.slice(0, 48) + '…';
  }

  private greeting(): ChatMsg {
    return {
      from: 'bot',
      text: "Hi there! I'm the ShopNow Assistant. How can I help you today?",
      at: new Date(),
    };
  }

  private push(m: ChatMsg): void {
    this.messages.update((list) => [...list, m]);
  }
}

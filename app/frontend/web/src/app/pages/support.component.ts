import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupportService } from '../core/support.service';
import { OrderService } from '../core/order.service';
import { AuthService } from '../core/auth.service';
import { ChatService } from '../core/chat.service';
import { IconComponent } from '../core/icon.component';
import { Order, SupportMessage, SupportTicket } from '../core/models';

interface Faq {
  q: string;
  a: string;
}
interface FaqGroup {
  cat: string;
  icon: string;
  faqs: Faq[];
}

// Support center. Public-facing help hub: hero, browsable FAQs, contact channels,
// order tracking and a ticket form. Logged-in customers also get a dashboard with
// their tickets and quick links. Submitting a ticket forwards it to the support
// team + admin via the existing ticket API (no separate mailbox yet).
@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, RouterLink, IconComponent],
  template: `
    <div class="container support">
      <!-- ===== Hero ===== -->
      <section class="hero card">
        <span class="eyebrow">Customer Support</span>
        <h1>Need help? We're here for you</h1>
        <p>
          Get assistance with orders, payments, returns, deliveries and account
          issues. We're committed to providing exceptional service whenever you
          need it.
        </p>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <button class="btn" (click)="scrollTo('contact')">
            <app-icon name="message" [size]="16" /> Contact support
          </button>
          <button class="btn ghost" (click)="scrollTo('track')">
            <app-icon name="truck" [size]="16" /> Track an order
          </button>
        </div>
      </section>

      <!-- ===== Help categories ===== -->
      <section id="help">
        <h2>How can we help?</h2>
        <div class="cat-grid">
          @for (g of groups; track g.cat) {
            <button
              class="cat-card card"
              [class.active]="activeCat() === g.cat"
              (click)="filterFaq(g.cat)"
            >
              <span class="cat-ico"
                ><app-icon [name]="g.icon" [size]="22"
              /></span>
              <span class="cat-name">{{ g.cat }}</span>
            </button>
          }
        </div>
      </section>

      <!-- ===== FAQs ===== -->
      <section id="faqs">
        <div class="row spread" style="flex-wrap:wrap;gap:10px">
          <h2 style="margin:0">Frequently asked questions</h2>
          @if (activeCat() !== 'All') {
            <button class="btn ghost sm" (click)="filterFaq('All')">
              Show all categories
            </button>
          }
        </div>

        @for (g of visibleGroups(); track g.cat) {
          <div class="faq-group">
            <h3>
              <app-icon [name]="g.icon" [size]="18" class="muted" /> {{ g.cat }}
            </h3>
            <div class="card faq-list">
              @for (f of g.faqs; track f.q) {
                <div class="faq" [class.open]="openFaq() === g.cat + f.q">
                  <button class="faq-q" (click)="toggleFaq(g.cat + f.q)">
                    <span>{{ f.q }}</span>
                    <app-icon
                      [name]="
                        openFaq() === g.cat + f.q
                          ? 'chevron-up'
                          : 'chevron-down'
                      "
                      [size]="18"
                    />
                  </button>
                  @if (openFaq() === g.cat + f.q) {
                    <p class="faq-a">{{ f.a }}</p>
                  }
                </div>
              }
            </div>
          </div>
        }
      </section>

      <!-- ===== Contact channels ===== -->
      <section id="contact">
        <h2>Contact support</h2>
        <div class="contact-grid">
          <div class="card contact-card">
            <span class="c-ico brand"
              ><app-icon name="message" [size]="22"
            /></span>
            <h3>Live chat</h3>
            <p class="muted">
              Chat with a support representative in real time.
            </p>
            <p class="avail">
              <app-icon name="clock" [size]="14" /> Mon–Fri, 8:00 AM – 8:00 PM
            </p>
            <button class="btn sm" (click)="startChat()">
              Start live chat
            </button>
          </div>

          <div class="card contact-card">
            <span class="c-ico accent"
              ><app-icon name="mail" [size]="22"
            /></span>
            <h3>Email support</h3>
            @if (support.email) {
              <a class="muted" [href]="'mailto:' + support.email">{{
                support.email
              }}</a>
            } @else {
              <p class="muted">
                Email support is being set up — please use live chat or a ticket
                for now.
              </p>
            }
            <p class="avail">
              <app-icon name="clock" [size]="14" /> Response within 24 hours
            </p>
          </div>

          <div class="card contact-card">
            <span class="c-ico brand"
              ><app-icon name="phone" [size]="22"
            /></span>
            <h3>Phone support</h3>
            @if (support.phone) {
              <a class="muted" [href]="'tel:' + support.phoneHref">{{
                support.phone
              }}</a>
            } @else {
              <p class="muted">Phone support is being set up.</p>
            }
            <p class="avail">
              <app-icon name="clock" [size]="14" /> Mon–Sat, 9:00 AM – 6:00 PM
            </p>
          </div>
        </div>
      </section>

      <!-- ===== Order tracking ===== -->
      <section id="track">
        <h2>Track your order</h2>
        <div class="card pad">
          @if (!auth.isLoggedIn()) {
            <p class="muted" style="margin-top:0">
              Order tracking is tied to your account.
              <a routerLink="/login" [queryParams]="{ redirect: '/support' }"
                >Sign in</a
              >
              to look up an order.
            </p>
          } @else {
            <div class="track-row">
              <div>
                <label>Order number</label>
                <input
                  [(ngModel)]="trackNumber"
                  placeholder="e.g. 1024"
                  (keyup.enter)="track()"
                />
              </div>
              <div>
                <label>Email address</label>
                <input
                  [(ngModel)]="trackEmail"
                  type="email"
                  placeholder="you@example.com"
                />
              </div>
              <button class="btn" (click)="track()">Track order</button>
            </div>
            @if (trackMiss()) {
              <div class="alert error" style="margin-bottom:0">
                No order with that number was found on your account.
              </div>
            }
            @if (tracked(); as o) {
              <div class="track-result">
                <div class="row spread">
                  <strong>Order #{{ o.id }}</strong>
                  <span class="tag" [ngClass]="statusClass(o.status)">{{
                    o.status
                  }}</span>
                </div>
                <div class="muted" style="font-size:.86rem;margin-top:6px">
                  Placed {{ o.created_at | date: 'mediumDate' }} · Total \${{
                    +o.total | number: '1.2-2'
                  }}
                </div>
                <div class="muted" style="font-size:.86rem;margin-top:4px">
                  {{ shipInfo(o) }}
                </div>
                <a
                  routerLink="/orders"
                  class="btn ghost sm"
                  style="margin-top:12px"
                  >View in my orders</a
                >
              </div>
            }
          }
        </div>
      </section>

      <!-- ===== Submit a ticket ===== -->
      <section id="ticket">
        <h2>Submit a support request</h2>
        <div class="card pad">
          @if (sent()) {
            <div class="alert ok" style="margin-top:0">
              Thanks! Your request has been sent to our support team. You can
              follow it in
              <a routerLink="/support" fragment="dashboard">your tickets</a>
              below.
            </div>
          }
          @if (error()) {
            <div class="alert error" style="margin-top:0">{{ error() }}</div>
          }

          @if (!auth.isLoggedIn()) {
            <p class="muted" style="margin-top:0">
              <a routerLink="/login" [queryParams]="{ redirect: '/support' }"
                >Sign in</a
              >
              to submit a request so our team can reply to you directly.
            </p>
          }

          <div class="form-grid" [class.locked]="!auth.isLoggedIn()">
            <div>
              <label>Full name</label>
              <input [(ngModel)]="form.name" placeholder="Your name" />
            </div>
            <div>
              <label>Email address</label>
              <input
                [(ngModel)]="form.email"
                type="email"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label>Order number (optional)</label>
              <input [(ngModel)]="form.orderNumber" placeholder="e.g. 1024" />
            </div>
            <div>
              <label>Issue category</label>
              <select [(ngModel)]="form.category">
                @for (c of issueCategories; track c) {
                  <option [value]="c">{{ c }}</option>
                }
              </select>
            </div>
            <div class="full">
              <label>Message</label>
              <textarea
                rows="5"
                [(ngModel)]="form.message"
                placeholder="Describe your question or problem"
              ></textarea>
            </div>
            <div class="full">
              <label>Attachment</label>
              <label class="file-drop">
                <app-icon name="paperclip" [size]="16" />
                <span>{{
                  fileNames() || 'Choose a file (screenshot, receipt…)'
                }}</span>
                <input type="file" multiple hidden (change)="onFiles($event)" />
              </label>
              <p class="hint muted">
                Files aren't uploaded yet — we'll note the file name on your
                ticket and follow up if needed.
              </p>
            </div>
          </div>
          <button
            class="btn"
            style="margin-top:6px"
            [disabled]="sending() || !auth.isLoggedIn()"
            (click)="submit()"
          >
            {{ sending() ? 'Sending…' : 'Submit request' }}
          </button>
        </div>
      </section>

      <!-- ===== Customer dashboard ===== -->
      @if (auth.isLoggedIn()) {
        <section id="dashboard">
          <h2>Your support dashboard</h2>
          <div class="quick-links">
            <button class="card q-link" (click)="startChat()">
              <app-icon name="message" [size]="18" /> Start live chat
            </button>
            <a class="card q-link" routerLink="/orders"
              ><app-icon name="orders" [size]="18" /> Order history</a
            >
            <a class="card q-link" routerLink="/orders"
              ><app-icon name="return" [size]="18" /> Returns &amp; refunds</a
            >
            <a class="card q-link" routerLink="/notifications"
              ><app-icon name="bell" [size]="18" /> Notifications</a
            >
          </div>

          <h3 style="margin:22px 0 10px">Your tickets</h3>
          @if (loadingTickets()) {
            <div class="spinner">Loading…</div>
          } @else if (tickets().length === 0) {
            <div class="empty card">
              <p class="muted" style="margin:0">
                No tickets yet. Submit a request above and it'll appear here.
              </p>
            </div>
          } @else {
            @for (t of tickets(); track t.id) {
              <div class="card" style="padding:14px 18px;margin-bottom:10px">
                <div
                  class="row spread"
                  style="cursor:pointer"
                  (click)="openThread(t)"
                >
                  <div>
                    <strong>{{ t.subject }}</strong>
                    <span
                      class="tag"
                      [ngClass]="statusClass(t.status)"
                      style="margin-left:8px"
                      >{{ t.status }}</span
                    >
                    <div class="muted" style="font-size:.82rem">
                      Updated {{ t.updated_at | date: 'medium' }} ·
                      {{ t.messages }} message(s)
                    </div>
                  </div>
                  <app-icon
                    [name]="active() === t.id ? 'chevron-up' : 'chevron-down'"
                    [size]="18"
                    class="muted"
                  />
                </div>
                @if (active() === t.id) {
                  <div class="thread">
                    @for (m of messages(); track m.id) {
                      <div
                        class="msg"
                        [class.staff]="m.author_role === 'staff'"
                      >
                        <div class="bubble">
                          <div class="who">
                            {{
                              m.author_role === 'staff'
                                ? 'Support'
                                : m.author || 'You'
                            }}
                            ·
                            <span class="muted">{{
                              m.created_at | date: 'short'
                            }}</span>
                          </div>
                          <p>{{ m.body }}</p>
                        </div>
                      </div>
                    }
                  </div>
                  @if (t.status !== 'closed') {
                    <div
                      class="row"
                      style="gap:8px;margin-top:10px;align-items:flex-start"
                    >
                      <textarea
                        rows="2"
                        [(ngModel)]="replyBody"
                        placeholder="Write a reply…"
                        style="flex:1"
                      ></textarea>
                      <button
                        class="btn"
                        [disabled]="replying()"
                        (click)="sendReply(t)"
                      >
                        Send
                      </button>
                    </div>
                  } @else {
                    <p class="muted" style="margin-top:10px">
                      This ticket is closed.
                    </p>
                  }
                }
              </div>
            }
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .support section {
        margin-bottom: 36px;
      }
      .support h2 {
        font-size: 1.3rem;
        letter-spacing: -0.01em;
        margin: 0 0 16px;
      }
      .card.pad {
        padding: 22px;
      }

      /* Hero */
      .hero {
        padding: 40px 32px;
        margin-bottom: 36px;
        background: linear-gradient(
          135deg,
          color-mix(in srgb, var(--brand) 10%, var(--surface)),
          var(--surface)
        );
      }
      .hero .eyebrow {
        color: var(--brand);
        font-weight: 700;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .hero h1 {
        margin: 8px 0 10px;
        font-size: 2rem;
        letter-spacing: -0.02em;
      }
      .hero p {
        color: var(--muted);
        max-width: 620px;
        margin: 0 0 20px;
      }

      /* Help categories */
      .cat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 14px;
      }
      .cat-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        cursor: pointer;
        text-align: left;
        border: 1px solid var(--border);
        transition:
          transform 0.12s ease,
          border-color 0.12s ease;
      }
      .cat-card:hover {
        transform: translateY(-2px);
        border-color: var(--brand);
      }
      .cat-card.active {
        border-color: var(--brand);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 25%, transparent);
      }
      .cat-ico {
        width: 42px;
        height: 42px;
        flex: none;
        border-radius: 11px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--tint-brand);
        color: var(--brand);
      }
      .cat-name {
        font-weight: 700;
        font-size: 0.95rem;
      }

      /* FAQ */
      .faq-group {
        margin-bottom: 18px;
      }
      .faq-group h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 1.02rem;
        margin: 0 0 10px;
      }
      .faq-list {
        padding: 4px 18px;
      }
      .faq {
        border-bottom: 1px solid var(--border);
      }
      .faq:last-child {
        border-bottom: none;
      }
      .faq-q {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background: none;
        border: none;
        padding: 14px 0;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
        color: var(--ink);
        text-align: left;
      }
      .faq-q .app-icon,
      .faq-q app-icon {
        color: var(--muted);
        flex: none;
      }
      .faq-a {
        margin: 0 0 14px;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.6;
      }

      /* Contact */
      .contact-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
      }
      .contact-card {
        padding: 22px;
      }
      .contact-card h3 {
        margin: 14px 0 6px;
        font-size: 1.05rem;
      }
      .contact-card p {
        margin: 0 0 6px;
        font-size: 0.9rem;
      }
      .contact-card .avail {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--muted);
        font-size: 0.82rem;
        margin: 8px 0 14px;
      }
      .contact-card a {
        word-break: break-word;
      }
      .c-ico {
        width: 46px;
        height: 46px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .c-ico.brand {
        background: var(--tint-brand);
        color: var(--brand);
      }
      .c-ico.accent {
        background: var(--tint-accent);
        color: var(--accent);
      }

      /* Tracking */
      .track-row {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 12px;
        align-items: end;
      }
      .track-row label {
        margin-top: 0;
      }
      .track-row .btn {
        height: 42px;
      }
      @media (max-width: 620px) {
        .track-row {
          grid-template-columns: 1fr;
        }
      }
      .track-result {
        margin-top: 16px;
        padding: 16px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--bg);
      }

      /* Ticket form */
      .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px 16px;
        margin-bottom: 8px;
      }
      .form-grid .full {
        grid-column: 1 / -1;
      }
      .form-grid.locked {
        opacity: 0.6;
        pointer-events: none;
      }
      @media (max-width: 620px) {
        .form-grid {
          grid-template-columns: 1fr;
        }
      }
      .file-drop {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border: 1px dashed var(--border);
        border-radius: 10px;
        cursor: pointer;
        color: var(--muted);
        font-weight: 500;
      }
      .file-drop:hover {
        border-color: var(--brand);
        color: var(--brand);
      }
      .hint {
        font-size: 0.78rem;
        margin: 6px 0 0;
      }

      /* Dashboard */
      .quick-links {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .q-link {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px;
        font-weight: 700;
        font-size: 0.92rem;
        color: var(--ink);
        cursor: pointer;
        border: 1px solid var(--border);
        background: var(--surface);
      }
      .q-link:hover {
        border-color: var(--brand);
        color: var(--brand);
        text-decoration: none;
      }
      .q-link app-icon {
        color: var(--brand);
      }
      .empty {
        padding: 22px;
      }

      /* Tags + ticket thread (shared look with the rest of the app) */
      .tag.status-open,
      .tag.status-paid {
        background: var(--tint-brand);
        color: var(--brand);
      }
      .tag.status-pending,
      .tag.status-processing {
        background: #fef3c7;
        color: #92400e;
      }
      .tag.status-resolved,
      .tag.status-delivered {
        background: var(--tint-accent);
        color: #059669;
      }
      .tag.status-closed,
      .tag.status-cancelled {
        background: var(--bg);
        color: var(--muted);
      }
      .tag.status-shipped {
        background: var(--tint-brand);
        color: var(--brand);
      }
      .thread {
        margin-top: 14px;
        border-top: 1px solid var(--border);
        padding-top: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .msg {
        display: flex;
      }
      .msg.staff {
        justify-content: flex-end;
      }
      .bubble {
        max-width: 75%;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 10px 14px;
      }
      .msg.staff .bubble {
        background: var(--tint-brand);
        border-color: var(--tint-brand);
      }
      .bubble .who {
        font-size: 0.78rem;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .bubble p {
        margin: 0;
        white-space: pre-wrap;
      }
    `,
  ],
})
export class SupportComponent implements OnInit {
  // Contact details. Email is intentionally blank until a support mailbox is
  // configured; the template shows a "being set up" note while it's empty.
  readonly support = {
    email: 'frodoandimaro0@gmail.com',
    phone: '+233 24 006 1132',
    phoneHref: 'tel:+233240061132',
  };

  // FAQ content, grouped by the same categories as the help cards.
  readonly groups: FaqGroup[] = [
    {
      cat: 'Orders',
      icon: 'orders',
      faqs: [
        {
          q: 'How do I place an order?',
          a: 'Browse the shop, add items to your cart, then open the cart and choose Checkout. Confirm your address and payment details to place the order.',
        },
        {
          q: 'Can I cancel my order?',
          a: 'Orders can be cancelled while they are still being processed. Open the order in My Orders, or submit a request below and our team will help right away.',
        },
        {
          q: 'How do I track my order?',
          a: "Use the order tracking section above, or open My Orders to see each order's current status, carrier and tracking number.",
        },
      ],
    },
    {
      cat: 'Payments',
      icon: 'card',
      faqs: [
        {
          q: 'What payment methods do you accept?',
          a: 'We accept major debit and credit cards. You can also save a card to your account for faster checkout under Payment methods.',
        },
        {
          q: 'Why was my payment declined?',
          a: 'Declines are usually due to incorrect card details, insufficient funds or a bank security check. Double-check the details or try another card, then contact your bank if it persists.',
        },
        {
          q: 'Is my payment information secure?',
          a: 'Yes. Card details are handled securely and we never store your full card number. Saved cards only keep the last few digits for display.',
        },
      ],
    },
    {
      cat: 'Shipping & Delivery',
      icon: 'truck',
      faqs: [
        {
          q: 'How long does delivery take?',
          a: "Standard delivery typically takes 3–5 business days after an order is processed. You'll see status updates as it moves to shipped and delivered.",
        },
        {
          q: 'What are the shipping costs?',
          a: 'Shipping costs are shown at checkout before you pay, based on your delivery address and the items in your cart.',
        },
        {
          q: 'Do you offer same-day delivery?',
          a: "Same-day delivery isn't available everywhere yet. Available options are shown at checkout for your address.",
        },
      ],
    },
    {
      cat: 'Returns & Refunds',
      icon: 'return',
      faqs: [
        {
          q: 'How do I return an item?',
          a: 'Open the order in My Orders and choose Request return, giving a short reason. Our team reviews it and follows up with the next steps.',
        },
        {
          q: 'When will I receive my refund?',
          a: 'Once a return is approved and received, refunds are issued to your original payment method, usually within a few business days.',
        },
        {
          q: 'What products are eligible for return?',
          a: 'Most items are eligible within the return window if unused and in their original condition. Some items may be excluded for hygiene or safety reasons.',
        },
      ],
    },
    {
      cat: 'Account & Security',
      icon: 'shield',
      faqs: [
        {
          q: 'How do I reset my password?',
          a: "You can change your password from your Profile while signed in. If you're locked out, submit a request below and our team will help you regain access.",
        },
        {
          q: 'How do I update my address?',
          a: 'Manage your saved delivery addresses under Addresses in your account. You can add, edit or remove addresses any time.',
        },
        {
          q: 'How do I delete my account?',
          a: 'Submit a request below and choose "Account problem". Our team will confirm and process the deletion of your account and data.',
        },
      ],
    },
    {
      cat: 'Promotions & Coupons',
      icon: 'tag',
      faqs: [
        {
          q: 'How do I use a coupon code?',
          a: "Enter your coupon code at checkout. If it's valid, the discount is applied to your order total before payment.",
        },
        {
          q: "Why isn't my coupon working?",
          a: "Coupons can expire or have conditions. Check the code is entered correctly and still active — if it should work, contact us and we'll take a look.",
        },
      ],
    },
  ];

  readonly issueCategories = [
    'Order Issue',
    'Payment Issue',
    'Delivery Issue',
    'Return/Refund',
    'Account Problem',
    'Other',
  ];

  activeCat = signal<string>('All');
  openFaq = signal<string>('');
  visibleGroups = signal<FaqGroup[]>(this.groups);

  // Ticket form
  form = {
    name: '',
    email: '',
    orderNumber: '',
    category: this.issueCategories[0],
    message: '',
  };
  files = signal<string[]>([]);
  fileNames = signal<string>('');
  sending = signal(false);
  sent = signal(false);
  error = signal('');

  // Order tracking
  trackNumber = '';
  trackEmail = '';
  tracked = signal<Order | null>(null);
  trackMiss = signal(false);

  // Dashboard tickets
  tickets = signal<SupportTicket[]>([]);
  loadingTickets = signal(false);
  active = signal<number | null>(null);
  messages = signal<SupportMessage[]>([]);
  replyBody = '';
  replying = signal(false);

  constructor(
    private supportSvc: SupportService,
    private orders: OrderService,
    public auth: AuthService,
    private chat: ChatService,
  ) {}

  ngOnInit(): void {
    const u = this.auth.user();
    if (u) {
      this.form.name = u.name || '';
      this.form.email = u.email || '';
      this.trackEmail = u.email || '';
      this.loadTickets();
    }
  }

  // ---- navigation / FAQ ----
  scrollTo(id: string): void {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  filterFaq(cat: string): void {
    this.activeCat.set(cat);
    this.visibleGroups.set(
      cat === 'All' ? this.groups : this.groups.filter((g) => g.cat === cat),
    );
    this.scrollTo('faqs');
  }
  toggleFaq(key: string): void {
    this.openFaq.update((cur) => (cur === key ? '' : key));
  }

  // ---- live chat ----
  startChat(): void {
    this.chat.open();
  }

  // ---- order tracking ----
  statusClass(status: string): string {
    return 'status-' + status;
  }
  // Carrier / tracking summary for a tracked order, or a hint while it's pending.
  shipInfo(o: Order): string {
    const parts = [
      o.carrier,
      o.tracking ? `Tracking ${o.tracking}` : null,
    ].filter(Boolean);
    return parts.length
      ? parts.join(' · ')
      : 'Tracking details appear here once your order ships.';
  }
  track(): void {
    const num = this.trackNumber.trim().replace(/^#/, '');
    if (!num) return;
    this.tracked.set(null);
    this.trackMiss.set(false);
    this.orders.mine().subscribe({
      next: (r) => {
        const found = r.orders.find((o) => String(o.id) === num) ?? null;
        this.tracked.set(found);
        this.trackMiss.set(found === null);
      },
      error: () => this.trackMiss.set(true),
    });
  }

  // ---- ticket form ----
  onFiles(e: Event): void {
    const input = e.target as HTMLInputElement;
    const names = Array.from(input.files ?? []).map((f) => f.name);
    this.files.set(names);
    this.fileNames.set(names.join(', '));
  }

  submit(): void {
    this.error.set('');
    this.sent.set(false);
    if (!this.auth.isLoggedIn()) {
      return this.error.set('Please sign in to submit a request.');
    }
    if (!this.form.message.trim()) {
      return this.error.set('Please describe your issue in the message field.');
    }

    const order = this.form.orderNumber.trim();
    const subject = `${this.form.category}${order ? ` — Order #${order.replace(/^#/, '')}` : ''}`;
    const body = [
      `Name: ${this.form.name.trim() || '—'}`,
      `Email: ${this.form.email.trim() || '—'}`,
      order ? `Order #: ${order.replace(/^#/, '')}` : null,
      `Category: ${this.form.category}`,
      '',
      this.form.message.trim(),
      this.files().length
        ? `\nAttachments mentioned: ${this.files().join(', ')}`
        : null,
    ]
      .filter((l) => l !== null)
      .join('\n');

    this.sending.set(true);
    this.supportSvc.open(subject, body).subscribe({
      next: () => {
        this.sending.set(false);
        this.sent.set(true);
        this.form.message = '';
        this.form.orderNumber = '';
        this.files.set([]);
        this.fileNames.set('');
        this.loadTickets();
        this.scrollTo('ticket');
      },
      error: (e) => {
        this.sending.set(false);
        this.error.set(
          e?.error?.error || 'Could not submit your request. Please try again.',
        );
      },
    });
  }

  // ---- dashboard tickets ----
  loadTickets(): void {
    this.loadingTickets.set(true);
    this.supportSvc.myTickets().subscribe({
      next: (r) => {
        this.tickets.set(r.tickets);
        this.loadingTickets.set(false);
      },
      error: () => this.loadingTickets.set(false),
    });
  }
  openThread(t: SupportTicket): void {
    if (this.active() === t.id) {
      this.active.set(null);
      return;
    }
    this.active.set(t.id);
    this.replyBody = '';
    this.supportSvc.get(t.id).subscribe((r) => this.messages.set(r.messages));
  }
  sendReply(t: SupportTicket): void {
    const body = this.replyBody.trim();
    if (!body) return;
    this.replying.set(true);
    this.supportSvc.reply(t.id, body).subscribe({
      next: (r) => {
        this.replying.set(false);
        this.replyBody = '';
        this.messages.update((list) => [...list, r.message]);
        this.loadTickets();
      },
      error: () => this.replying.set(false),
    });
  }
}

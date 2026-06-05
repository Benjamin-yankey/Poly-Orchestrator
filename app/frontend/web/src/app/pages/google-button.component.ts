import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { GOOGLE_CLIENT_ID } from '../core/config';

// Google Identity Services is loaded from Google's CDN at runtime; it attaches a
// global `google`. We only touch a few fields, so type it loosely.
declare const google: any;

// Load the GIS client script once, shared across every button instance.
let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    if (typeof google !== 'undefined' && google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google sign-in'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

// "Continue with Google" button. Renders the official Google Identity Services
// button, exchanges the returned ID token for an app session via AuthService,
// then navigates to `redirect`. Hidden (shown as a disabled hint) until a
// GOOGLE_CLIENT_ID is configured.
@Component({
  selector: 'app-google-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="g-divider"><span>or</span></div>
    @if (configured) {
      <div class="g-host" [class.busy]="loading()">
        <div #btn></div>
      </div>
    } @else {
      <button type="button" class="g-fallback" disabled title="Set GOOGLE_CLIENT_ID to enable Google sign-in">
        <span class="g-mark">G</span> Continue with Google
        <span class="g-note">(not configured)</span>
      </button>
    }
  `,
  styles: [
    `
      .g-divider {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 18px 0;
        color: var(--muted);
        font-size: 0.82rem;
      }
      .g-divider::before,
      .g-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border);
      }
      .g-host {
        display: flex;
        justify-content: center;
        min-height: 44px;
      }
      .g-host.busy {
        opacity: 0.6;
        pointer-events: none;
      }
      .g-fallback {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 11px 16px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface);
        color: var(--muted);
        font: inherit;
        font-weight: 600;
        cursor: not-allowed;
      }
      .g-mark {
        font-weight: 800;
        color: #4285f4;
      }
      .g-note {
        font-size: 0.78rem;
        opacity: 0.8;
      }
    `,
  ],
})
export class GoogleButtonComponent implements AfterViewInit {
  @Input() redirect = '/';
  @Output() failed = new EventEmitter<string>();
  @ViewChild('btn') btn?: ElementRef<HTMLElement>;

  readonly configured = !!GOOGLE_CLIENT_ID;
  readonly loading = signal(false);

  constructor(
    private auth: AuthService,
    private router: Router,
    private zone: NgZone,
  ) {}

  ngAfterViewInit(): void {
    if (!this.configured || !this.btn) return;
    loadGis()
      .then(() => {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp: { credential?: string }) => this.onCredential(resp),
        });
        const host = this.btn!.nativeElement;
        const width = Math.min(400, Math.max(240, host.clientWidth || 320));
        google.accounts.id.renderButton(host, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          width,
        });
      })
      .catch(() => this.failed.emit('Could not load Google sign-in. Check your connection.'));
  }

  // GIS invokes this outside Angular's zone, so re-enter it before touching state.
  private onCredential(resp: { credential?: string }): void {
    if (!resp?.credential) return;
    this.zone.run(() => {
      this.loading.set(true);
      this.auth.loginWithGoogle(resp.credential!).subscribe({
        next: () => this.router.navigateByUrl(this.redirect),
        error: (e) => {
          this.loading.set(false);
          this.failed.emit(e?.error?.error || 'Google sign-in failed. Please try again.');
        },
      });
    });
  }
}

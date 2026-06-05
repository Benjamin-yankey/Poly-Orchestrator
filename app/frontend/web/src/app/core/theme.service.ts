import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'shopnow.theme';

// App theme (light/dark). On first visit we follow the OS preference; once the
// user picks a theme explicitly we remember it in localStorage and stop tracking
// the system. The active theme is reflected as `data-theme` on <html>, which the
// global stylesheet keys its dark palette off of.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('light');

  // True until the user makes an explicit choice — while true we mirror the OS.
  private followingSystem = false;
  private media?: MediaQueryList;

  init(): void {
    const saved = this.read();
    if (saved === 'light' || saved === 'dark') {
      this.apply(saved);
    } else {
      this.followingSystem = true;
      this.media = window.matchMedia?.('(prefers-color-scheme: dark)');
      this.apply(this.media?.matches ? 'dark' : 'light');
      // Track live OS changes until the user overrides.
      this.media?.addEventListener?.('change', (e) => {
        if (this.followingSystem) this.apply(e.matches ? 'dark' : 'light');
      });
    }
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.followingSystem = false;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage may be unavailable (private mode) — theme still applies */
    }
    this.apply(theme);
  }

  private apply(theme: Theme): void {
    this.theme.set(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  private read(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}

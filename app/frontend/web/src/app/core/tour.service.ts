import { Injectable } from '@angular/core';
import { driver, type DriveStep } from 'driver.js';

const SEEN_KEY = 'shopnow.tourSeen';

// Guided product tour for new users, built on driver.js. Steps point at elements
// tagged with `data-tour="..."` in the app shell. The tour auto-runs once on a
// visitor's first desktop visit (the off-canvas mobile sidebar makes spotlighting
// nav items unreliable, so we skip auto-run on narrow screens) and can be
// replayed any time from the sidebar footer.
@Injectable({ providedIn: 'root' })
export class TourService {
  private steps(): DriveStep[] {
    return [
      {
        element: '[data-tour="brand"]',
        popover: {
          title: 'Welcome to ShopNow 👋',
          description:
            'Quick 60-second tour of how to get around. You can skip any time, or replay this later from the menu.',
        },
      },
      {
        element: '[data-tour="shop"]',
        popover: {
          title: 'The Shop',
          description: 'Browse the official catalog and add items to your cart.',
        },
      },
      {
        element: '[data-tour="marketplace"]',
        popover: {
          title: 'Community Marketplace',
          description:
            'Items posted by other people in the community. See something you like? Call the seller directly to arrange the purchase.',
        },
      },
      {
        element: '[data-tour="cart"]',
        popover: {
          title: 'Your Cart',
          description: 'Items you add to buy show up here, ready for checkout.',
        },
      },
      {
        element: '[data-tour="theme"]',
        popover: {
          title: 'Light & Dark',
          description: 'Prefer a darker look? Switch themes here any time.',
        },
      },
      {
        element: '[data-tour="collapse"]',
        popover: {
          title: 'More room',
          description:
            'Collapse the sidebar to a slim icon bar when you want more space for content.',
        },
      },
      {
        element: '[data-tour="account"]',
        popover: {
          title: 'Your account',
          description:
            'Sign in to sell items, track orders, save a wishlist and get support.',
        },
      },
      {
        element: 'app-chat-widget .launcher',
        popover: {
          title: 'Need a hand?',
          description:
            'Tap the assistant any time to ask a question — it goes straight to our support team. That’s it, enjoy ShopNow!',
          side: 'left',
          align: 'end',
        },
      },
    ];
  }

  // Start the tour now, skipping steps whose target isn't on the page.
  run(): void {
    const steps = this.steps().filter(
      (s) =>
        typeof s.element === 'string' && document.querySelector(s.element),
    );
    if (steps.length === 0) return;

    const d = driver({
      showProgress: true,
      allowClose: true,
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      steps,
      onDestroyed: () => this.markSeen(),
    });
    d.drive();
  }

  // Auto-run once for a brand-new visitor on a wide screen.
  maybeAutoStart(): void {
    if (this.hasSeen()) return;
    if (window.innerWidth <= 860) return;
    // Defer a tick so the shell is rendered and targets exist.
    setTimeout(() => this.run(), 600);
  }

  private hasSeen(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  private markSeen(): void {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore unavailable storage */
    }
  }
}

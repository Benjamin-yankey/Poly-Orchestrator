import { Injectable, signal } from '@angular/core';

// Shared open/closed state for the floating support assistant. Lets any page
// (e.g. the Support center's "Live Chat" button) open the widget, while the
// widget itself owns the conversation.
@Injectable({ providedIn: 'root' })
export class ChatService {
  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    this.isOpen.update((v) => !v);
  }
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminTicket, SupportMessage, SupportTicket, TicketStatus } from './models';

// Customer support tickets (Products/core API, Postgres). Customers open and
// reply to their own tickets; management reads them and admins reply + set status.
@Injectable({ providedIn: 'root' })
export class SupportService {
  constructor(private http: HttpClient) {}

  // ---- customer ----
  myTickets(): Observable<{ tickets: SupportTicket[] }> {
    return this.http.get<{ tickets: SupportTicket[] }>('/api/support');
  }

  open(subject: string, message: string): Observable<{ ticket: SupportTicket }> {
    return this.http.post<{ ticket: SupportTicket }>('/api/support', { subject, message });
  }

  get(id: number): Observable<{ ticket: SupportTicket; messages: SupportMessage[] }> {
    return this.http.get<{ ticket: SupportTicket; messages: SupportMessage[] }>(`/api/support/${id}`);
  }

  reply(id: number, body: string): Observable<{ message: SupportMessage }> {
    return this.http.post<{ message: SupportMessage }>(`/api/support/${id}/messages`, { body });
  }

  // ---- admin ----
  all(): Observable<{ tickets: AdminTicket[] }> {
    return this.http.get<{ tickets: AdminTicket[] }>('/api/admin/support');
  }

  setStatus(id: number, status: TicketStatus): Observable<{ ticket: SupportTicket }> {
    return this.http.put<{ ticket: SupportTicket }>(`/api/admin/support/${id}/status`, { status });
  }
}

// Agenda falsa em memória que implementa a porta SchedulingTools.
import type { CancellationOutcome, DateRange, MemberContext, SchedulingTools, SessionListing } from '../../src/application/ports.js';
import { Booking } from '../../src/domain/booking.js';
import { DomainError } from '../../src/domain/errors.js';

export class FakeSchedulingTools implements SchedulingTools {
  readonly calls: string[] = [];
  failWith: DomainError | Error | null = null;
  bookStatus: 'confirmed' | 'waitlisted' = 'confirmed';

  constructor(private listing: readonly SessionListing[] = []) {}

  setListing(listing: readonly SessionListing[]): void {
    this.listing = listing;
  }

  async listSessions(_member: MemberContext, range: DateRange): Promise<readonly SessionListing[]> {
    this.record(`listSessions ${range.from}..${range.to}`);
    return this.listing;
  }

  async book(_member: MemberContext, sessionId: string): Promise<Booking> {
    this.record(`book ${sessionId}`);
    return Booking.create({ id: `bk-${sessionId}`, sessionId, status: this.bookStatus });
  }

  async cancel(_member: MemberContext, bookingId: string): Promise<CancellationOutcome> {
    this.record(`cancel ${bookingId}`);
    return { booking: Booking.create({ id: bookingId, sessionId: 'ses', status: 'canceled' }), freedSeat: true };
  }

  async joinWaitlist(_member: MemberContext, sessionId: string): Promise<Booking> {
    this.record(`joinWaitlist ${sessionId}`);
    return Booking.create({ id: `bk-${sessionId}`, sessionId, status: 'waitlisted' });
  }

  private record(call: string): void {
    this.calls.push(call);
    if (this.failWith) throw this.failWith;
  }
}

export const unavailable = () => new DomainError('scheduling_unavailable', 'SaaS fora do ar', true);

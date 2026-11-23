import { create } from 'zustand';

/**
 * Cross-widget "fill the ticket" channel: clicking a price in the order book, a trade, or an
 * options-chain quote pushes it here and the active order form picks it up.
 */
interface TicketState {
  price: string | null;
  qty: string | null;
  seq: number;
  pick: (price: string, qty?: string) => void;
}

export const useTicket = create<TicketState>((set) => ({
  price: null,
  qty: null,
  seq: 0,
  pick: (price, qty) => set((s) => ({ price, qty: qty ?? null, seq: s.seq + 1 })),
}));

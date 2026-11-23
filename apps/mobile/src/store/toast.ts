import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  duration: number;
  onPress?: () => void;
}

export type ToastInput = Omit<ToastItem, 'id' | 'duration'> & { duration?: number };

interface ToastState {
  toasts: ToastItem[];
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  show: (input) => {
    const id = nextId++;
    const item: ToastItem = { duration: input.type === 'error' ? 5000 : 3500, ...input, id };
    // Newest on top, never more than three stacked.
    set((s) => ({ toasts: [item, ...s.toasts].slice(0, 3) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers usable from anywhere (mutations, realtime handlers…). */
export const toast = {
  show: (t: ToastInput) => useToasts.getState().show(t),
  success: (title: string, message?: string) => useToasts.getState().show({ type: 'success', title, message }),
  error: (title: string, message?: string) => useToasts.getState().show({ type: 'error', title, message }),
  info: (title: string, message?: string) => useToasts.getState().show({ type: 'info', title, message }),
  warning: (title: string, message?: string) => useToasts.getState().show({ type: 'warning', title, message }),
};

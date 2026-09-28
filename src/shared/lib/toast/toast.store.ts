import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'danger';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  current: Toast | null;
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  current: null,
  show: (message, tone = 'info') => set({ current: { id: nextId++, message, tone } }),
  dismiss: (id) => set((state) => (state.current?.id === id ? { current: null } : state)),
}));

/** Imperative access for mutation callbacks outside React render. */
export const showToast = (message: string, tone?: ToastTone) => useToastStore.getState().show(message, tone);

import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'danger';

/** One tap that undoes what the toast reports ("Geri al"). */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastState {
  current: Toast | null;
  show: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  current: null,
  show: (message, tone = 'info', action) => set({ current: { id: nextId++, message, tone, action } }),
  dismiss: (id) => set((state) => (state.current?.id === id ? { current: null } : state)),
}));

/** Imperative access for mutation callbacks outside React render. */
export const showToast = (message: string, tone?: ToastTone, action?: ToastAction) =>
  useToastStore.getState().show(message, tone, action);

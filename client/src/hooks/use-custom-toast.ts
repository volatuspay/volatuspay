import { useState, useCallback } from 'react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration?: number;
}

export const useCustomToast = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const generateId = () => `toast-${Date.now()}-${Math.random()}`;

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = generateId();
    const newToast: ToastItem = {
      id,
      duration: 5000,
      ...toast
    };

    setToasts(prev => [...prev, newToast]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  // Helper methods for different types
  const success = useCallback((title: string, description?: string, duration?: number) => {
    return addToast({ type: 'success', title, description, duration });
  }, [addToast]);

  const error = useCallback((title: string, description?: string, duration?: number) => {
    return addToast({ type: 'error', title, description, duration });
  }, [addToast]);

  const warning = useCallback((title: string, description?: string, duration?: number) => {
    return addToast({ type: 'warning', title, description, duration });
  }, [addToast]);

  const info = useCallback((title: string, description?: string, duration?: number) => {
    return addToast({ type: 'info', title, description, duration });
  }, [addToast]);

  return {
    toasts,
    addToast,
    removeToast,
    clearAll,
    success,
    error,
    warning,
    info
  };
};
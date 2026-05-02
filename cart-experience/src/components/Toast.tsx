import { useEffect } from 'react';

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
};

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    const timeout = window.setTimeout(onDismiss, 1800);
    return () => window.clearTimeout(timeout);
  }, [message, onDismiss]);

  return <div className={`toast ${message ? 'is-visible' : ''}`}>{message}</div>;
}

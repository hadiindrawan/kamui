import React, { createContext, useCallback, useRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import './Toast.css';

export const ToastContext = createContext(null);

const AUTO_DISMISS_MS = 3500;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(0);

    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const showToast = useCallback(({ type = 'success', message }) => {
        const id = nextId.current++;
        setToasts((prev) => [...prev, { id, type, message }]);
        setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
    }, [dismissToast]);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
                {toasts.map((toast) => (
                    <div key={toast.id} className={`toast toast-${toast.type}`}>
                        {toast.type === 'error' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                        <span>{toast.message}</span>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

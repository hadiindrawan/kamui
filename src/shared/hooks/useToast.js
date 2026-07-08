import { useContext } from 'react';
import { ToastContext } from '../components/Toast.jsx';

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within a ToastProvider');
    return ctx;
}

import { CheckCircle2, ShieldCheck } from 'lucide-react';
import type { Toast } from '../assetUi';

export function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div className={`toast ${toast.type}`} role="status">
      {toast.type === 'ok' ? <CheckCircle2 size={16} /> : <ShieldCheck size={16} />}
      <span>{toast.message}</span>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

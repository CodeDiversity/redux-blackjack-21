import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { toastCleared } from '../store/ui.slice';
import type { RootState } from '../store';

export function ErrorToast() {
  const toast = useSelector((s: RootState) => s.ui.lastToast);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => dispatch(toastCleared()), 4000);
    return () => clearTimeout(id);
  }, [toast, dispatch]);

  if (!toast) return null;
  return <div className="error-toast">{toast.message}</div>;
}

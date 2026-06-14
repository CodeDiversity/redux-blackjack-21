import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import styled, { keyframes } from 'styled-components';
import { toastCleared } from '../store/ui.slice';
import type { RootState } from '../store';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Toast = styled.div`
  position: fixed;
  top: ${({ theme }) => theme.spacing.lg};
  right: ${({ theme }) => theme.spacing.lg};
  z-index: 200;
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.statusLose};
  border-left: 4px solid ${({ theme }) => theme.colors.statusLose};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.typography.bodySize};
  max-width: 320px;
  box-shadow: ${({ theme }) => theme.shadows.cardLarge};
  animation: ${fadeIn} 200ms ease;
`;

export function ErrorToast() {
  const toast = useSelector((s: RootState) => s.ui.lastToast);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => dispatch(toastCleared()), 4000);
    return () => clearTimeout(id);
  }, [toast, dispatch]);

  if (!toast) return null;
  return <Toast role="alert">{toast.message}</Toast>;
}

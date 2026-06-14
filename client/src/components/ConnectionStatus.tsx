import { useSelector } from 'react-redux';
import type { RootState } from '../store';

export function ConnectionStatus() {
  const status = useSelector((s: RootState) => s.connection.status);
  if (status === 'connected') return null;
  return <div className={`connection-banner status-${status}`}>{status}…</div>;
}

import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { clearStoredSeatToken, getStoredSeatToken } from '../lib/seat-token';
import { NamePrompt } from '../components/NamePrompt';
import { Lobby } from '../components/Lobby';
import { TableView } from '../components/TableView';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ErrorToast } from '../components/ErrorToast';
import { errorReceived, selfSeatAssigned, selfSeatCleared } from '../store/connection.slice';
import { toastShown } from '../store/ui.slice';
import type { RootState } from '../store';

const Page = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.entranceBg};
`;

export function Table() {
  const { code } = useParams<{ code: string }>();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const phase = useSelector((s: RootState) => s.game.state?.phase ?? 'lobby');
  const selfSeatId = useSelector((s: RootState) => s.connection.selfSeatId);
  // Tracks the last code for which we emitted room:resume, so navigating to
  // a different room re-arms the resume while React StrictMode's intentional
  // double-effect-invocation (which doesn't change `code`) does not.
  const emittedForCodeRef = useRef<string | null>(null);

  // Effect 1: resume-or-prompt gating on mount and on `code` change.
  useEffect(() => {
    const token = code ? getStoredSeatToken(code) : null;
    const socket = getSocket();

    const tryResume = () => {
      if (!code || !token) return;
      if (emittedForCodeRef.current === code) return;
      emittedForCodeRef.current = code;
      socket.emit('room:resume', { roomId: code, seatToken: token }, (resp: { seatId?: string } | undefined) => {
        // The server returns the seatId on success. Restore it to the
        // connection store so `amHost` is true after a reload. Without
        // this, a reloaded host sees "Waiting for host to start..."
        // because selfSeatId is null and the host-claim check fails.
        if (resp?.seatId) dispatch(selfSeatAssigned({ seatId: resp.seatId, seatToken: token }));
      });
    };

    // Reset the ref on disconnect so the next reconnect re-emits. Without
    // this, an auto-reconnect (e.g. after a network blip) leaves the
    // server's room.seats entry pointing at the old socketId, and the
    // reconnected client gets NOT_YOUR_TURN on its next bet:place.
    const onDisconnect = () => { emittedForCodeRef.current = null; };

    // Try once on mount; the ref guard makes this a no-op on subsequent
    // connect events for the same code, but a code change re-arms.
    tryResume();
    socket.on('connect', tryResume);
    socket.on('reconnect', tryResume);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', tryResume);
      socket.off('reconnect', tryResume);
      socket.off('disconnect', onDisconnect);
    };
  }, [code, dispatch]);

  // Effect 2: react to SEAT_GONE and other server errors.
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: { code: string; message: string }) => {
      dispatch(errorReceived(payload));
      dispatch(toastShown(payload));
      if (payload.code === 'SEAT_GONE' && code) {
        clearStoredSeatToken(code);
        dispatch(selfSeatCleared());
        navigate('/');
      }
    };
    socket.on('error', onError);
    return () => { socket.off('error', onError); };
  }, [code, dispatch, navigate]);

  // First-time deep-link visitor: show inline name form.
  if (code && selfSeatId === null && getStoredSeatToken(code) === null) {
    return (
      <Page>
        <ConnectionStatus />
        <NamePrompt roomCode={code} />
      </Page>
    );
  }

  if (phase === 'lobby') {
    return <Page><ConnectionStatus /><Lobby /></Page>;
  }
  return <Page><ConnectionStatus /><TableView /><ErrorToast /></Page>;
}

import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { Lobby } from '../components/Lobby';
import { TableView } from '../components/TableView';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ErrorToast } from '../components/ErrorToast';
import type { RootState } from '../store';

const Page = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.entranceBg};
`;

export function Table() {
  const { code } = useParams<{ code: string }>();
  const phase = useSelector((s: RootState) => s.game.state?.phase ?? 'lobby');

  useEffect(() => {
    // If the user lands here directly (deep link) and isn't seated, rejoin.
    const socket = getSocket();
    const onConnect = () => {
      const seated = (socket as any).socket?.recovered;
      if (!seated) {
        const name = prompt('Your name?') ?? 'Guest';
        socket.emit('room:join', { roomId: code, name }, () => {});
      }
    };
    socket.on('connect', onConnect);
    return () => { socket.off('connect', onConnect); };
  }, [code]);

  if (phase === 'lobby') return <Page><ConnectionStatus /><Lobby /></Page>;
  return <Page><ConnectionStatus /><TableView /><ErrorToast /></Page>;
}

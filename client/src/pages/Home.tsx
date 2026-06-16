import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { storeSeatToken } from '../lib/seat-token';
import { selfSeatAssigned } from '../store/connection.slice';

const Page = styled.div`
  min-height: 100vh;
  padding: ${({ theme }) => theme.spacing.xxl};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.colors.entranceBg};
`;

const Brand = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 36px;
  font-style: italic;
  letter-spacing: 6px;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Subtitle = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 4px;
  text-transform: uppercase;
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.entranceSurface};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Label = styled.label`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 2px;
  text-transform: uppercase;
`;

const Input = styled.input`
  background: ${({ theme }) => theme.colors.entranceBg};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  width: 100%;
  &:focus { outline: 1px solid ${({ theme }) => theme.colors.textSecondary}; }
`;

const CodeInput = styled(Input)`
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  letter-spacing: 4px;
  text-align: center;
  text-transform: uppercase;
`;

const PrimaryButton = styled.button`
  background: linear-gradient(135deg,
    ${({ theme }) => theme.colors.goldFrom} 0%,
    ${({ theme }) => theme.colors.goldTo} 100%);
  color: ${({ theme }) => theme.colors.goldText};
  border: 1px solid ${({ theme }) => theme.colors.goldTo};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  width: 100%;
  &:hover { filter: brightness(1.08); }
`;

const OutlineButton = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: bold;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.entranceSurfaceAlt}; }
`;

const Divider = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  text-align: center;
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-transform: uppercase;
  position: relative;
  &::before, &::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 30%;
    height: 1px;
    background: ${({ theme }) => theme.colors.entranceBorder};
  }
  &::before { left: 0; }
  &::after  { right: 0; }
`;

const JoinRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  & > ${CodeInput} { flex: 1; }
`;

const Error = styled.div`
  width: 340px;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  background: rgba(248,113,113,0.12);
  border: 1px solid rgba(248,113,113,0.35);
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.statusLose};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
  text-align: center;
`;

export function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const create = () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    getSocket().emit('room:create', { name: name.trim() }, (resp: { seatId: string; seatToken: string; roomId: string } | { ok: false; code: string }) => {
      if ('seatId' in resp) {
        storeSeatToken(resp.roomId, resp.seatToken);
        dispatch(selfSeatAssigned({ seatId: resp.seatId, seatToken: resp.seatToken }));
        navigate(`/room/${resp.roomId}`);
      } else setError(resp?.code ?? 'Failed to create room');
    });
  };

  const join = () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    if (!code.trim()) { setError('Please enter a room code'); return; }
    const roomCode = code.trim().toUpperCase();
    getSocket().emit('room:join', { roomId: roomCode, name: name.trim() }, (resp: { seatId: string; seatToken: string } | { ok: false; code: string }) => {
      if ('seatId' in resp) {
        storeSeatToken(roomCode, resp.seatToken);
        dispatch(selfSeatAssigned({ seatId: resp.seatId, seatToken: resp.seatToken }));
        navigate(`/room/${roomCode}`);
      } else setError(resp.code);
    });
    getSocket().once('error', (err: { message: string }) => setError(err.message));
  };

  return (
    <Page>
      <div>
        <Brand>BLACKJACK 21</Brand>
        <Subtitle>A real-time multiplayer game</Subtitle>
      </div>
      <Card>
        <div>
          <Label htmlFor="home-name">Your name</Label>
          <Input
            id="home-name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <PrimaryButton onClick={create}>Create Room</PrimaryButton>
        <Divider>or join an existing one</Divider>
        <JoinRow>
          <CodeInput
            placeholder="Room code"
            value={code}
            maxLength={5}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <OutlineButton onClick={join}>Join</OutlineButton>
        </JoinRow>
      </Card>
      {error && <Error role="alert">{error}</Error>}
    </Page>
  );
}

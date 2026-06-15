import { useState } from 'react';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { selfSeatAssigned } from '../store/connection.slice';
import { storeSeatToken } from '../lib/seat-token';

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
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Error = styled.div`
  color: ${({ theme }) => theme.colors.statusLose};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
`;

const Header = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ theme }) => theme.typography.titleSize};
  letter-spacing: 6px;
  font-style: italic;
  text-align: center;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Sub = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 2px;
  text-transform: uppercase;
`;

type Props = { roomCode: string };

export function NamePrompt({ roomCode }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dispatch = useDispatch();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    getSocket().emit(
      'room:join',
      { roomId: roomCode, name: trimmed },
      (resp: { seatId: string; seatToken: string } | { ok: false; code: string }) => {
        setBusy(false);
        if ('seatId' in resp) {
          storeSeatToken(roomCode, resp.seatToken);
          dispatch(selfSeatAssigned({ seatId: resp.seatId, seatToken: resp.seatToken }));
        } else {
          setError(resp?.code ?? 'Failed to join');
        }
      },
    );
  };

  return (
    <Page>
      <Header>BLACKJACK 21</Header>
      <Sub>Joining room {roomCode}</Sub>
      <Card>
        <Label htmlFor="name-prompt-name">Your name</Label>
        <Input
          id="name-prompt-name"
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <PrimaryButton type="button" onClick={submit} disabled={!name.trim() || busy}>
          Join
        </PrimaryButton>
        {error && <Error role="alert">{error}</Error>}
      </Card>
    </Page>
  );
}

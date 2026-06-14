import styled from 'styled-components';
import { RoomCode } from './RoomCode';
import { PlayerList } from './PlayerList';
import { StartButton } from './StartButton';

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

const Title = styled.h1`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 28px;
  letter-spacing: 6px;
  font-style: italic;
  font-weight: normal;
  font-family: ${({ theme }) => theme.typography.fontFamily};
  text-align: center;
  margin: 0;
`;

const BottomBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  width: 100%;
  max-width: 480px;
`;

export function Lobby() {
  return (
    <Page>
      <Title>WAITING ROOM</Title>
      <PlayerList />
      <BottomBlock>
        <RoomCode />
        <StartButton />
      </BottomBlock>
    </Page>
  );
}

import styled from 'styled-components';

const Tile = styled.div`
  width: 100%;
  max-width: 180px;
  aspect-ratio: 1 / 1;
  border: 2px dashed ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.seat};
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  opacity: 0.6;
`;

const Glyph = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 28px;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Label = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-weight: bold;
`;

export function EmptySeatTile() {
  return (
    <Tile aria-label="empty-seat">
      <Glyph>+</Glyph>
      <Label>Empty</Label>
    </Tile>
  );
}

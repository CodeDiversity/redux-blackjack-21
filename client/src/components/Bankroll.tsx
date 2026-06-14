import styled from 'styled-components';

const Wrapper = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
`;

export function Bankroll({ amount }: { amount: number }) {
  return <Wrapper>${amount}</Wrapper>;
}

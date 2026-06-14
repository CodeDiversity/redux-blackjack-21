export function BetDisplay({ bet }: { bet: number }) {
  if (bet === 0) return null;
  return <div className="bet">Bet: ${bet}</div>;
}

import type { ErrorCode } from './types';

export const ErrorMessages: Record<ErrorCode, string> = {
  NOT_YOUR_TURN: "It's not your turn yet.",
  INVALID_PHASE: 'You cannot do that right now.',
  INSUFFICIENT_FUNDS: 'You do not have enough chips for that.',
  BET_OUT_OF_RANGE: 'Bet is outside the allowed range.',
  ROOM_FULL: 'That room is full.',
  ROOM_NOT_FOUND: 'No room with that code.',
  CANNOT_SPLIT: 'This hand cannot be split.',
  HAND_LOCKED: 'This hand is no longer playable.',
  NAME_REQUIRED: 'Please enter a name.',
};

export function makeError(code: ErrorCode): { code: ErrorCode; message: string } {
  return { code, message: ErrorMessages[code] };
}

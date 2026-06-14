import type { Middleware } from '@reduxjs/toolkit';
import type { Socket } from 'socket.io-client';
import {
  errorReceived, selfSeatAssigned,
} from '../store/connection.slice';
import { lobbyStateReceived } from '../store/lobby.slice';
import { gameStateReceived, roundResultReceived } from '../store/game.slice';
import { toastShown } from '../store/ui.slice';
import type { GameState, LobbyState, RoundResult } from '../shared/types';

// kept for parity with future wiring in App.tsx (selfSeatAssigned dispatched on create/join ack)
void selfSeatAssigned;

export const socketMiddleware = (getSocket: () => Socket): Middleware => () => (next) => (action: any) => {
  switch (action.type) {
    case 'socket/roomCreate': {
      getSocket().emit('room:create', { name: action.name }, (resp: { seatId: string } | { ok: false; code: string }) => {
        if ('seatId' in resp) {
          // Assigned in onJoin/onCreate handler; nothing to do here.
        } else {
          // server-side error
        }
      });
      return;
    }
    case 'socket/bet': getSocket().emit('bet:place', { amount: action.amount }); return;
    case 'socket/hit': getSocket().emit('hand:hit', { handIndex: action.handIndex }); return;
    case 'socket/stand': getSocket().emit('hand:stand', { handIndex: action.handIndex }); return;
    case 'socket/double': getSocket().emit('hand:double', { handIndex: action.handIndex }); return;
    case 'socket/split': getSocket().emit('hand:split', { handIndex: action.handIndex }); return;
    case 'socket/startRound': getSocket().emit('round:start'); return;
  }
  const result = next(action);
  return result;
};

export function attachSocketListeners(socket: Socket, dispatch: any) {
  socket.on('lobby:state', (payload: LobbyState) => {
    dispatch(lobbyStateReceived(payload));
    // The first time we see ourselves in the players list, remember our seatId.
  });
  socket.on('game:state', (payload: GameState) => dispatch(gameStateReceived(payload)));
  socket.on('round:result', (payload: RoundResult) => dispatch(roundResultReceived(payload)));
  socket.on('error', (payload: { code: string; message: string }) => {
    dispatch(errorReceived(payload));
    dispatch(toastShown(payload));
  });
}

import { Injectable } from '@nestjs/common';
import { Config } from '../config';
import { createInitialState, GameError, applyAction, type Action } from '../game/state-machine';
import { generateRoomCode } from './room-code';
import type { Card, GameState, LobbyState, PlayerSeat } from '../shared/types';

@Injectable()
export class RoomService {
  private rooms = new Map<string, Room>();

  createRoom(hostSocketId: string, hostName: string): { roomId: string; seatId: string; state: GameState } {
    const roomId = this.uniqueRoomId();
    const state = createInitialState(roomId, Config.SEAT_COUNT);
    const seat = this.assignFirstEmptySeat(state, hostSocketId, hostName);
    const room: Room = { id: roomId, state, seats: new Map([[seat.id, { socketId: hostSocketId, seatId: seat.id, name: hostName }]]) };
    this.rooms.set(roomId, room);
    return { roomId, seatId: seat.id, state };
  }

  joinRoom(roomId: string, socketId: string, name: string): { seatId: string; state: GameState } {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError('ROOM_NOT_FOUND');
    if (room.seats.size >= Config.SEAT_COUNT) throw new GameError('ROOM_FULL');
    const seat = this.assignFirstEmptySeat(room.state, socketId, name);
    room.seats.set(seat.id, { socketId, seatId: seat.id, name });
    return { seatId: seat.id, state: room.state };
  }

  leaveRoom(roomId: string, socketId: string): { state: GameState; destroyed: boolean; hostId?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { state: createInitialState(roomId, Config.SEAT_COUNT), destroyed: true };
    const seatEntry = [...room.seats.values()].find((e) => e.socketId === socketId);
    if (!seatEntry) return { state: room.state, destroyed: false };
    room.seats.delete(seatEntry.seatId);
    room.state = {
      ...room.state,
      players: room.state.players.map((p) => p.id === seatEntry.seatId ? { ...p, status: 'empty' as const, name: '' } : p),
    };
    if (room.seats.size === 0) {
      this.rooms.delete(roomId);
      return { state: room.state, destroyed: true };
    }
    const hostId = this.pickHost(room);
    return { state: room.state, destroyed: false, hostId };
  }

  apply(roomId: string, action: Action, draw?: () => Card): GameState {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError('ROOM_NOT_FOUND');
    const next = applyAction(room.state, action, draw);
    room.state = next;
    return next;
  }

  getState(roomId: string): GameState | undefined {
    return this.rooms.get(roomId)?.state;
  }

  getLobbyState(roomId: string): LobbyState | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return {
      roomId,
      hostId: this.pickHost(room),
      players: room.state.players
        .filter((p) => p.status !== 'empty')
        .map((p) => ({ id: p.id, name: p.name, ready: p.status !== 'empty', connectedAt: p.connectedAt })),
    };
  }

  roomForSocket(socketId: string): { roomId: string; seatId: string } | undefined {
    for (const room of this.rooms.values()) {
      for (const entry of room.seats.values()) {
        if (entry.socketId === socketId) return { roomId: room.id, seatId: entry.seatId };
      }
    }
    return undefined;
  }

  private pickHost(room: Room): string {
    const seated = [...room.seats.values()].map((e) => ({ ...e, connectedAt: room.state.players.find((p) => p.id === e.seatId)!.connectedAt }));
    seated.sort((a, b) => a.connectedAt - b.connectedAt);
    return seated[0]!.seatId;
  }

  private uniqueRoomId(): string {
    let id: string;
    do { id = generateRoomCode(); } while (this.rooms.has(id));
    return id;
  }

  private assignFirstEmptySeat(state: GameState, socketId: string, name: string): PlayerSeat {
    const idx = state.players.findIndex((p) => p.status === 'empty');
    if (idx === -1) throw new GameError('ROOM_FULL');
    const next = [...state.players];
    next[idx] = { ...next[idx], id: socketId, name, status: 'betting' as const, connectedAt: Date.now() };
    state.players = next;
    return next[idx];
  }
}

type Room = {
  id: string;
  state: GameState;
  seats: Map<string, { socketId: string; seatId: string; name: string }>;
};

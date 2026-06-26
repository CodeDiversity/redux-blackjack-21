import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Config } from '../config';
import { createInitialState, GameError, applyAction, type Action } from '../game/state-machine';
import { generateRoomCode } from './room-code';
import { getBankroll, setBankroll } from '../storage/bankroll.repository';
import type { Card, GameState, LobbyState, PlayerSeat } from '../shared/types';

@Injectable()
export class RoomService {
  private rooms = new Map<string, Room>();

  createRoom(hostSocketId: string, hostName: string, hostPlayerId: string): { roomId: string; seatId: string; seatToken: string; state: GameState } {
    const roomId = this.uniqueRoomId();
    const state = createInitialState(roomId, Config.SEAT_COUNT);
    const seatId = randomUUID();
    const seatToken = randomUUID();
    this.assignSeat(state, seatId, hostSocketId, hostName, hostPlayerId);
    const room: Room = {
      id: roomId,
      state,
      seats: new Map([[seatId, { socketId: hostSocketId, seatId, seatToken, name: hostName, playerId: hostPlayerId }]]),
    };
    this.rooms.set(roomId, room);
    return { roomId, seatId, seatToken, state };
  }

  joinRoom(roomId: string, socketId: string, name: string, playerId: string): { seatId: string; seatToken: string; state: GameState } {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError('ROOM_NOT_FOUND');
    if (room.seats.size >= Config.SEAT_COUNT) throw new GameError('ROOM_FULL');
    const seatId = randomUUID();
    const seatToken = randomUUID();
    this.assignSeat(room.state, seatId, socketId, name, playerId);
    room.seats.set(seatId, { socketId, seatId, seatToken, name, playerId });
    return { seatId, seatToken, state: room.state };
  }

  resumeSeat(roomId: string, seatToken: string, newSocketId: string, playerId: string): { seatId: string; state: GameState } {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError('ROOM_NOT_FOUND');
    const entry = [...room.seats.values()].find((e) => e.seatToken === seatToken);
    if (!entry) throw new GameError('SEAT_GONE');
    entry.socketId = newSocketId;
    entry.playerId = playerId;
    return { seatId: entry.seatId, state: room.state };
  }

  /**
   * Look up a seat entry by room + token without mutating it.
   * Used by the gateway to find the seatId when handling room:resume, so it
   * can cancel any pending disconnect-grace timer before the resume mutates
   * the entry's socketId.
   */
  findSeatByToken(roomId: string, seatToken: string): { seatId: string } | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    const entry = [...room.seats.values()].find((e) => e.seatToken === seatToken);
    if (!entry) return undefined;
    return { seatId: entry.seatId };
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

    // Snapshot pre-action bankrolls so we can writeback any seat whose
    // bankroll changed. The state machine is pure; persistence is the room
    // service's job (mirrors how hands.repository.recordHand is called from
    // the gateway, not from inside applyAction).
    const prevBankrolls = room.state.players.map((p) => p.bankroll);

    const next = applyAction(room.state, action, draw);
    room.state = next;

    for (let i = 0; i < next.players.length; i++) {
      const seat = next.players[i];
      if (seat.status === 'empty') continue;
      if (prevBankrolls[i] === seat.bankroll) continue;
      const entry = room.seats.get(seat.id);
      if (!entry?.playerId) continue;
      setBankroll(entry.playerId, seat.bankroll);
    }

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

  /**
   * Look up a seat entry in a specific room by its current socket id, without
   * scanning other rooms. Used by the disconnect handler to discover the
   * seatId of a socket that already had its room cached in socketToRoom.
   */
  findSeatBySocketId(roomId: string, socketId: string): { seatId: string } | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    const entry = [...room.seats.values()].find((e) => e.socketId === socketId);
    if (!entry) return undefined;
    return { seatId: entry.seatId };
  }

  getPlayerIdForSeat(roomId: string, seatId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return room.seats.get(seatId)?.playerId;
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

  private assignSeat(state: GameState, seatId: string, socketId: string, name: string, playerId: string): PlayerSeat {
    const idx = state.players.findIndex((p) => p.status === 'empty');
    if (idx === -1) throw new GameError('ROOM_FULL');
    const next = [...state.players];
    next[idx] = {
      ...next[idx],
      id: seatId,
      name,
      bankroll: getBankroll(playerId),
      status: 'betting' as const,
      connectedAt: Date.now(),
    };
    state.players = next;
    return next[idx];
  }
}

type Room = {
  id: string;
  state: GameState;
  seats: Map<string, { socketId: string; seatId: string; seatToken: string; name: string; playerId: string }>;
};

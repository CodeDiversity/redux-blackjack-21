import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room.service';
import { GameService } from '../game/game.service';
import { applyAction, GameError } from '../game/state-machine';
import { makeError } from '../shared/errors';
import { Config } from '../config';
import type { GameState, LobbyState, ServerEvent } from '../shared/types';

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(GameGateway.name);
  private socketToRoom = new Map<string, string>();
  /**
   * Pending seat removals scheduled after a socket disconnect. Keyed by
   * `${roomId}:${seatId}` so a returning client resuming with the same
   * seatToken (from a fresh socket id) can cancel its own grace timer.
   * The timer fires `Config.DISCONNECT_GRACE_MS` after the original
   * disconnect, allowing reloads and short reconnects to keep the seat.
   */
  private pendingLeaves = new Map<string, NodeJS.Timeout>();

  /**
   * Clear all pending leave timers on module destroy so the Node event loop
   * can exit and stale callbacks don't fire against a torn-down instance.
   */
  onModuleDestroy() {
    for (const timer of this.pendingLeaves.values()) clearTimeout(timer);
    this.pendingLeaves.clear();
  }

  constructor(
    private readonly rooms: RoomService,
    private readonly games: GameService,
  ) {}

  handleConnection(client: Socket) {
    this.log.log(`connect ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.log.log(`disconnect ${client.id}`);
    const roomId = this.socketToRoom.get(client.id);
    if (!roomId) return;

    // Find the seat this socket owned, if any. If the socket is not bound
    // to a seat (e.g. a brand-new client that never called room:create/join),
    // there's nothing to defer.
    const seatEntry = this.rooms.findSeatBySocketId(roomId, client.id);
    if (!seatEntry) {
      this.socketToRoom.delete(client.id);
      return;
    }

    const leaveKey = `${roomId}:${seatEntry.seatId}`;
    // If a leave was somehow already scheduled for this seat, leave it
    // alone (idempotent). Otherwise schedule one.
    if (this.pendingLeaves.has(leaveKey)) return;

    const oldSocketId = client.id;
    const timer = setTimeout(() => {
      this.pendingLeaves.delete(leaveKey);
      // The seat may already be gone (e.g. a later explicit leave or a
      // game-state eviction). leaveRoom is safe to call either way.
      const { state, destroyed } = this.rooms.leaveRoom(roomId, oldSocketId);
      if (destroyed) {
        this.games.discardRoom(roomId);
        return;
      }
      this.broadcastAll(roomId, state);
    }, Config.DISCONNECT_GRACE_MS);
    this.pendingLeaves.set(leaveKey, timer);
  }

  private cancelPendingLeave(roomId: string, seatId: string): boolean {
    const leaveKey = `${roomId}:${seatId}`;
    const timer = this.pendingLeaves.get(leaveKey);
    if (!timer) return false;
    clearTimeout(timer);
    this.pendingLeaves.delete(leaveKey);
    return true;
  }

  @SubscribeMessage('room:create')
  onCreate(@ConnectedSocket() client: Socket, @MessageBody() body: { name: string }) {
    if (!body?.name?.trim()) return this.sendError(client, 'NAME_REQUIRED');
    const { roomId, seatId, seatToken, state } = this.rooms.createRoom(client.id, body.name.trim());
    // Defensive: clear any pending leave for this brand-new seat (would only
    // fire if somehow a token collided, which UUIDs won't do, but be safe).
    this.cancelPendingLeave(roomId, seatId);
    this.socketToRoom.set(client.id, roomId);
    this.games.ensureShoe(roomId, state);
    this.emit(client, { type: 'lobby:state', payload: this.rooms.getLobbyState(roomId)! });
    this.emit(client, { type: 'game:state', payload: this.publicState(state) });
    client.join(roomId);
    return { seatId, seatToken, roomId };
  }

  @SubscribeMessage('room:join')
  onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string; name: string }) {
    if (!body?.name?.trim()) return this.sendError(client, 'NAME_REQUIRED');
    try {
      const { seatId, seatToken, state } = this.rooms.joinRoom(body.roomId, client.id, body.name.trim());
      this.cancelPendingLeave(body.roomId, seatId);
      this.socketToRoom.set(client.id, body.roomId);
      this.games.ensureShoe(body.roomId, state);
      client.join(body.roomId);
      this.broadcastAll(body.roomId, state);
      return { seatId, seatToken };
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }

  @SubscribeMessage('room:resume')
  onResume(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string; seatToken: string }) {
    if (!body?.roomId || !body?.seatToken) return this.sendError(client, 'NAME_REQUIRED');
    // Look up the seat BEFORE resumeSeat mutates the entry's socketId, so we
    // can cancel the pending leave using the (unchanged) seatId key.
    const found = this.rooms.findSeatByToken(body.roomId, body.seatToken);
    try {
      const { seatId, state } = this.rooms.resumeSeat(body.roomId, body.seatToken, client.id);
      if (found) this.cancelPendingLeave(body.roomId, found.seatId);
      this.socketToRoom.set(client.id, body.roomId);
      client.join(body.roomId);
      this.emit(client, { type: 'lobby:state', payload: this.rooms.getLobbyState(body.roomId)! });
      this.emit(client, { type: 'game:state', payload: this.publicState(state) });
      this.broadcastAll(body.roomId, state);
      return { seatId };
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }

  @SubscribeMessage('round:ready')
  onReady(@ConnectedSocket() client: Socket) {
    const ctx = this.rooms.roomForSocket(client.id);
    if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
    try {
      const state = this.rooms.apply(ctx.roomId, { type: 'round:ready', seatId: ctx.seatId });
      this.broadcastAll(ctx.roomId, state);
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }

  @SubscribeMessage('round:advance')
  onAdvance(@ConnectedSocket() client: Socket) {
    const ctx = this.rooms.roomForSocket(client.id);
    if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
    const lobby = this.rooms.getLobbyState(ctx.roomId);
    if (!lobby || lobby.hostId !== ctx.seatId) return this.sendError(client, 'NOT_HOST');
    try {
      const state = this.rooms.apply(ctx.roomId, { type: 'round:advance', seatId: ctx.seatId });
      this.broadcastAll(ctx.roomId, state);
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }

  @SubscribeMessage('round:start')
  onStart(@ConnectedSocket() client: Socket) {
    const ctx = this.rooms.roomForSocket(client.id);
    if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
    try {
      this.games.ensureShoe(ctx.roomId, this.rooms.getState(ctx.roomId)!);
      const draw = () => this.games.draw(ctx.roomId).card;
      const state = this.rooms.apply(ctx.roomId, { type: 'round:start', seatId: ctx.seatId }, draw);
      this.broadcastAll(ctx.roomId, state);
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }

  @SubscribeMessage('bet:place')
  onBet(@ConnectedSocket() client: Socket, @MessageBody() body: { amount: number }) {
    const ctx = this.rooms.roomForSocket(client.id);
    if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
    try {
      const state = this.rooms.apply(ctx.roomId, { type: 'bet:place', seatId: ctx.seatId, amount: body.amount });
      this.broadcastAll(ctx.roomId, state);
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }

  @SubscribeMessage('hand:hit')
  onHit(@ConnectedSocket() client: Socket, @MessageBody() body: { handIndex: number }) {
    return this.runHandAction(client, { type: 'hand:hit', seatId: '', handIndex: body.handIndex });
  }

  @SubscribeMessage('hand:stand')
  onStand(@ConnectedSocket() client: Socket, @MessageBody() body: { handIndex: number }) {
    return this.runHandAction(client, { type: 'hand:stand', seatId: '', handIndex: body.handIndex });
  }

  @SubscribeMessage('hand:double')
  onDouble(@ConnectedSocket() client: Socket, @MessageBody() body: { handIndex: number }) {
    return this.runHandAction(client, { type: 'hand:double', seatId: '', handIndex: body.handIndex });
  }

  @SubscribeMessage('hand:split')
  onSplit(@ConnectedSocket() client: Socket, @MessageBody() body: { handIndex: number }) {
    return this.runHandAction(client, { type: 'hand:split', seatId: '', handIndex: body.handIndex });
  }

  private runHandAction(client: Socket, action: { type: 'hand:hit' | 'hand:stand' | 'hand:double' | 'hand:split'; seatId: string; handIndex: number }) {
    const ctx = this.rooms.roomForSocket(client.id);
    if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
    try {
      this.games.ensureShoe(ctx.roomId, this.rooms.getState(ctx.roomId)!);
      const draw = () => this.games.draw(ctx.roomId).card;
      const state = this.rooms.apply(ctx.roomId, { ...action, seatId: ctx.seatId }, draw);
      this.broadcastAll(ctx.roomId, state);
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }

  private broadcastAll(roomId: string, state: GameState) {
    const lobby = this.rooms.getLobbyState(roomId);
    if (lobby) this.server.to(roomId).emit('lobby:state', lobby);
    this.server.to(roomId).emit('game:state', this.publicState(state));
    if (state.phase === 'settled' && state.lastResult) this.server.to(roomId).emit('round:result', state.lastResult);
  }

  private publicState(state: GameState): GameState {
    if (state.phase === 'dealer_turn' || state.phase === 'settled') return state;
    return { ...state, dealer: { ...state.dealer, cards: state.dealer.cards.map((c) => ('hidden' in c ? c : c)) } };
  }

  private emit(client: Socket, event: ServerEvent) {
    client.emit(event.type, event.payload);
  }

  private sendError(client: Socket, code: any) {
    const err = makeError(code);
    client.emit('error', err);
    return { ok: false, code };
  }
}

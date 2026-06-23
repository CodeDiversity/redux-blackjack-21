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
import { readPlayerIdFromHandshake } from '../player/player-identity';
import type { GameState, LobbyState, ServerEvent } from '../shared/types';

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(GameGateway.name);
  private socketToRoom = new Map<string, string>();
  private socketToPlayerId = new Map<string, string>();
  /**
   * Pending seat removals scheduled after a socket disconnect. Keyed by
   * `${roomId}:${seatId}` so a returning client resuming with the same
   * seatToken (from a fresh socket id) can cancel its own grace timer.
   * The timer fires `Config.DISCONNECT_GRACE_MS` after the original
   * disconnect, allowing reloads and short reconnects to keep the seat.
   */
  private pendingLeaves = new Map<string, NodeJS.Timeout>();

  /**
   * Pending round-advance timers. Keyed by `roomId`. Holds the `setTimeout`
   * handle and the ms-epoch when it will fire. The value's `fireAt` is what
   * we attach to the `game:state` payload as `phaseEndsAt` so clients can
   * render countdowns without an extra wire event.
   */
  private pendingTimers = new Map<string, { timer: NodeJS.Timeout; fireAt: number }>();

  /**
   * Clear all pending leave timers on module destroy so the Node event loop
   * can exit and stale callbacks don't fire against a torn-down instance.
   */
  onModuleDestroy() {
    for (const timer of this.pendingLeaves.values()) clearTimeout(timer);
    this.pendingLeaves.clear();
    for (const entry of this.pendingTimers.values()) clearTimeout(entry.timer);
    this.pendingTimers.clear();
  }

  constructor(
    private readonly rooms: RoomService,
    private readonly games: GameService,
  ) {}

  handleConnection(client: Socket) {
    let playerId: string;
    try {
      playerId = readPlayerIdFromHandshake(client.handshake.auth);
    } catch (e) {
      this.log.warn(`rejecting ${client.id}: ${(e as Error).message}`);
      client.emit('error', { code: 'AUTH_REQUIRED', message: 'playerId missing or invalid' });
      client.disconnect(true);
      return;
    }
    this.socketToPlayerId.set(client.id, playerId);
    this.log.log(`connect ${client.id} (playerId ${playerId})`);
  }

  handleDisconnect(client: Socket) {
    this.log.log(`disconnect ${client.id}`);
    this.socketToPlayerId.delete(client.id);
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
        this.cancelAutoAdvance(roomId);  // clear any pending settle/bet timer before teardown
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

  private scheduleAutoAdvance(roomId: string, phase: 'settled' | 'betting' | 'dealing') {
    this.cancelAutoAdvance(roomId);
    const ms =
      phase === 'settled'  ? Config.SETTLE_PAUSE_MS :
      phase === 'betting'  ? Config.BET_DEADLINE_MS :
                             Config.DEALING_DURATION_MS;
    const fireAt = Date.now() + ms;
    const timer = setTimeout(() => this.fireAutoAdvance(roomId, phase), ms);
    this.pendingTimers.set(roomId, { timer, fireAt });
  }

  private cancelAutoAdvance(roomId: string) {
    const entry = this.pendingTimers.get(roomId);
    if (entry) { clearTimeout(entry.timer); this.pendingTimers.delete(roomId); }
  }

  private fireAutoAdvance(roomId: string, phase: 'settled' | 'betting' | 'dealing') {
    this.pendingTimers.delete(roomId);
    const room = this.rooms.getState(roomId);
    if (!room) return;
    if (room.phase !== phase) return;  // race: phase changed
    try {
      if (phase === 'settled') {
        // Server-internal round:advance. seatId '__server__' is a sentinel for tracing.
        this.rooms.apply(roomId, { type: 'round:advance', seatId: '__server__' });
        this.broadcastAll(roomId, this.rooms.getState(roomId)!);
      } else if (phase === 'dealing') {
        this.rooms.apply(roomId, { type: 'round:dealingComplete', seatId: '__server__' });
        this.broadcastAll(roomId, this.rooms.getState(roomId)!);
      } else {
        this.games.ensureShoe(roomId, this.rooms.getState(roomId)!);
        const draw = () => this.games.draw(roomId).card;
        this.rooms.apply(roomId, { type: 'round:betDeadline', seatId: '__server__' }, draw);
        this.broadcastAll(roomId, this.rooms.getState(roomId)!);
      }
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      this.log.warn(`auto-advance failed: ${(e as GameError).code}`);
    }
  }

  @SubscribeMessage('room:create')
  onCreate(@ConnectedSocket() client: Socket, @MessageBody() body: { name: string }) {
    if (!body?.name?.trim()) return this.sendError(client, 'NAME_REQUIRED');
    const { roomId, seatId, seatToken, state } = this.rooms.createRoom(
      client.id, body.name.trim(), this.socketToPlayerId.get(client.id)!,
    );
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
      const { seatId, seatToken, state } = this.rooms.joinRoom(
        body.roomId, client.id, body.name.trim(), this.socketToPlayerId.get(client.id)!,
      );
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
      const { seatId, state } = this.rooms.resumeSeat(
        body.roomId, body.seatToken, client.id, this.socketToPlayerId.get(client.id)!,
      );
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
    // Drive timers off the new phase FIRST so attachPhaseEndsAt sees the new fireAt.
    if (state.phase === 'settled') this.scheduleAutoAdvance(roomId, 'settled');
    else if (state.phase === 'betting') this.scheduleAutoAdvance(roomId, 'betting');
    else if (state.phase === 'dealing') this.scheduleAutoAdvance(roomId, 'dealing');
    else this.cancelAutoAdvance(roomId);

    const lobby = this.rooms.getLobbyState(roomId);
    if (lobby) this.server.to(roomId).emit('lobby:state', lobby);
    const publicState = this.attachPhaseEndsAt(roomId, state);
    this.server.to(roomId).emit('game:state', this.publicState(publicState));
    if (state.phase === 'settled' && state.lastResult) this.server.to(roomId).emit('round:result', state.lastResult);
  }

  private attachPhaseEndsAt(roomId: string, state: GameState): GameState {
    if (state.phase !== 'settled' && state.phase !== 'betting' && state.phase !== 'dealing') {
      return { ...state, phaseEndsAt: null };
    }
    const entry = this.pendingTimers.get(roomId);
    if (!entry) return { ...state, phaseEndsAt: null };
    return { ...state, phaseEndsAt: entry.fireAt };
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

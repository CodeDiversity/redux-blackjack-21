import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RoomService } from '../room/room.service';
import { GameService } from '../game/game.service';
import { applyAction, GameError } from '../game/state-machine';
import { makeError } from '../shared/errors';
import type { GameState, LobbyState, ServerEvent } from '../shared/types';

@WebSocketGateway({ cors: { origin: 'http://localhost:5173', credentials: true } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(GameGateway.name);
  private socketToRoom = new Map<string, string>();

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
    if (roomId) {
      const { state, destroyed } = this.rooms.leaveRoom(roomId, client.id);
      if (destroyed) this.games.discardRoom(roomId);
      else this.broadcastAll(roomId, state);
    }
  }

  @SubscribeMessage('room:create')
  onCreate(@ConnectedSocket() client: Socket, @MessageBody() body: { name: string }) {
    if (!body?.name?.trim()) return this.sendError(client, 'NAME_REQUIRED');
    const { roomId, seatId, state } = this.rooms.createRoom(client.id, body.name.trim());
    this.socketToRoom.set(client.id, roomId);
    this.games.ensureShoe(roomId, state);
    this.emit(client, { type: 'lobby:state', payload: this.rooms.getLobbyState(roomId)! });
    this.emit(client, { type: 'game:state', payload: this.publicState(state) });
    client.join(roomId);
    return { seatId };
  }

  @SubscribeMessage('room:join')
  onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string; name: string }) {
    if (!body?.name?.trim()) return this.sendError(client, 'NAME_REQUIRED');
    try {
      const { seatId, state } = this.rooms.joinRoom(body.roomId, client.id, body.name.trim());
      this.socketToRoom.set(client.id, body.roomId);
      this.games.ensureShoe(body.roomId, state);
      client.join(body.roomId);
      this.broadcastAll(body.roomId, state);
      return { seatId };
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

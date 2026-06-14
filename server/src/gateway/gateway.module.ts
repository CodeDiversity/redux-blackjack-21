import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { RoomModule } from '../room/room.module';
import { GameModule } from '../game/game.module';

@Module({
  imports: [RoomModule, GameModule],
  providers: [GameGateway],
})
export class GatewayModule {}

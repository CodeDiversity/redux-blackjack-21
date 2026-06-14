import { Module } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { RoomModule } from './room/room.module';
import { GatewayModule } from './gateway/gateway.module';

@Module({
  imports: [GameModule, RoomModule, GatewayModule],
})
export class AppModule {}

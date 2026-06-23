import { Module, OnModuleInit } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { RoomModule } from './room/room.module';
import { GatewayModule } from './gateway/gateway.module';
import { PlayerModule } from './player/player.module';
import { initDb } from './storage/db';

@Module({
  imports: [GameModule, RoomModule, GatewayModule, PlayerModule],
})
export class AppModule implements OnModuleInit {
  onModuleInit() {
    initDb();
  }
}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { KillSwitchController } from './kill-switch.controller';
import { KillSwitchService } from './kill-switch.service';

@Module({
  imports: [DatabaseModule],
  controllers: [KillSwitchController],
  providers: [KillSwitchService],
  exports: [KillSwitchService],
})
export class KillSwitchModule {}

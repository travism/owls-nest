// OutboxModule — wires the OutboxDrainService into the API process.
//
// ScheduleModule is registered here (idempotent; safe even if elsewhere too).
// EmailModule is global so we don't need to re-import it.

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxDrainService } from './outbox-drain.service';
import { OutboxController } from './outbox.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [OutboxController],
  providers: [OutboxDrainService],
  exports: [OutboxDrainService],
})
export class OutboxModule {}

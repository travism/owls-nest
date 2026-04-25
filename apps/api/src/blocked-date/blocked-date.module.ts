import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlockedDateService } from './blocked-date.service';
import { BlockedDateController } from './blocked-date.controller';

@Module({
  imports: [AuthModule],
  controllers: [BlockedDateController],
  providers: [BlockedDateService],
  exports: [BlockedDateService],
})
export class BlockedDateModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertyService } from './property.service';
import { PropertyController } from './property.controller';

@Module({
  imports: [AuthModule],
  controllers: [PropertyController],
  providers: [PropertyService],
  exports: [PropertyService],
})
export class PropertyModule {}

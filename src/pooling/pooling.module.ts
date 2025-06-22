import { Module } from '@nestjs/common';
import { PoolingService } from './pooling.service';
import { PoolingController } from './pooling.controller';

@Module({
  controllers: [PoolingController],
  providers: [PoolingService]
})
export class PoolingModule {}

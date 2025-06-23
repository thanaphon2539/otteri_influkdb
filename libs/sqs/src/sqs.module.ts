import { Module } from "@nestjs/common";
import { SqsService } from "./sqs.service";
import { ConfigModule } from "@nestjs/config";
import { InfluxModule } from "influx/influx";

@Module({
  imports: [ConfigModule, InfluxModule],
  providers: [SqsService],
  exports: [SqsService],
})
export class SqsModule {}

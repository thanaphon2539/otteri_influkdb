import { Module } from "@nestjs/common";
import { InfluxService } from "./influx.service";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [ConfigModule],
  providers: [InfluxService],
  exports: [InfluxService],
})
export class InfluxModule {}

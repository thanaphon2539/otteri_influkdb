import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "@nestjs/config";
import { PoolingModule } from "./pooling/pooling.module";
import { InfluxModule } from "influx/influx/influx.module";
import { SqsModule } from "sqs/sqs/sqs.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    PoolingModule,
    InfluxModule,
    SqsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

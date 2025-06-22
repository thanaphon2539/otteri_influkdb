import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";
import { InfluxService } from "influx/influx/influx.service";
import { SqsService } from "sqs/sqs/sqs.service";

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly influxService: InfluxService,
    private readonly sqsService: SqsService
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("influxdbquery")
  query() {
    return this.influxService.queryData();
  }

  @Get("sqsquery")
  Sqsquery() {
    return this.sqsService.receiveAndDeleteMessages();
  }
}

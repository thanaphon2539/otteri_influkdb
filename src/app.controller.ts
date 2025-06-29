import { Controller, Get, Post, Query } from "@nestjs/common";
import { AppService } from "./app.service";
import { InfluxService } from "influx/influx/influx.service";
import { SqsService } from "sqs/sqs/sqs.service";

class QueryParamsDto {
  start: string; // เช่น ISO date string
  stop: string; // เช่น ISO date string
  machineId: string; // optional
  time: string
}
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

  @Post("influxdbinsert")
  insert() {
    const data = {
      measurement: "temperature",
      tag: {
        machine_id: "18260",
      },
      fields: {
        temperature: 100,
        command_id: "test",
      },
      timestamp: new Date(),
    };
    return this.influxService.writePointFromJson(data);
  }

  @Post("influxdbdelete")
  delete() {
    return this.influxService.deleteData(
      "temperature",
      "1970-01-01T00:00:00Z",
      new Date().toISOString()
    );
  }

  @Get("dashboard/machine")
  query(@Query() query: QueryParamsDto) {
    return this.influxService.queryData(query);
  }

  @Get("sqsquery")
  sqsquery() {
    return this.sqsService.receiveMessages();
  }

  @Get("sqsquery/checktotal")
  querySQSdataTotalAll() {
    return this.sqsService.querySQSdataTotalAll();
  }
}

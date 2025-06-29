import { Injectable } from "@nestjs/common";
import {
  InfluxDB,
  Point,
  WriteApi,
  QueryApi,
} from "@influxdata/influxdb-client";
import { DeleteAPI } from "@influxdata/influxdb-client-apis";
import { ConfigService } from "@nestjs/config";
import dayjs from "dayjs";

@Injectable()
export class InfluxService {
  private influxDB: InfluxDB;
  private writeApi: WriteApi;
  private queryApi: QueryApi;
  private deleteApi: DeleteAPI;
  private readonly token: string;
  private readonly org: string;
  private readonly bucket: string;

  constructor(private configService: ConfigService) {
    this.org = this.configService.get("INFLUX_ORG");
    this.bucket = this.configService.get("INFLUX_BUCKET");
    this.token = this.configService.get("INFLUX_TOKEN");
    const url = this.configService.get("INFLUX_URL");
    this.influxDB = new InfluxDB({ url, token: this.token });
    this.writeApi = this.influxDB.getWriteApi(this.org, this.bucket);
    this.queryApi = this.influxDB.getQueryApi(this.org);
    this.deleteApi = new DeleteAPI(this.influxDB);
  }

  async writePointFromJson(data: {
    measurement: string;
    tags?: Record<string, string>;
    fields: Record<string, string | number | boolean>;
    timestamp?: string | Date;
  }) {
    const point = new Point(data.measurement);

    // เพิ่ม tag
    if (data.tags) {
      for (const [key, value] of Object.entries(data.tags)) {
        point.tag(key, value);
      }
    }

    // เพิ่ม field (เว้น timestamp ออกไป)
    for (const [key, value] of Object.entries(data.fields)) {
      if (key === "timestamp") continue;
      if (typeof value === "string") point.stringField(key, value);
      else if (typeof value === "boolean") point.booleanField(key, value);
      else if (typeof value === "number") point.floatField(key, value);
    }

    // ตั้ง timestamp (ถ้ามี)
    if (data.timestamp) {
      const ts = new Date(data.timestamp);
      if (!isNaN(ts.getTime())) {
        point.timestamp(ts);
      } else {
        console.warn("Invalid timestamp provided");
      }
    }

    // เขียน point
    this.writeApi.writePoint(point);

    try {
      await this.writeApi.flush();
      // console.log("Write success");
      return { success: true };
    } catch (error) {
      console.error("Write error", error);
      return { success: false, error: error.message || error };
    }
  }

  async writeMany(
    dataPoints: {
      measurement: string;
      tags: Record<string, string>;
      fields: Record<string, any>;
      timestamp: Date;
    }[]
  ) {
    const points = dataPoints.map((d) => {
      const p = new Point(d.measurement).timestamp(d.timestamp);
      Object.entries(d.tags).forEach(([key, val]) => p.tag(key, val));
      Object.entries(d.fields).forEach(([key, val]) => {
        if (typeof val === "number") {
          p.floatField(key, val);
        } else if (typeof val === "string") {
          p.stringField(key, val);
        }
      });
      return p;
    });

    this.writeApi.writePoints(points);
    await this.writeApi.flush(); // สำคัญมาก
  }

  // async queryData(params: {
  //   start: string;
  //   stop: string;
  //   machineId: string;
  //   time: string;
  // }) {
  //   const start = dayjs(params.start).toISOString();
  //   const stop = dayjs(params.stop).toISOString();

  //   let fluxQuery = `
  //   from(bucket: "soltempbucket")
  //     |> range(start: time(v: ${JSON.stringify(
  //       start
  //     )}), stop: time(v: ${JSON.stringify(stop)}))
  //     |> filter(fn: (r) => r["_measurement"] == "temperature")
  //     |> filter(fn: (r) =>
  //       r["_field"] == "command_id" or
  //       r["_field"] == "temperature"
  //     )
  // `;
  //   if (params.machineId) {
  //     fluxQuery += `|> filter(fn: (r) => r["machine_id"] == "${params.machineId}")`;
  //   }

  //   const dataMapObj: Record<string, any> = {};
  //   await new Promise<void>((resolve, reject) => {
  //     this.queryApi.queryRows(fluxQuery, {
  //       next: (row, tableMeta) => {
  //         const o = tableMeta.toObject(row);
  //         const timeKey = o._time?.toString();
  //         if (!dataMapObj[timeKey]) {
  //           dataMapObj[timeKey] = { _time: timeKey };
  //         }
  //         dataMapObj[timeKey][o._field] = o._value;
  //       },
  //       error: (error) => {
  //         console.error("Error from InfluxDB:", error);
  //         reject(error);
  //       },
  //       complete: () => {
  //         resolve();
  //       },
  //     });
  //   });

  //   const result = Object.values(dataMapObj);
  //   const categories = result.map((item) =>
  //     new Date(item._time).toLocaleTimeString()
  //   );
  //   const temperatureData = result.map((item) => item.temperature);
  //   const options = {
  //     series: [
  //       {
  //         name: "Temperature",
  //         data: temperatureData,
  //       },
  //     ],
  //     xaxis: {
  //       categories: categories,
  //     },
  //   };
  //   return options;
  // }

  async queryData(params: {
    start: string;
    stop: string;
    machineId: string;
    time: string; // "1hr", "6hr", "1day", etc.
  }) {
    const start = dayjs(params.start).toISOString();
    const stop = dayjs(params.stop).toISOString();

    let every = "1m";
    switch (params.time) {
      case "1hr":
        every = "1m";
        break;
      case "6hr":
        every = "5m";
        break;
      case "1day":
        every = "15m";
        break;
      case "3day":
        every = "30m";
        break;
      case "5day":
        every = "1h";
        break;
    }

    // ------ Flux Query 1: temperature (mean) ------
    let tempQuery = `
      from(bucket: "soltempbucket")
        |> range(start: time(v: ${JSON.stringify(
          start
        )}), stop: time(v: ${JSON.stringify(stop)}))
        |> filter(fn: (r) => r["_measurement"] == "temperature")
        |> filter(fn: (r) => r["_field"] == "temperature")
    `;

    if (params.machineId) {
      tempQuery += `\n|> filter(fn: (r) => r["machine_id"] == "${params.machineId}")`;
    }

    tempQuery += `
      |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
      |> yield(name: "mean")
    `;

    // ------ Flux Query 2: command_id (last) ------
    let commandQuery = `
      from(bucket: "soltempbucket")
        |> range(start: time(v: ${JSON.stringify(
          start
        )}), stop: time(v: ${JSON.stringify(stop)}))
        |> filter(fn: (r) => r["_measurement"] == "temperature")
        |> filter(fn: (r) => r["_field"] == "command_id")
    `;

    if (params.machineId) {
      commandQuery += `\n|> filter(fn: (r) => r["machine_id"] == "${params.machineId}")`;
    }

    commandQuery += `
      |> aggregateWindow(every: ${every}, fn: last, createEmpty: false)
      |> yield(name: "last")
    `;

    // Map: timestamp → merged object
    const dataMapObj: Record<string, any> = {};

    const runQuery = async (fluxQuery: string) => {
      await new Promise<void>((resolve, reject) => {
        this.queryApi.queryRows(fluxQuery, {
          next: (row, tableMeta) => {
            const o = tableMeta.toObject(row);
            const timeKey = o._time?.toString();
            if (!dataMapObj[timeKey]) {
              dataMapObj[timeKey] = { _time: timeKey };
            }
            dataMapObj[timeKey][o._field] = o._value;
          },
          error: (error) => {
            console.error("Error from InfluxDB:", error);
            reject(error);
          },
          complete: () => {
            resolve();
          },
        });
      });
    };

    await runQuery(tempQuery);
    await runQuery(commandQuery);

    // Sort & format
    const result = Object.values(dataMapObj).sort(
      (a: any, b: any) =>
        new Date(a._time).getTime() - new Date(b._time).getTime()
    );

    const categories = result.map((item) =>
      new Date(item._time).toLocaleTimeString()
    );
    const temperatureData = result.map((item) =>
      item.temperature != null ? Number(item.temperature).toFixed(2) : null
    );
    // const commandIdData = result.map((item) => item.command_id);

    return {
      series: [
        {
          name: "Temperature",
          data: temperatureData,
        },
        // {
        //   name: "Command ID",
        //   data: commandIdData,
        // },
      ],
      xaxis: {
        categories: categories,
      },
      raw: result, // หากอยาก debug เพิ่มเติม
    };
  }

  async deleteData(measurement: string, start: string, stop: string) {
    const predicate = `_measurement="${measurement}"`;
    try {
      await this.deleteApi.postDelete({
        org: this.org,
        bucket: this.bucket,
        body: {
          start,
          stop,
          predicate,
        },
      });
      console.log("Delete success");
      return { success: true };
    } catch (error) {
      console.error("Delete error:", error);
      throw new Error("Failed to delete data");
    }
  }
}

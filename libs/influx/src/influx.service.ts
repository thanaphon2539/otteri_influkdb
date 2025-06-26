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
      console.log("Write success");
      return { success: true };
    } catch (error) {
      console.error("Write error", error);
      return { success: false, error: error.message || error };
    }
  }

  writePoint() {
    const point = new Point("temperature").floatField("timestamp", Date.now());
    this.writeApi.writePoint(point);
    this.writeApi
      .close()
      .then(() => console.log("Write success"))
      .catch((err) => console.error("Write error", err));
  }

  async queryData(params: { start: string; stop: string; machineId: string }) {
    const start = dayjs(params.start).toISOString();
    const stop = dayjs(params.stop).toISOString();

    let fluxQuery = `
    from(bucket: "soltempbucket")
      |> range(start: time(v: ${JSON.stringify(
        start
      )}), stop: time(v: ${JSON.stringify(stop)}))
      |> filter(fn: (r) => r["_measurement"] == "temperature")
      |> filter(fn: (r) => 
        r["_field"] == "command_id" or 
        r["_field"] == "temperature"
      )
  `;
    if (params.machineId) {
      fluxQuery += `|> filter(fn: (r) => r["machine_id"] == "${params.machineId}")`;
    }

    const dataMapObj: Record<string, any> = {};
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

    const result = Object.values(dataMapObj);
    const categories = result.map((item) =>
      new Date(item._time).toLocaleTimeString()
    );
    const temperatureData = result.map((item) => item.temperature);
    const options = {
      series: [
        {
          name: "Temperature",
          data: temperatureData,
        },
      ],
      xaxis: {
        categories: categories,
      },
      // chart: {
      //   height: 350,
      //   type: "line",
      //   zoom: {
      //     enabled: false,
      //   },
      // },
      // dataLabels: {
      //   enabled: false,
      // },
      // stroke: {
      //   curve: "straight",
      // },
      // title: {
      //   text: "Temperature Over Time",
      //   align: "left",
      // },
      // grid: {
      //   row: {
      //     colors: ["#f3f3f3", "transparent"],
      //     opacity: 0.5,
      //   },
      // },
    };
    return options;
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

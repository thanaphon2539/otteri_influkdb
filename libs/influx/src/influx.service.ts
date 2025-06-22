import { Injectable } from "@nestjs/common";
import { InfluxDB, Point } from "@influxdata/influxdb-client";
import axios from "axios";
import csv from "csvtojson";

@Injectable()
export class InfluxService {
  private influxDB: InfluxDB;
  private writeApi;
  private queryApi;

  private readonly org = "default"; // AWS InfluxDB default
  private readonly bucket = "your_bucket"; // แก้ตามที่คุณตั้งไว้
  private readonly url =
    "https://w6qdsoyzwc-gfwtkuqhkpqt2x.timestream-influxdb.ap-southeast-1.on.aws/api/v2/query?org=default";
  private readonly username = "soltempuser";
  private readonly password = "NdLYkUaYW0tendg4fH7o";

  constructor() {
    // InfluxDB Client รองรับ Basic Auth ผ่าน format นี้:
    const token = `${this.username}:${this.password}`;
    this.influxDB = new InfluxDB({
      url: this.url,
      token: "actual-token-from-console",
    });

    this.writeApi = this.influxDB.getWriteApi(this.org, this.bucket);
    this.queryApi = this.influxDB.getQueryApi(this.org);
  }

  writePoint() {
    const point = new Point("temperature")
      .tag("location", "office")
      .floatField("value", 30.2);

    this.writeApi.writePoint(point);
    this.writeApi
      .close()
      .then(() => console.log("Write success"))
      .catch((err) => console.error("Write error", err));
  }

  async queryData() {
    const fluxQuery = `
      from(bucket:"your_bucket")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "temperature")
    `;

    try {
      const response = await axios.post(this.url, fluxQuery, {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.username}:${this.password}`).toString("base64"),
          "Content-Type": "application/vnd.flux",
          Accept: "application/csv",
        },
        responseType: "text",
      });

      // แปลง CSV response เป็น JSON
      const jsonData = await csv().fromString(response.data);

      return jsonData;
    } catch (error) {
      console.error(
        "InfluxDB query error:",
        error.response?.data || error.message
      );
      throw error;
    }
  }
}

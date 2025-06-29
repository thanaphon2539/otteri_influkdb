import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  DeleteMessageBatchCommand,
} from "@aws-sdk/client-sqs";
import dayjs from "dayjs";
import Redis from "ioredis";
import crypto from "crypto";
import { ConfigService } from "@nestjs/config";
import { InfluxService } from "influx/influx/influx.service";

@Injectable()
export class SqsService implements OnModuleInit, OnModuleDestroy {
  private sqsClient: SQSClient;
  private queueUrl = process.env.SQS_PATH;
  private polling = false;
  private redis: Redis;
  constructor(
    private configService: ConfigService,
    private influxService: InfluxService
  ) {
    this.sqsClient = new SQSClient({
      region: "ap-southeast-1",
      credentials: {
        accessKeyId: this.configService.get("AWS_KEY"),
        secretAccessKey: this.configService.get("AWS_SECRET_KEY"),
      },
    });
  }

  async querySQSdataTotalAll() {
    const command = new GetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      AttributeNames: ["All"], // หรือระบุเฉพาะ attribute ที่ต้องการ
    });

    const result = await this.sqsClient.send(command);
    console.log(
      "Total Messages: ",
      result.Attributes?.ApproximateNumberOfMessages
    );
    console.log(
      "In-flight: ",
      result.Attributes?.ApproximateNumberOfMessagesNotVisible
    );
    console.log(
      "Delayed: ",
      result.Attributes?.ApproximateNumberOfMessagesDelayed
    );
  }

  // async receiveMessages() {
  //   const maxMessages = 10; // รับสูงสุด 10 ข้อความต่อครั้ง
  //   try {
  //     const command = new ReceiveMessageCommand({
  //       QueueUrl: this.queueUrl,
  //       MaxNumberOfMessages: maxMessages,
  //       WaitTimeSeconds: 5, // long polling 10 วินาที
  //       VisibilityTimeout: 3, // ซ่อนข้อความ 30 วินาที หลังรับ
  //       MessageAttributeNames: ["All"], // รับ attribute ด้วยถ้าต้องการ
  //     });

  //     const data = await this.sqsClient.send(command);
  //     // console.log("data >>>", JSON.stringify(data, null, 2));
  //     if (data.Messages && data.Messages.length > 0) {
  //       console.log(`Received ${data.Messages.length} messages.`);
  //       for (const message of data.Messages) {
  //         const body = JSON.parse(message.Body);
  //         for (const machines of body.machines) {
  //           await this.influxService.writePointFromJson({
  //             measurement: "temperature",
  //             tags: {
  //               machine_id:
  //                 machines["position"]?.[0]?.["detail"]?.[
  //                   "machine_id"
  //                 ]?.toString() || "",
  //             },
  //             fields: {
  //               temperature:
  //                 machines["position"]?.[0]?.["detail"]?.["temperature"],
  //               command_id:
  //                 machines["position"]?.[0]?.["detail"]?.["command_id"] || "",
  //             },
  //             timestamp: new Date(),
  //           });
  //         }
  //       }
  //       const deleteCommand = new DeleteMessageBatchCommand({
  //         QueueUrl: this.queueUrl,
  //         Entries: data.Messages.map((msg, index) => ({
  //           Id: index.toString(),
  //           ReceiptHandle: msg.ReceiptHandle!,
  //         })),
  //       });
  //       await this.sqsClient.send(deleteCommand);
  //       return data.Messages.map((el) => {
  //         const body = JSON.parse(el.Body);
  //         return {
  //           ...body,
  //           timestamp: dayjs(body["timestamp"] * 1000).toDate(),
  //           gw: {
  //             ...body["gw"],
  //             lastHeartbeat: dayjs(body["gw"]["lastHeartbeat"] * 1000).toDate(),
  //           },
  //         };
  //       });
  //     } else {
  //       console.log("No messages received.");
  //       return [];
  //     }
  //   } catch (error) {
  //     console.error("Error receiving messages:", error);
  //   }
  // }

  async receiveMessages() {
    const maxMessages = 10;
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: 5,
        VisibilityTimeout: 3,
        MessageAttributeNames: ["All"],
      });

      const data = await this.sqsClient.send(command);

      if (data.Messages && data.Messages.length > 0) {
        // console.log(`Received ${data.Messages.length} messages.`);
        const points = [];
        for (const message of data.Messages) {
          const body = JSON.parse(message.Body);
          for (const machines of body.machines || []) {
            const position = machines["position"]?.[0]?.["detail"];
            if (!position) continue;
            points.push({
              measurement: "temperature",
              tags: {
                machine_id: position["machine_id"]?.toString() || "",
              },
              fields: {
                temperature: position["temperature"],
                command_id: position["command_id"] || "",
              },
              timestamp: new Date(), // หรือแปลงจาก body.timestamp ถ้ามี
            });
          }
        }

        // Push ไปที่ buffer
        this.influxBuffer.push(...points);

        // ลบข้อความจาก SQS
        const deleteCommand = new DeleteMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: data.Messages.map((msg, index) => ({
            Id: index.toString(),
            ReceiptHandle: msg.ReceiptHandle!,
          })),
        });
        await this.sqsClient.send(deleteCommand);
      } else {
        console.log("No messages received.");
      }
    } catch (error) {
      console.error("Error receiving messages:", error);
    }
  }

  private influxBuffer: {
    measurement: string;
    tags: Record<string, string>;
    fields: Record<string, any>;
    timestamp: Date;
  }[] = [];

  private startInfluxBufferFlusher() {
    setInterval(async () => {
      if (this.influxBuffer.length === 0) return;
      // จำกัด batch size เช่น 1000 จุด/ครั้ง
      const batchSize = 1000;
      const batch = this.influxBuffer.splice(0, batchSize);
      try {
        console.time("influxWrite");
        await this.influxService.writeMany(batch);
        console.timeEnd("influxWrite");
      } catch (err) {
        console.error("Influx write failed, restoring buffer:", err);
        // กู้คืนกรณีเขียนพลาด
        this.influxBuffer.unshift(...batch);
      }
    }, 500); // flush ทุก 500ms
  }

  async runParallelConsumers() {
    const tasks = Array.from({ length: 30 }).map(() => this.receiveMessages());
    await Promise.allSettled(tasks);
  }

  // ฟังก์ชัน polling แบบวนลูปเรื่อย ๆ
  async startPolling() {
    this.polling = true;
    while (this.polling) {
      console.log("start :", dayjs().toDate());
      await this.runParallelConsumers();
      await this.querySQSdataTotalAll();
    }
  }

  stopPolling() {
    this.polling = false;
  }

  // เริ่ม polling เมื่อโมดูลเริ่มต้น
  async onModuleInit() {
    this.startPolling();
    this.startInfluxBufferFlusher();
  }

  // หยุด polling เมื่อโมดูลถูกปิด
  async onModuleDestroy() {
    //   this.stopPolling();
  }
}

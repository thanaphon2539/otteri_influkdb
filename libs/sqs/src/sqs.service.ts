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

  async receiveMessages() {
    const maxMessages = 10; // รับสูงสุด 10 ข้อความต่อครั้ง
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: 10, // long polling 10 วินาที
        VisibilityTimeout: 30, // ซ่อนข้อความ 30 วินาที หลังรับ
        MessageAttributeNames: ["All"], // รับ attribute ด้วยถ้าต้องการ
      });

      const data = await this.sqsClient.send(command);
      if (data.Messages && data.Messages.length > 0) {
        console.log(`Received ${data.Messages.length} messages.`);
        for (const message of data.Messages) {
          const body = JSON.parse(message.Body);
          for (const machines of body.machines) {
            await this.influxService.writePointFromJson({
              measurement: "temperature",
              tags: {
                machine_id:
                  machines["position"]?.[0]?.["detail"]?.[
                    "machine_id"
                  ]?.toString() || "",
              },
              fields: {
                temperature:
                  machines["position"]?.[0]?.["detail"]?.["temperature"],
                command_id:
                  machines["position"]?.[0]?.["detail"]?.["command_id"] || "",
              },
              timestamp: new Date(),
            });
          }
          // ตัวอย่างลบข้อความหลังประมวลผลเสร็จ
          // const deleteCommand = new DeleteMessageCommand({
          //   QueueUrl: queueUrl,
          //   ReceiptHandle: message.ReceiptHandle,
          // });
          // await this.sqsClient.send(deleteCommand);
        }
        return data.Messages.map((el) => {
          const body = JSON.parse(el.Body);
          return {
            ...body,
            timestamp: dayjs(body["timestamp"] * 1000).toDate(),
            gw: {
              ...body["gw"],
              lastHeartbeat: dayjs(body["gw"]["lastHeartbeat"] * 1000).toDate(),
            },
          };
        });
      } else {
        console.log("No messages received.");
        return [];
      }
    } catch (error) {
      console.error("Error receiving messages:", error);
    }
  }

  // ฟังก์ชัน polling แบบวนลูปเรื่อย ๆ
  async startPolling() {
    this.polling = true;

    while (this.polling) {
      console.log("start :", dayjs().toDate());
      await this.receiveMessages();
      // รอ 1 วินาที ก่อน poll รอบใหม่ (ลดโหลด)
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  stopPolling() {
    this.polling = false;
  }

  // เริ่ม polling เมื่อโมดูลเริ่มต้น
  async onModuleInit() {
    this.startPolling();
  }

  // หยุด polling เมื่อโมดูลถูกปิด
  async onModuleDestroy() {
    //   this.stopPolling();
  }
}

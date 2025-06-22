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

@Injectable()
export class SqsService implements OnModuleInit, OnModuleDestroy {
  private sqsClient: SQSClient;
  private queueUrl = process.env.SQS_PATH;
  private polling = false;
  private redis: Redis;
  constructor(private configService: ConfigService) {
    this.sqsClient = new SQSClient({
      region: "ap-southeast-1",
      credentials: {
        accessKeyId: this.configService.get("AWS_KEY"),
        secretAccessKey: this.configService.get("AWS_SECRET_KEY"),
      },
    });
    this.redis = new Redis({
      host: this.configService.get("REDIS_HOST"),
      port: Number(this.configService.get("REDIS_PORT")),
    });
  }

  async receiveAndDeleteMessages() {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10, // long polling 10 sec
        VisibilityTimeout: 30,
      });

      const data = await this.sqsClient.send(command);
      if (!data.Messages || data.Messages.length === 0) {
        // ไม่มีข้อความใหม่
        return;
      }

      for (const message of data.Messages) {
        if (!message.Body || !message.ReceiptHandle) continue;
        // console.log("Received message:", message.Body);
        const hash = this.generateMessageHash(message.Body);
        // เช็คข้อมูลตรงนี้
        if (await this.hasProcessed(hash)) {
          Logger.warn(`Skipped duplicate message: ${hash}`);
          continue;
        }

        try {
          const body = JSON.parse(message.Body);
          const processedData = {
            ...body,
            timestamp: dayjs(body.timestamp * 1000).toDate(),
          };
          Logger.log("Processing:", processedData);

          // ประมวลผลข้อมูลตรงนี้
          await this.markProcessed(hash);
          // ลบ message หลังจากประมวลผล
          if (message.ReceiptHandle) {
            //   console.log("message >>>", message);
            //   await this.deleteMessage(message.ReceiptHandle);
          }
          Logger.log(`Deleted message: ${hash}`);
        } catch (error) {
          Logger.error("Processing error:", error);
        }
      }
    } catch (error) {
      Logger.error("Polling error:", error);
    }
  }

  async deleteMessage(receiptHandle: string) {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });

    try {
      await this.sqsClient.send(command);
    } catch (err) {
      console.error("Error deleting message:", err);
    }
  }

  private generateMessageHash(body: string): string {
    return crypto.createHash("sha256").update(body).digest("hex");
  }

  async hasProcessed(hash: string): Promise<boolean> {
    const exists = await this.redis.exists(`sqs:processed:${hash}`);
    return exists === 1;
  }

  async markProcessed(hash: string): Promise<void> {
    await this.redis.set(`sqs:processed:${hash}`, "1", "EX", 3600); // expires in 1 hour
  }

  // ฟังก์ชัน polling แบบวนลูปเรื่อย ๆ
  async startPolling() {
    this.polling = true;

    while (this.polling) {
      console.log("start :", dayjs().toDate());
      await this.receiveAndDeleteMessages();
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

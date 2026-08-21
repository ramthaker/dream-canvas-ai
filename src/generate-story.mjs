import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { randomUUID } from "node:crypto";
import { bedtimeRules, isSafeStory, safeProfile } from "./safety.mjs";
const bedrock = new BedrockRuntimeClient({}),
  db = DynamoDBDocumentClient.from(new DynamoDBClient({})),
  s3 = new S3Client({}),
  ses = new SESClient({}),
  T = process.env.TABLE_NAME,
  B = process.env.BUCKET_NAME;
export async function handler(e = {}) {
  const p = safeProfile(
    e.profile ||
      (await db.send(new GetCommand({ TableName: T, Key: { id: "PROFILE" } })))
        .Item,
  );
  if (!p.email) throw Error("A parent email is required");
  const old =
    (
      await db.send(
        new QueryCommand({
          TableName: T,
          IndexName: "StoriesByDate",
          KeyConditionExpression: "kind = :k",
          ExpressionAttributeValues: { ":k": "STORY" },
          ScanIndexForward: false,
          Limit: 8,
        }),
      )
    ).Items || [];
  const prompt = `Create one original bedtime story for a ${p.age}-year-old child named ${p.childName}. Themes: ${p.themes}. Avoid these titles: ${old.map((x) => x.title).join(", ") || "none"}. ${bedtimeRules} Return JSON only with title, body, imagePrompt. Body 350-650 words.`;
  const r = await bedrock.send(
    new ConverseCommand({
      modelId: process.env.TEXT_MODEL_ID || "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0.8, maxTokens: 1800 },
    }),
  );
  const text = r.output.message.content
    .map((x) => x.text || "")
    .join("")
    .replace(/^```json\s*|\s*```$/g, "")
    .trim();
  const story = JSON.parse(text);
  if (!isSafeStory(story)) throw Error("Story failed safety validation");
  const id = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}`;
  const image = await bedrock.send(
    new InvokeModelCommand({
      modelId: process.env.IMAGE_MODEL_ID || "amazon.nova-canvas-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(
        JSON.stringify({
          taskType: "TEXT_IMAGE",
          textToImageParams: {
            text: `${story.imagePrompt}. Gentle watercolor children's book illustration, no text.`,
          },
          imageGenerationConfig: {
            width: 1024,
            height: 1024,
            numberOfImages: 1,
          },
        }),
      ),
    }),
  );
  const bytes = Buffer.from(
      JSON.parse(new TextDecoder().decode(image.body)).images[0],
      "base64",
    ),
    key = `stories/${id}.png`;
  await s3.send(
    new PutObjectCommand({
      Bucket: B,
      Key: key,
      Body: bytes,
      ContentType: "image/png",
    }),
  );
  const item = {
    id,
    kind: "STORY",
    title: story.title,
    body: story.body,
    imageKey: key,
    createdAt: new Date().toISOString(),
    generatedBy: e.source || "EventBridge Scheduler",
  };
  await db.send(
    new PutCommand({
      TableName: T,
      Item: item,
      ConditionExpression: "attribute_not_exists(id)",
    }),
  );
  await ses.send(
    new SendEmailCommand({
      Source: process.env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [p.email] },
      Message: {
        Subject: { Data: `DreamCanvas: ${item.title}` },
        Body: { Text: { Data: `${item.title}\n\n${item.body}` } },
      },
    }),
  );
  return item;
}

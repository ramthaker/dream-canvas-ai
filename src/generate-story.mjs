import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { randomUUID } from "node:crypto";
import { bedtimeRules, isSafeStory, safeProfile } from "./safety.mjs";

const bedrock = new BedrockRuntimeClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME;
const BUCKET = process.env.BUCKET_NAME;

export async function handler(event = {}) {
  const stored = event.profile || (await db.send(new GetCommand({ TableName: TABLE, Key: { id: "PROFILE" } }))).Item || {};
  const profile = safeProfile(stored);
  if (!profile.email) throw Error("A parent email is required");
  if (event.source === "EventBridge Scheduler" && !isBedtimeNow(profile)) return { skipped: true, reason: "Waiting for selected bedtime" };

  const recent = (await db.send(new QueryCommand({ TableName: TABLE, IndexName: "StoriesByDate", KeyConditionExpression: "kind = :k", ExpressionAttributeValues: { ":k": "STORY" }, ScanIndexForward: false, Limit: 8 }))).Items || [];
  const prompt = `Create one original bedtime story for a ${profile.age}-year-old child named ${profile.childName}. Themes: ${profile.themes}. Avoid these recent titles: ${recent.map((x) => x.title).join(", ") || "none"}. ${bedtimeRules} Return JSON only with title, body, and imagePrompt. Body 350-650 words.`;
  const response = await bedrock.send(new ConverseCommand({ modelId: process.env.TEXT_MODEL_ID || "us.amazon.nova-2-lite-v1:0", messages: [{ role: "user", content: [{ text: prompt }] }], inferenceConfig: { temperature: 0.8, maxTokens: 1800 } }));
  const text = response.output.message.content.map((x) => x.text || "").join("").replace(/^```json\s*|\s*```$/g, "").trim();
  const story = JSON.parse(text);
  if (!isSafeStory(story)) throw Error("Story failed safety validation");

  const id = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}`;
  const image = await createIllustration(story.imagePrompt);
  const key = `stories/${id}.${image.extension}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: image.bytes, ContentType: image.contentType }));
  const item = { id, kind: "STORY", title: story.title, body: story.body, imageKey: key, createdAt: new Date().toISOString(), generatedBy: event.source || "EventBridge Scheduler" };
  await db.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(id)" }));
  await ses.send(new SendEmailCommand({ Source: process.env.SES_FROM_EMAIL, Destination: { ToAddresses: [profile.email] }, Message: { Subject: { Data: `DreamCanvas: ${item.title}` }, Body: { Text: { Data: `${item.title}\n\n${item.body}` } } } }));
  return item;
}

function isBedtimeNow(profile) {
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: profile.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return current === profile.bedtime;
}

async function createIllustration(prompt) {
  try {
    const response = await bedrock.send(new InvokeModelCommand({ modelId: process.env.IMAGE_MODEL_ID || "amazon.nova-canvas-v1:0", contentType: "application/json", accept: "application/json", body: new TextEncoder().encode(JSON.stringify({ taskType: "TEXT_IMAGE", textToImageParams: { text: `${prompt}. Gentle watercolor children's book illustration, no text.` }, imageGenerationConfig: { width: 1024, height: 1024, numberOfImages: 1 } })) }));
    return { bytes: Buffer.from(JSON.parse(new TextDecoder().decode(response.body)).images[0], "base64"), contentType: "image/png", extension: "png" };
  } catch (error) {
    console.warn("Image model unavailable; using a generated bedtime card", error);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#1f2344"/><circle cx="760" cy="230" r="120" fill="#f4d58d"/><circle cx="715" cy="205" r="120" fill="#1f2344"/><path d="M120 760 Q300 620 480 760 T840 760" fill="none" stroke="#e5bd73" stroke-width="26"/><text x="512" y="900" fill="#f8f3e8" text-anchor="middle" font-family="Georgia" font-size="34">A gentle story awaits</text></svg>`;
    return { bytes: Buffer.from(svg), contentType: "image/svg+xml", extension: "svg" };
  }
}
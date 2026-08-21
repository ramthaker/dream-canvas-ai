import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { safeProfile } from "./safety.mjs";
import { handler as generateStory } from "./generate-story.mjs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const db = DynamoDBDocumentClient.from(new DynamoDBClient({})),
  s3 = new S3Client({}),
  TABLE = process.env.TABLE_NAME;
const out = (s, b) => ({
  statusCode: s,
  headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(b),
});
export async function handler(e) {
  try {
    const method = e.requestContext?.http?.method || e.httpMethod || "GET";
    const path = e.rawPath || e.path || "";
    if (method === "POST" && path.endsWith("/generate")) {
      return out(200, {
        story: await generateStory({ source: "manual-test" }),
      });
    }
    if (method === "POST") {
      const p = safeProfile(JSON.parse(e.body || "{}"));
      if (!p.email) return out(400, { error: "A parent email is required." });
      await db.send(
        new PutCommand({
          TableName: TABLE,
          Item: { id: "PROFILE", kind: "PROFILE", ...p },
        }),
      );
      return out(200, { profile: p });
    }
    if ((e.rawPath || e.path || "").endsWith("/profile")) {
      return out(
        200,
        (
          await db.send(
            new GetCommand({ TableName: TABLE, Key: { id: "PROFILE" } }),
          )
        ).Item || {},
      );
    }
    const r = await db.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "StoriesByDate",
        KeyConditionExpression: "kind = :k",
        ExpressionAttributeValues: { ":k": "STORY" },
        ScanIndexForward: false,
        Limit: 30,
      }),
    );
    const stories = await Promise.all(
      (r.Items || []).map(async (x) => ({
        ...x,
        imageUrl: x.imageKey
          ? await getSignedUrl(
              s3,
              new GetObjectCommand({
                Bucket: process.env.BUCKET_NAME,
                Key: x.imageKey,
              }),
              { expiresIn: 3600 },
            )
          : null,
      })),
    );
    return out(200, { stories });
  } catch (err) {
    console.error(err);
    return out(500, { error: "DreamCanvas could not complete that request." });
  }
}

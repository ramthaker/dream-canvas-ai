import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, BundlingFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws_scheduler";

export class DreamCanvasStack extends cdk.Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);
    const table = new dynamodb.Table(this, "StoriesTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: "StoriesByDate",
      partitionKey: { name: "kind", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    const images = new s3.Bucket(this, "StoryImages", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: ["*"] }],
    });
    const common = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: images.bucketName,
      SES_FROM_EMAIL: new cdk.CfnParameter(this, "SesFromEmail", {
        type: "String",
        description: "Verified SES sender address",
      }).valueAsString,
      APP_URL: new cdk.CfnParameter(this, "AppUrl", {
        type: "String",
        default: "http://localhost:3000",
      }).valueAsString,
      TEXT_MODEL_ID: "amazon.nova-lite-v1:0",
      IMAGE_MODEL_ID: "amazon.nova-canvas-v1:0",
    };
    const apiFn = new NodejsFunction(this, "ApiFunction", {
      entry: "src/api.mjs",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      environment: common,
      bundling: { format: BundlingFormat.ESM, minify: true },
    });
    const storyFn = new NodejsFunction(this, "StoryFunction", {
      entry: "src/generate-story.mjs",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: common,
      bundling: { format: BundlingFormat.ESM, minify: true },
    });
    table.grantReadWriteData(apiFn);
    table.grantReadWriteData(storyFn);
    images.grantRead(apiFn);
    images.grantReadWrite(storyFn);
    for (const fn of [apiFn, storyFn])
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: ["*"],
        }),
      );
    storyFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }),
    );
    const api = new apigwv2.HttpApi(this, "DreamCanvasApi", {
      corsPreflight: {
        allowHeaders: ["content-type"],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: ["*"],
      },
    });
    api.addRoutes({
      path: "/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration(
        "ApiIntegration",
        apiFn,
      ),
    });
    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [storyFn.functionArn],
      }),
    );
    new scheduler.CfnSchedule(this, "BedtimeSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "cron(0 20 * * ? *)",
      scheduleExpressionTimezone: "Europe/Stockholm",
      target: {
        arn: storyFn.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ source: "EventBridge Scheduler" }),
      },
    });
    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new cdk.CfnOutput(this, "StoriesTableName", { value: table.tableName });
    new cdk.CfnOutput(this, "StoryImagesBucketName", {
      value: images.bucketName,
    });
  }
}

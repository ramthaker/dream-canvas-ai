#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DreamCanvasStack } from "../lib/dreamcanvas-stack.js";
const app = new cdk.App();
new DreamCanvasStack(app, "DreamCanvasStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "eu-north-1",
  },
  description: "DreamCanvas autonomous illustrated bedtime story agent",
});

# DreamCanvas

DreamCanvas is an always-on illustrated bedtime-story agent for families. Every evening at 20:00 Europe/Stockholm, Amazon EventBridge Scheduler wakes an AWS Lambda function. The function uses Amazon Bedrock to create a short, safe story and a matching illustration, stores the story in DynamoDB and the image in private S3, then sends the parent an email through Amazon SES. The web reader displays the latest and previous stories using presigned image URLs.

## Architecture

`EventBridge Scheduler -> Story Lambda -> Bedrock -> DynamoDB + S3 -> SES`

`Web app -> API Gateway HTTP API -> API Lambda -> DynamoDB + presigned S3 URLs`

The backend is provisioned with AWS CDK in `cdk/`. The static frontend in `public/` can be hosted with AWS Amplify Hosting.

## Deploy with CDK

Prerequisites: Node.js 22+, AWS CLI credentials, AWS CDK, and verified SES sender/recipient addresses if the account is in SES sandbox mode.

```powershell
npm install
npx cdk bootstrap
npx cdk synth
npx cdk deploy --parameters SesFromEmail=verified-sender@example.com --parameters AppUrl=https://your-amplify-domain.example.com
```

Enable the Amazon Nova Lite and Nova Canvas Bedrock models in the deployment region before the first scheduled run. The default region is `eu-north-1`; set `CDK_DEFAULT_REGION` to change it. Deployments for this project use the `pulse-personal` AWS profile.

After deployment, copy the `ApiUrl` output into `public/app.js` as `window.DREAMCANVAS_API`, then deploy `public/` through Amplify Hosting. Invoke the story Lambda manually only for a demonstration; the production behavior is the scheduled 20:00 trigger.

## Local checks

```powershell
npm run check
npm test
npx cdk synth
```

The safety tests cover profile normalization and rejection of unsafe story content. AWS integration tests require a deployed stack and verified SES/Bedrock access.

## Safety and privacy

Generation prompts require age-appropriate, calm stories with positive endings. Outputs are rejected if they fail basic safety validation. The first version stores one parent profile and one child profile; use a private AWS account and review IAM and retention settings before sharing publicly.
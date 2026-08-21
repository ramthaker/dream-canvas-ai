# DreamCanvas

DreamCanvas is an always-on illustrated bedtime-story agent. At 20:00 Europe/Stockholm, EventBridge Scheduler wakes Lambda, Amazon Bedrock creates a safe story and matching illustration, DynamoDB and S3 store them, and SES emails the parent.

## Deploy

```powershell
npm install
sam build --template-file infra/template.yaml
sam deploy --guided
```

Verify the SES sender and recipient in SES, enable the Bedrock Nova models in the region, host `public/` with Amplify, and set the API URL in `public/app.js`. Run `npm run check` for syntax validation. Invoke the story Lambda manually only for testing; the production path is the scheduled EventBridge trigger.
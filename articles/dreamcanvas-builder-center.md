# Weekend Creative Agent Challenge: DreamCanvas

## Vision and what it does

DreamCanvas is an always-on bedtime-story agent for families. Every evening it prepares a fresh short story and matching illustration for a child, then sends the parent an email before bedtime. The parent chooses the child profile, favorite themes, bedtime, and time zone. The default bedtime is 8:00 PM Europe/Stockholm, but the family can select another time in 15-minute increments.

The web reader keeps today’s story and previous stories available. A parent can also choose “Send a test story now” to demonstrate the experience immediately without waiting for the scheduled event. This manual action uses the same profile, Bedrock generation, safety checks, S3 storage, DynamoDB history, and SES email flow as the automated path.

## How it was built

The project uses a serverless design so the story does not depend on a browser being open. The setup page saves one child profile with age, first name, themes, email address, bedtime, and time zone. The generation prompt uses that profile and recent story titles to reduce repetition. It asks for a calm, age-appropriate story with a positive ending and a child-friendly illustration prompt.

Generated output passes a basic safety validator before it is stored or emailed. The image is private in Amazon S3 and the reader receives a temporary signed URL. This keeps the content protected while still allowing the browser to display it.

A key design decision was separating the scheduled path from the manual test path. EventBridge invokes the worker every 15 minutes. The worker checks the selected local time and generates only when the current time matches the saved bedtime. The test action bypasses that time check and is intended for setup, demos, and verification.

## AWS services and architecture

AWS CDK provisions the application. An EventBridge scheduled rule invokes the story Lambda every 15 minutes. The Lambda checks the profile time, calls Amazon Bedrock for text and image generation, stores story records in Amazon DynamoDB, stores illustrations in Amazon S3, and sends the parent email with Amazon SES.

The static frontend is hosted by AWS Amplify Hosting. It calls an Amazon API Gateway HTTP API connected to a second Lambda. The API saves the profile, lists stories, creates presigned S3 image URLs, and exposes the manual test endpoint. IAM grants are separated between the API and story functions.

## What I learned

The most important lesson was that an agent needs an operating rhythm, not only a prompt. Scheduling, local-time handling, persistence, safety checks, email delivery, retries, and a visible reader all matter. I also learned that a manual test path makes an autonomous system easier to trust: a parent can verify the complete experience now and still rely on the scheduled bedtime behavior later. DreamCanvas turns a cloud workflow into a small dependable family ritual.

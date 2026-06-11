# Webhooks

- Source ID: strapi-004
- URL: https://docs.strapi.io/cms/backend-customization/webhooks
- Topic: webhooks
- Version: Strapi 5

## Content

> Page summary:
> Webhooks let Strapi notify external systems when content changes, while omitting the Users type for privacy. Configuration in `config/server` sets default headers and endpoints to trigger third-party processing.

Webhook is a construct used by an application to notify other applications that an event occurred. More precisely, webhook is a user-defined HTTP callback.

Using a webhook is a good way to tell third-party providers to start some processing (CI, build, deployment ...).

The way a webhook works is by delivering information to a receiving application through HTTP requests (typically POST requests).

## User content-type webhooks

To prevent from unintentionally sending any user's information to other applications, Webhooks will not work for the User content-type.

If you need to notify other applications about changes in the Users collection, you can do so by creating Lifecycle hooks.

## Available configurations

You can set webhook configurations inside the file `./config/server`.

`webhooks.defaultHeaders` lets you set default headers to use for your webhook requests.

## Webhooks security

Most of the time, webhooks make requests to public URLs, therefore it is possible that someone may find that URL and send it wrong information.

To prevent this from happening you can send a header with an authentication token.

Another way is to define `defaultHeaders` to add to every webhook request.

It is also recommended to sign webhook payloads and verify signatures server-side to prevent tampering and replay attacks.

## Available events

By default Strapi webhooks can be triggered by the following events:

- `entry.create`
- `entry.update`
- `entry.delete`
- `entry.publish`
- `entry.unpublish`
- `media.create`
- `media.update`
- `media.delete`
- `review-workflows.updateEntryStage`
- `releases.publish`

`entry.publish` and `entry.unpublish` are only available when `draftAndPublish` is enabled on the content type.

## Payloads

Private fields are not sent in the payload.

When a payload is delivered to your webhook's URL, it will contain the `X-Strapi-Event` header to indicate the event type that was triggered.

## Best practices for webhook handling

- Validate incoming requests by checking headers and payload signatures.
- Implement retries for failed webhook requests to handle transient errors.
- Log webhook events for debugging and monitoring.
- Use secure, HTTPS endpoints for receiving webhooks.
- Set up rate limiting to avoid being overwhelmed by multiple webhook requests. 

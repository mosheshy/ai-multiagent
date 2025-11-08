// app/services/AwsClient.js (ESM)
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";

/**
 * AWSClient - encapsulates BedrockRuntimeClient creation and configuration.
 * Uses the AWS SDK v3 default credential provider chain:
 * ENV → SSO/Shared Config (~/.aws) → WebIdentity → ECS/EC2 IMDS.
 */
export class AwsClient {
  /**
   * Creates a new AWSClient instance.
   * @param {string} [region] - AWS region, defaults to "us-east-1".
   * @param {string} [profile] - Optional AWS profile hint.
   */
  constructor(region, profile) {
    // Explicit region is strongly recommended to avoid provider fallback errors
    this.region =
      region ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1";

    // Optional: hint to prefer a specific profile, still respects SSO/ENV
    this.profile = profile || process.env.AWS_PROFILE;

    // Create the Bedrock client instance
    this.client = new BedrockRuntimeClient({
      region: this.region,
      credentials: defaultProvider({ profile: this.profile }),
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 3_000,
        socketTimeout: 30_000,
      }),
      maxAttempts: Number(process.env.AWS_MAX_ATTEMPTS ?? 3),
    });
  }

  /**
   * Returns the initialized Bedrock client.
   * Use this method to access the configured BedrockRuntimeClient instance.
   */
  getClient() {
    return this.client;
  }

  /**
   * Example helper method to invoke a model.
   * @param {string} modelId - The Bedrock model ID.
   * @param {object} payload - The JSON payload to send.
   */
  async invokeModel(modelId, payload) {
    const command = {
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: Buffer.from(JSON.stringify(payload)),
    };

    try {
      const response = await this.client.send(command);
      const result = Buffer.from(response.body).toString("utf8");
      return JSON.parse(result);
    } catch (error) {
      console.error("Bedrock invocation failed:", {
        name: error.name,
        message: error.message,
        cause: error.cause?.message || error.cause,
        metadata: error.$metadata,
      });
      throw error;
    }
  }
}

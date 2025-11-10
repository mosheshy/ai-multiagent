// app/services/modelRegistry.js
// Lists available Bedrock foundation models so we can validate model IDs before use.
// Requires control-plane Bedrock client (@aws-sdk/client-bedrock), distinct from runtime.
import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

export async function listAvailableModels(region = process.env.AWS_REGION || 'us-east-1') {
  const client = new BedrockClient({ region, credentials: defaultProvider() });
  const cmd = new ListFoundationModelsCommand({});
  const resp = await client.send(cmd);
  const models = (resp?.modelSummaries || []).map(m => ({
    modelId: m.modelId,
    providerName: m.providerName,
    inputModalities: m.inputModalities,
    outputModalities: m.outputModalities,
    inferenceTypes: m.inferenceTypes,
    customizationsSupported: m.customizationsSupported,
    responseStreamingSupported: m.responseStreamingSupported,
  }));
  return { region, count: models.length, models };
}

export async function findModel(modelId, region) {
  const all = await listAvailableModels(region);
  const match = all.models.find(m => m.modelId === modelId);
  return { found: Boolean(match), model: match || null, region: all.region };
}

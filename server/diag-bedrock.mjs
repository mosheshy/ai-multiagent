import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

(async () => {
  try {
    // Load server/.env specifically to mirror server startup behavior
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const envPath = path.resolve(__dirname, './.env');
    dotenv.config({ path: envPath });

    // dynamic import to respect ESM in your project
    const mod = await import('./app/services/bedrockClient.js');
    console.log('bedrock module exports:', Object.keys(mod));
    const BedrockLLM = mod.BedrockLLM || mod.default?.BedrockLLM || mod.default;
    console.log('BedrockLLM value type:', typeof BedrockLLM);
    const region = process.env.AWS_REGION || 'us-east-1';
    const modelId = process.env.BEDROCK_MODEL_CLASSIFY || process.env.BEDROCK_MODEL_GENERAL || 'anthropic.claude-3-5-haiku-20241022-v1:0';
    const ctrl = typeof BedrockLLM === 'function' ? new BedrockLLM({ modelId, region }) : null;
    console.log(`Calling BedrockLLM.ask for modelId=${modelId} region=${region}...`);
    if (!ctrl) throw new Error('BedrockLLM is not available as a constructor');
    await ctrl.ask({ systemPrompt: '', userPrompt: 'diagnostic test' });
    console.log('Call succeeded.');
  } catch (e) {
    console.error('=== DIAGNOSTIC ERROR ===');
    console.error('name:', e?.name);
    console.error('message:', e?.message);
    console.error('stack:', e?.stack);
    if (e?.$fault) console.error('fault:', e.$fault);
    if (e?.$metadata) console.error('metadata:', JSON.stringify(e.$metadata));
    process.exitCode = 1;
  }
})();

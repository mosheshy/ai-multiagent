import { defaultProvider } from "@aws-sdk/credential-provider-node";

(async () => {
  try {
    const provider = defaultProvider();
    const creds = await provider();
    console.log("Resolved credentials:");
    console.log("  accessKeyId:", creds.accessKeyId ? "<present>" : "<missing>");
    console.log("  has session token:", !!creds.sessionToken);
  } catch (e) {
    console.error("Failed to resolve credentials:", e.message || e);
    process.exit(2);
  }
})();
# AI Multi-Agent System

## Overview

The **AI Multi-Agent System** is a modular framework designed to orchestrate multiple AI agents that interact through a unified runtime layer built on **Amazon Bedrock**. Each agent specializes in a different domain (e.g., finance, code generation, generic reasoning) and can operate both independently and cooperatively, depending on user input and routing logic.

This project demonstrates how to integrate **Bedrock Agents** and **foundation models** (Anthropic Claude, Mistral, etc.) within a Node.js application using modern async streaming patterns and structured prompts.

---

## Architecture

### Components

- **routerAgent.js** — Central dispatcher that routes user messages to the appropriate specialized agent based on context or intent.
- **agentRuntime.js** — Common runtime wrapper for invoking Bedrock Agents or models, supporting both single-response and streaming modes.
- **financeAgent.js** — Provides structured financial analyses, simulations, and risk/fee breakdowns. Educational, not advisory.
- **codeAgent.js** — Offers coding help, debugging assistance, and test generation with structured output.
- **genericAgent.js** — Handles general-purpose reasoning, concise summaries, and fallback logic.
- **bedrockClient.js** — Initializes and manages Bedrock model calls via the AWS SDK.

Each agent follows a consistent **"Agent-first, Model-fallback"** pattern:

1. Try invoking the Bedrock Agent (if `AGENT_ID` + `ALIAS_ID` exist).
2. Fall back to direct model invocation through `BedrockLLM`.

---

## Features

- **Unified streaming** via Server-Sent Events (SSE) for low-latency responses.
- **Multi-domain agent routing** through context analysis.
- **Bedrock integration** with Anthropic Claude and Mistral models.
- **Fallback resilience** — automatically switches from an unavailable Agent to a direct model call.
- **Modular design** — easily extendable to new agent types (e.g., research, education, marketing).
- **Environment-driven configuration** with `.env` variables for region, models, and agent IDs.

---

## Installation

### Prerequisites

- Node.js 18+
- AWS account with Bedrock access
- Configured IAM user/role with `bedrock:InvokeModel` and `bedrock:InvokeAgent` permissions

### Setup

```bash
# Clone repository
git clone https://github.com/your-username/ai-multiagent.git
cd ai-multiagent

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
```

Update `.env` with your AWS credentials and model identifiers:

```bash
AWS_REGION=us-east-1
BEDROCK_MODEL_FINANCE=anthropic.claude-3-5-sonnet-20241022-v2:0
BEDROCK_MODEL_CODE=mistral.mistral-large-2402-v1:0
BEDROCK_MODEL_GENERAL=anthropic.claude-3-haiku-20240307-v1:0
BEDROCK_FINANCE_AGENT_ID=OKMZMDX4SD
BEDROCK_FINANCE_AGENT_ALIAS_ID=XXXXXXXXXX
```

---

## Usage

### Run locally

```bash
npm run dev
```

### Example request (server endpoint)

```bash
POST /api/ask
{
  "agent": "finance",
  "text": "What are the tax implications of converting USD to ILS?"
}
```

### Example response structure

```
1) Summary
2) Analysis
3) Checklist
4) Conclusion
```

---

## Project Goals

- Demonstrate scalable, modular agent design.
- Simplify Bedrock Agent orchestration with reusable runtime logic.
- Provide real-world educational examples for AWS AI integration.

---

## Roadmap

-

---

## License

MIT License — open for educational and research use.

---

## Author

Developed by **Moshe** —student for  MSc in Software Engineering (AI).


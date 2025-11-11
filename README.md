# AI Multi‑Agent System

A production‑ready, modular framework for orchestrating multiple AI agents on **Amazon Bedrock** with a clean **Agent‑first → Model‑fallback** design, unified streaming, and environment‑driven configuration.

---

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Directory Layout](#directory-layout)
- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Running & Usage](#running--usage)
- [API](#api)
- [Troubleshooting](#troubleshooting)
- [Security & IAM](#security--iam)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview
This project shows how to combine **Bedrock Agents** with direct **foundation model** calls (Anthropic Claude, Mistral, etc.) in a **Node.js** service. Each agent specializes in a domain (finance, coding, general reasoning) and can respond either via a Bedrock Agent or by falling back to a model if the Agent is unavailable.

**Core principle:**
> Try Bedrock **Agent** (if `AGENT_ID` + `ALIAS_ID` are set) → otherwise call the configured **Model** via `BedrockLLM`.

---

## Architecture

**Key components**
- `routerAgent.js` — Intent classification and routing to the right agent (code/finance/general). Handles **streaming** with SSE‑friendly chunks.
- `agentRuntime.js` — Thin Bedrock Agent Runtime wrapper (text + streaming invocations).
- `financeAgent.js` — Educational financial analysis. Structured output: Summary → Analysis → Checklist → Conclusion.
- `codeAgent.js` — Coding & debugging helper. Structured output: Plan → Code → Tests → Notes.
- `genericAgent.js` — General purpose reasoning and summarization.
- `services/bedrockClient.js` — Light client for model calls (ask / askStream).
- `utils/logger.js` — Minimal JSON‑like logging (timestamps + scope).

**Flow (high‑level)**
1. `routerAgent` classifies the intent (Agent‑first → model fallback).
2. Streams deltas back to the client using a tolerant parser that accepts **partial JSON** chunks.
3. Agents implement the same streaming contract, so routing is trivial.

---

## Directory Layout
```
app/
  agents/
    agentRuntime.js
    routerAgent.js
    financeAgent.js
    codeAgent.js
    genericAgent.js
  services/
    bedrockClient.js
    tools.finance.js
    tools.js
  utils/
    logger.js
server.js (or index.js)
.env(.example)
```

---

## Features
- **Agent‑first → Model‑fallback** pattern for resilience.
- **Unified streaming** via SSE; tolerant parser for partial JSON chunks.
- **Modular agents** with consistent response structures.
- **Environment‑driven configuration** (per‑agent models, temps, tokens, IDs).
- **Clean logs** for classification, routing, and streaming diagnostics.

---

## Quick Start

### Prerequisites
- Node.js **18+**
- AWS account with **Bedrock** enabled
- IAM principal (user/role) with `bedrock:InvokeAgent` and `bedrock:InvokeModel*`

### Install
```bash
git clone https://github.com/your-username/ai-multiagent.git
cd ai-multiagent
npm install
cp .env.example .env
```

---

## Configuration
Set these in `.env`. Values shown are **examples**:

```bash
# ===== App =====
PORT=8000
JWT_SECRET=replace-me
FRONTEND_ORIGIN=http://localhost:3000

# ===== AWS =====
AWS_REGION=us-east-1
# Prefer *either* AWS_PROFILE or access keys — never both
# AWS_PROFILE=bedrock-dev-admin
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...

# ===== Classifier (intent) =====
BEDROCK_CLASSIFY_AGENT_ID=
BEDROCK_CLASSIFY_ALIAS_ID=
BEDROCK_MODEL_CLASSIFY=anthropic.claude-3-haiku-20240307-v1:0

# ===== Models (fallbacks) =====
BEDROCK_MODEL_GENERAL=anthropic.claude-3-5-sonnet-20241022-v2:0
BEDROCK_MODEL_CODE=mistral.mistral-large-2407
BEDROCK_MODEL_FINANCE=anthropic.claude-3-5-sonnet-20241022-v2:0

# ===== Finance Agent (optional Bedrock Agent IDs) =====
BEDROCK_FINANCE_AGENT_ID=
BEDROCK_FINANCE_AGENT_ALIAS_ID=
FIN_TEMP=0.3
FIN_MAX_TOKENS=900

# ===== Code Agent (optional Bedrock Agent IDs) =====
BEDROCK_CODE_AGENT_ID=
BEDROCK_CODE_AGENT_ALIAS_ID=
CODE_TEMP=0.2
CODE_MAX_TOKENS=1200

# ===== General Agent (optional Bedrock Agent IDs) =====
BEDROCK_GENERAL_AGENT_ID=
BEDROCK_GENERAL_AGENT_ALIAS_ID=
GENERAL_TEMP=0.7
GENERAL_MAX_TOKENS=800

# ===== Persistence (optional) =====
MONGODB_URI=mongodb://localhost:27017/ai_agents_app
```

**Notes**
- Keep **only one** credential source active (either `AWS_PROFILE` **or** access keys) to avoid SDK warnings and ambiguous identity.
- Ensure **regions** match between your Agents and runtime calls.

---

## Running & Usage

### Start the server
```bash
npm run dev
# or
node server.js
```

### Example (non‑streaming)
```bash
POST /api/ask
{
  "agent": "finance",
  "text": "What are the tax implications of converting USD to ILS?"
}
```

### Example (streaming)
```bash
GET /api/stream?q=Write%20a%20binary%20search%20in%20JavaScript.
Authorization: Bearer <token>
```
The server emits:
```json
{ "type": "intent", "intent": "code", "agentName": "Code Agent" }
{ "type": "delta",  "intent": "code", "delta": "...partial text..." }
{ "type": "done",   "intent": "code" }
```

---

## API

### `POST /api/ask`
- **Body**: `{ agent?: "code"|"finance"|"general", text: string }`
- If `agent` is omitted, the router classifies intent automatically.

### `GET /api/stream`
- **Query**: `q=<text>`
- **Auth**: Optional JWT (if your app enforces it).
- **Returns**: SSE stream with `intent`, `delta`, and `done` events.

---

## Troubleshooting

**AccessDenied when invoking Agent**
- Your principal lacks `bedrock:InvokeAgent` (or wrong region). Attach policy to the **calling identity** (not the Agent’s service role).

**Warning: Multiple credential sources detected**
- Unset either `AWS_PROFILE` **or** `AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY`. Keep one.

**`Unexpected end of JSON input` during streaming**
- The router now buffers partial JSON and only parses when a full object is present. If you customize, ensure your stream parser:
  - Maintains a small buffer `jsonBuf`.
  - Parses only when buffer contains complete JSON (`try/catch`).
  - Falls back to plain‑text passthrough for non‑JSON chunks.

**Model/Agent ID not found**
- Verify model IDs (e.g., `anthropic.claude-3-5-sonnet-20241022-v2:0`) and availability in your region.

---

## Security & IAM
Attach a policy **to the principal that runs the server** (user/role). Example (tighten ARNs to your region/accounts):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:InvokeAgent"
      ],
      "Resource": "*"
    }
  ]
}
```
Consider restricting `Resource` to specific model and agent ARNs once IDs are stable.

---

## Roadmap
- [ ] Persistent memory (per user / session)
- [ ] Tool integrations (linters, finance feeds)
- [ ] Web dashboard for live sessions
- [ ] Fine‑grained RBAC & audit logs

---

## License
MIT — for educational and research use.

---

**Author**
Built by **Moshe** — MSc (Software Engineering, AI).


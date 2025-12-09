
# Ungraded Lab: **AI PR Review Summary in GitHub CI (LangChain JS + Cohere)**

## What you’ll build

A brand-new repo where opening a Pull Request triggers CI to:

1. run a tiny test, and
2. generate an **AI PR review summary** (What changed / Risks / Test plan) and show it in the **GitHub Actions run Summary** via `GITHUB_STEP_SUMMARY`. ([The GitHub Blog][2])

## Part 0 — Create a new repo

1. On GitHub, create a new repository named `ai-ci-langchain-lab`.
2. Select **Public** (simplest for Actions).
3. Check **Add a README**.
4. Click **Create repository**.

## Part 1 — Add a tiny Node project (copy/paste exactly)

Create these folders in the repo:

* `src/`
* `tests/`
* `scripts/`
* `.github/workflows/`

Initialize a new Node project:

```bash
npm init -y
```

Then create these files with the exact content below.

### 1) `package.json`

Set your `package.json` with this exact content:

```json
{
  "name": "ai-ci-langchain-lab",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "ai:summary": "node scripts/ai_pr_summary.mjs"
  },
  "dependencies": {
    "@langchain/cohere": "latest",
    "@langchain/core": "latest",
    "zod": "latest"
  }
}
```

### 2) `src/calculator.js`

```js
export function add(a, b) {
  return a + b;
}
```

### 3) `tests/calculator.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/calculator.js";

test("add adds two numbers", () => {
  assert.equal(add(2, 3), 5);
});
```

### 4) `scripts/ai_pr_summary.mjs`

```js
import "dotenv/config";
import { execSync } from "node:child_process";
import { z } from "zod";
import { ChatCohere } from "@langchain/cohere";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import fs from "node:fs";

function gitDiff(baseSha, headSha) {
  const diff = execSync(`git diff ${baseSha}...${headSha}`, { encoding: "utf-8" });
  // Keep it small so it works reliably on free/trial limits.
  return diff.length > 8000 ? diff.slice(0, 8000) : diff;
}

async function postPrComment(markdown) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  const prNumber = process.env.PR_NUMBER;

  if (!token || !repo || !prNumber) {
    console.warn("Missing GitHub context; skipping PR comment.");
    return;
  }

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json"
    },
    body: JSON.stringify({
      body: `## 🤖 AI PR Review Summary\n\n${markdown}`
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to post PR comment: ${res.status} ${text}`);
  }
}


async function main() {
  
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;

  if (!process.env.COHERE_API_KEY) {
    await postPrComment("⚠️ Missing `COHERE_API_KEY`. Add it as a GitHub Actions secret.");
    process.exit(0);
  }
  if (!baseSha || !headSha) {
    await postPrComment("⚠️ Missing `BASE_SHA` or `HEAD_SHA` environment variables.");
    process.exit(0);
  }

  const diff = gitDiff(baseSha, headSha);

  // Structured output schema (like our demo with Zod + StructuredOutputParser).
  const schema = z.object({
    what_changed: z.array(z.string()).describe("3–6 bullets describing what changed"),
    risks: z.array(z.string()).describe("2–4 bullets describing risks or things to double-check"),
    test_plan: z.array(z.string()).describe("2–5 bullets describing a concrete test plan")
  });
  const parser = StructuredOutputParser.fromZodSchema(schema);

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a careful code reviewer. Be concise and specific to the diff."],
    ["user",
`Here is a git diff from a pull request:

\`\`\`diff
{diff}
\`\`\`

{format_instructions}

Rules:
- Only talk about what is visible in the diff.
- If the diff is tiny, say that.
- Use concrete, actionable bullets.
`]
  ]);

  const llm = new ChatCohere({
    // Uses COHERE_API_KEY from env (as shown in LangChain's Cohere docs).
    model: "command-a-03-2025",
    temperature: 0.2
  });

  const chain = RunnableSequence.from([prompt, llm, parser]);

  try {
    const result = await chain.invoke({
      diff: diff.trim() || "(No diff found.)",
      format_instructions: parser.getFormatInstructions()
    });

    const md =
      `### What changed\n` +
      result.what_changed.map(x => `- ${x}`).join("\n") +
      `\n\n### Potential risks / things to double-check\n` +
      result.risks.map(x => `- ${x}`).join("\n") +
      `\n\n### Suggested test plan\n` +
      result.test_plan.map(x => `- ${x}`).join("\n");

    await postPrComment(md);
  } catch (err) {
    await postPrComment(`⚠️ AI summary failed (this can happen on trial limits). Error:\n\n\`${String(err)}\``);
    process.exit(0);
  }
}

await main();
```

### 5) `.github/workflows/ci.yml`

```yaml
name: CI + AI PR Summary (LangChain + Cohere)

on:
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm install

      - name: Run tests
        run: npm test

      - name: Generate AI PR review summary
        env:
          COHERE_API_KEY: ${{ secrets.COHERE_API_KEY }}
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run ai:summary
```

### 6) Commit + push all files

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

## Part 2 — Get a free Cohere API key + add it as a GitHub Secret

### 1) Create a Cohere API key

If you do not already have a Cohere API key, you can get one for free:
Open this in a browser:

```text
https://dashboard.cohere.com/
```

Sign up (if needed), then create an API key.

### 2) Add the secret to your repo

In your GitHub repo:

1. **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `COHERE_API_KEY`
4. Value: paste your key
5. Save

## Part 3 — Trigger the workflow with a real Pull Request

1. Create a new branch in GitHub (or locally) named: `lab-change`
2. Edit `src/calculator.js` and add one more function (You can do this within GitHub’s web editor):

```js
export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}
```

3. Commit to `lab-change`.
4. Open a Pull Request from `lab-change` → `main`.
    * Click on 'Pull requests' tab
    * Click 'Compare & pull request' button
    * Then click 'Create pull request' button at the bottom
    * Warning: Do NOT merge the PR yet!

## Part 4 — Where to see the AI output

1. Click the **Actions** tab in your repo.
2. Open the newest run for “CI + AI PR Summary (LangChain + Cohere)”.
3. Click the job.
4. Click **Summary**.

You should see a section called **🤖 AI PR Review Summary** with:

* What changed
* Potential risks / things to double-check
* Suggested test plan


## Troubleshooting (most common)

**The AI step says missing COHERE_API_KEY**
You didn’t add the GitHub secret, or the name doesn’t match exactly.

**The workflow runs but there’s no summary**
Make sure the AI step ran (check step logs). Job summaries rely on writing to `GITHUB_STEP_SUMMARY`. ([The GitHub Blog][2])

**Rate limit / trial limits**
Trial keys are free but limited. If you hit limits, re-run once later, or keep the diff small. ([Cohere Documentation][4])

---

## Optional stretch (only if you finish early)

Add a second step that runs **only when tests fail** and asks the model to summarize the failure output. Keep it as a workflow summary (no PR comments). This is the group project “debugging/triage” category, but totally optional for this lab.

---

### Why this lab is “project prep”

This lab gives you the exact skills you’ll need later:

* creating a repo + a workflow from scratch
* running tests in CI
* securely passing an API key via GitHub Secrets
* calling an LLM through **LangChain** inside CI
* producing a useful SDLC artifact (review summary) automatically

If you want, I can also provide a **Python LangChain + Cohere variant** of the same lab (same outputs, different runtime) using `langchain-cohere`. ([pypi.org][5])

[2]: https://github.blog/news-insights/product-news/supercharging-github-actions-with-job-summaries/?utm_source=chatgpt.com "Supercharging GitHub Actions with Job Summaries"
[4]: https://docs.cohere.com/docs/how-does-cohere-pricing-work?utm_source=chatgpt.com "How Does Cohere's Pricing Work?"
[5]: https://pypi.org/project/langchain-cohere/?utm_source=chatgpt.com "langchain-cohere"

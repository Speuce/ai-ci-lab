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

function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    console.log(markdown);
    return;
  }
  fs.appendFileSync(summaryPath, `\n\n## 🤖 AI PR Review Summary\n\n${markdown}\n`, "utf-8");
}

async function main() {
  
  //load dotenv variables
    import('dotenv/config');

  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;

  if (!process.env.COHERE_API_KEY) {
    writeSummary("⚠️ Missing `COHERE_API_KEY`. Add it as a GitHub Actions secret.");
    process.exit(0);
  }
  if (!baseSha || !headSha) {
    writeSummary("⚠️ Missing `BASE_SHA` or `HEAD_SHA` environment variables.");
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

    writeSummary(md);
  } catch (err) {
    writeSummary(`⚠️ AI summary failed (this can happen on trial limits). Error:\n\n\`${String(err)}\``);
    process.exit(0);
  }
}

await main();

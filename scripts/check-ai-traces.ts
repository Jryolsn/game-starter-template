// Stoppar AI-attribution i commits och filer (t.ex. Co-Authored-By-rader från kodassistenter).
//   tsx scripts/check-ai-traces.ts             kollar alla filer i repot och commits sedan origin/main
//   tsx scripts/check-ai-traces.ts --msg FIL   kollar ett commit-meddelande (används av .githooks/commit-msg)
// Intervallet för commits kan sättas med AI_CHECK_RANGE, t.ex. "abc123..HEAD".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS: RegExp[] = [
  /co-authored-by:.*\b(claude|anthropic|copilot|chatgpt|openai|cursor|gemini|devin)\b/i,
  /noreply@(anthropic|openai)\.com/i,
  /generated (with|by) \[?(claude|chatgpt|copilot|cursor|gemini)/i,
  /claude\.(ai|com)\/code/i,
  /^claude-session:/im,
  /🤖 generated/i,
];

const SELF = "scripts/check-ai-traces.ts";

function findings(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => PATTERNS.some((p) => p.test(line)))
    .map((line) => line.trim());
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const problems: string[] = [];
const msgIndex = process.argv.indexOf("--msg");

if (msgIndex !== -1) {
  const msg = readFileSync(process.argv[msgIndex + 1], "utf8");
  for (const line of findings(msg)) problems.push(`commit-meddelandet: ${line}`);
} else {
  for (const file of git("ls-files", "-z").split("\0")) {
    if (!file || file === SELF) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // borttagen men inte committad
    }
    if (text.includes("\0")) continue; // binärfil
    for (const line of findings(text)) problems.push(`${file}: ${line}`);
  }
  let range = process.env.AI_CHECK_RANGE;
  if (!range) {
    try {
      git("rev-parse", "--verify", "--quiet", "origin/main");
      range = "origin/main..HEAD";
    } catch {}
  }
  if (range) {
    for (const entry of git("log", "--format=%H%x00%B%x01", range).split("\x01")) {
      const [sha, body = ""] = entry.trim().split("\0");
      if (!sha) continue;
      for (const line of findings(body)) problems.push(`commit ${sha.slice(0, 7)}: ${line}`);
    }
  }
}

if (problems.length > 0) {
  console.error("Hittade AI-attribution som inte ska finnas i repot:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nTa bort raderna. För commits: git commit --amend (senaste) eller git rebase -i.");
  process.exit(1);
}

/** 系统提示词组装：人设 + 技能（渐进式披露）+ 记忆 + 工具使用规范 */
import type { MemoryHit, SkillSpec } from "./runtime";

export const BASE_IDENTITY = `你是 TinyBuddy，一个运行在团队工作区里的 AI 同事。

## 行为准则
- 简洁、直接、可执行。先给结论，再给必要的解释，不要复述问题。
- 不确定的信息要明确标注，不要编造事实、链接或数据。
- 需要外部信息或执行动作时，优先调用工具，而不是凭记忆回答。
- 涉及记忆时：用户陈述的稳定偏好、身份、长期目标值得记住；一次性闲聊不要写。
- 输出使用与用户相同的语言（用户用中文就用中文，用英文就用英文）。
- 使用 Markdown：短段落、列表、必要时用表格；不要输出大段无结构的文字。`;

export interface PromptContext {
  skills: SkillSpec[];
  memories: MemoryHit[];
  toolNames: string[];
  userName?: string;
  locale?: string;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [BASE_IDENTITY];

  if (ctx.userName) {
    sections.push(`## 当前用户\n${ctx.userName}${ctx.locale ? `（语言偏好：${ctx.locale}）` : ""}`);
  }

  if (ctx.skills.length) {
    sections.push(
      `## 已激活技能\n${ctx.skills
        .map((s) => `### ${s.name} (${s.key})\n${s.instructions.trim()}`)
        .join("\n\n")}\n\n技能附带资源可用 \`skill_read\` 按需读取，不要一次性全部读取。`,
    );
  }

  if (ctx.memories.length) {
    sections.push(
      `## 相关长期记忆\n以下是召回的用户记忆，按相关度排序。把它们当作背景事实使用，不要逐条复述：\n${ctx.memories
        .map((m, i) => `${i + 1}. [${m.kind ?? "fact"}] ${m.content}`)
        .join("\n")}`,
    );
  }

  if (ctx.toolNames.length) {
    sections.push(
      `## 工具\n可用工具：${ctx.toolNames.join(", ")}。\n- 调用前先确认参数完整；一次只调用必要的工具。\n- 工具失败时说明原因并给出替代方案，不要静默重试超过一次。`,
    );
  }

  return sections.join("\n\n");
}

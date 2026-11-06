/** 初始化：内置角色 / 演示账号 / 内置技能 / 示例知识库 / 示例记忆与定时任务 */
import { ROLE_PRESETS } from "@tiny-buddy/shared";
import { db, newId, now } from "./index";
import { hashPassword } from "../lib/auth";
import { chunkText, embed, estimateTokens } from "../lib/text";
import { nextRun } from "../lib/cron";

const PALETTE = ["#7c5cff", "#2f9e8f", "#c2751f", "#3b7ddd", "#d05270", "#6a8f2f"];

export function ensureRoles(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const preset of ROLE_PRESETS) {
    let row = db.prepare(`SELECT id, permissions FROM roles WHERE key = ?`).get(preset.key) as
      | { id: string; permissions: string }
      | undefined;
    if (!row) {
      const id = newId("rol");
      db.prepare(
        `INSERT INTO roles (id, key, name, description, permissions, color, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(id, preset.key, preset.name, preset.description, JSON.stringify(preset.permissions), preset.color, now());
      row = { id, permissions: JSON.stringify(preset.permissions) };
    } else {
      // 版本升级会新增权限点：系统角色做「只增不减」的补齐，保留管理员的自定义授权
      const current = JSON.parse(row.permissions || "[]") as string[];
      const missing = preset.permissions.filter((p) => !current.includes(p));
      if (missing.length) {
        db.prepare(`UPDATE roles SET permissions = ? WHERE id = ?`).run(JSON.stringify([...current, ...missing]), row.id);
      }
    }
    map[preset.key] = row.id;
  }
  return map;
}

function ensureUser(input: { email: string; name: string; roleKey: string; colorIndex: number }): string {
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(input.email) as { id: string } | undefined;
  if (existing) return existing.id;
  const roles = ensureRoles();
  const id = newId("usr");
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role_id, locale, theme, avatar_color, created_at)
     VALUES (?, ?, ?, ?, ?, 'zh', 'system', ?, ?)`,
  ).run(
    id,
    input.email,
    input.name,
    hashPassword("admin123456"),
    roles[input.roleKey],
    PALETTE[input.colorIndex % PALETTE.length],
    now(),
  );
  return id;
}

interface SeedSkill {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  instructions: string;
  triggers: string[];
  resources: { name: string; content: string }[];
}

const SKILLS: SeedSkill[] = [
  {
    key: "research",
    name: "深度调研",
    description: "把一个模糊问题拆成可验证的调研计划，输出结论、证据与风险",
    icon: "telescope",
    category: "analysis",
    triggers: ["调研", "研究", "竞品", "research", "分析一下", "对比"],
    instructions: `按以下结构完成任务：
1. 先复述目标，明确 2-3 个关键假设；
2. 将问题拆成 3-5 个子问题，指出每个子问题需要什么证据；
3. 优先使用 knowledge_search 检索内部资料，外部事实明确标注「需外部核实」；
4. 输出：结论先行 → 证据链 → 反例/风险 → 下一步行动（可执行、有负责人角色）。
不要堆砌背景信息，不要编造数据来源。`,
    resources: [
      {
        name: "调研质量检查清单.md",
        content: `# 调研质量检查清单
- [ ] 结论是否回答了他真正要做的决策？
- [ ] 每个关键结论是否有至少一条证据支撑？
- [ ] 是否标注了不确定性（数据缺口、假设）？
- [ ] 是否给出了反面观点？
- [ ] 下一步行动是否具体到「谁、做什么、什么时候」？`,
      },
      {
        name: "竞品分析框架.md",
        content: `# 竞品分析框架
1. 定位：目标用户 / 核心场景 / 价值主张
2. 能力：功能矩阵（必须有 / 差异化 / 缺失）
3. 体验：关键路径步骤数、首次价值时间
4. 商业：定价模型、获客方式
5. 趋势：最近 6 个月的发布节奏
输出必须包含「我们可以借鉴的 3 件事」与「不应跟随的 2 件事」。`,
      },
    ],
  },
  {
    key: "writing",
    name: "文档写作",
    description: "把零散信息整理成结构清晰、语气得体的中文文档",
    icon: "pen",
    category: "writing",
    triggers: ["写", "撰写", "起草", "文案", "报告", "draft", "write"],
    instructions: `写作规范：
- 先定读者与目的，再定结构；结论前置。
- 默认使用简体中文，语气克制、专业，不用夸张副词与空洞口号。
- 长文使用二级标题；每段不超过 4 行；能用列表就不用长句。
- 引用数据必须给出来源或标注「估算」。
- 结尾给出「下一步」或「待确认事项」，不要用「希望对您有帮助」这类套话。`,
    resources: [
      {
        name: "公文结构模板.md",
        content: `# 通用公文结构
1. 事项背景（3 句内）
2. 目标与范围
3. 方案与取舍（对比表）
4. 风险与应对
5. 资源与时间计划
6. 待决策事项`,
      },
    ],
  },
  {
    key: "code-review",
    name: "代码审查",
    description: "从正确性、安全性、可维护性三个维度审查代码并给出可执行修改建议",
    icon: "code",
    category: "engineering",
    triggers: ["代码", "code review", "review", "审查", "重构", "bug"],
    instructions: `审查顺序：正确性 → 安全性 → 可维护性 → 性能。
- 每条问题必须给出：位置、原因、影响、建议改法（代码片段）。
- 区分「必须修」与「建议改」，不要用主观风格偏好阻塞合并。
- 特别检查：鉴权边界、输入校验、SQL 注入、错误吞掉、并发竞态、N+1 查询。
- 最后给出 1-3 条整体性建议。`,
    resources: [
      {
        name: "安全审查清单.md",
        content: `# 后端安全审查清单
- 所有写操作是否鉴权 + 校验资源归属？
- 用户输入是否进入 SQL / 模板 / 命令拼接？
- 密钥是否硬编码或进入日志？
- 文件上传是否限制类型与大小？
- 错误响应是否泄漏堆栈或内部路径？`,
      },
    ],
  },
  {
    key: "data-analysis",
    name: "数据分析",
    description: "从指标定义到结论的完整分析链路，输出可复用的查询与结论",
    icon: "chart",
    category: "analysis",
    triggers: ["数据", "指标", "报表", "data", "增长", "转化"],
    instructions: `分析流程：
1. 明确决策问题与口径（指标定义、时间范围、过滤条件）；
2. 拆解指标（加法/乘法拆解），找出 2-3 个可能的影响因子；
3. 给出验证方法（对比、分群、时序）；
4. 输出结论时区分「事实 / 推断 / 猜测」，并给出置信度。
禁止在没有数据时编造数字；数据缺失时说明需要什么数据。`,
    resources: [],
  },
  {
    key: "meeting",
    name: "会议纪要",
    description: "把会议记录整理为决议、待办与风险，责任到人",
    icon: "users",
    category: "productivity",
    triggers: ["会议", "纪要", "meeting", "minutes", "周会"],
    instructions: `输出固定四段：
## 决议
（已达成共识、不再讨论的事项，编号列出）
## 待办
| 事项 | 负责人 | 截止时间 |
## 待定
（未达成一致、需要谁在何时决定）
## 风险
（可能阻塞目标的事项）
只记录结论与行动，不复述讨论过程。`,
    resources: [],
  },
];

function seedSkills(): void {
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM skills`).get() as { n: number }).n;
  if (count > 0) return;
  const stmt = db.prepare(
    `INSERT INTO skills (id, key, name, description, icon, category, instructions, tools, resources, triggers, enabled, builtin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 1, 1, ?)`,
  );
  for (const s of SKILLS) {
    stmt.run(
      newId("skl"),
      s.key,
      s.name,
      s.description,
      s.icon,
      s.category,
      s.instructions,
      JSON.stringify(s.resources),
      JSON.stringify(s.triggers),
      now(),
    );
  }
}

const KB_DOCS = [
  {
    name: "TinyBuddy 产品说明.md",
    content: `# TinyBuddy 产品说明

TinyBuddy 是面向小团队的 AI 同事平台，把「记忆、知识、技能、工具、定时任务」收敛到一个工作区里。

## 核心能力
- **Agent 记忆**：分事实、偏好、事件、流程四类；写入时自动去重（余弦相似度 0.94 以上视为同一记忆）。检索采用向量 + 关键词混合打分。
- **知识库**：文档按 700 字分块，块间重叠 80 字；支持 Markdown / 纯文本；检索结果带文档名与相关度。
- **技能（Skill）**：声明式的领域能力包，包含指令、触发词与参考资料。采用渐进式披露：只有被激活的技能才会把指令注入系统提示词，参考资料通过 skill_read 按需读取。
- **MCP**：既可作为 MCP 客户端连接外部工具，也可作为 MCP 服务端对外暴露平台能力。
- **定时任务**：5 段 cron，到点后以创建者身份运行 Agent，结果写入独立会话。

## 权限模型
RBAC，内置四种角色：所有者（全部权限）、管理员（除平台超管外全部）、成员（日常使用）、访客（只读 + 对话）。
每个 API Key 可进一步收窄权限范围（scopes），实现最小权限授予。

## 技术架构
前端 React + Vite + Tailwind，移动端优先；后端 Express + SQLite；Agent 运行时为自研的 DSH（Declarative Streaming Harness），基于事件流与响应式状态。`,
  },
  {
    name: "团队协作规范.md",
    content: `# 团队协作规范

## 沟通
- 默认异步：先在文档写清楚，再约会议。会议必须有议程与预期产出。
- 紧急事项走电话，非紧急不要连续打断。
- 每周一 10:00 周会，每人 5 分钟：上周产出、本周计划、需要的帮助。

## 文档
- 所有决策必须落到文档，包含背景、选项、结论、负责人。
- 文档标题格式：主题 + 日期，例如「知识库检索方案 2025-03」。
- 过期文档在两周内归档，避免误导。

## 代码
- 每个 PR 不超过 400 行，必须有一名 reviewer。
- 主干保护：CI 通过 + 至少一个 approve 才能合并。
- 提交信息使用「类型: 简述」，类型包括 feat / fix / refactor / docs / chore。

## 发布
- 每周四下午发布，发布前 24 小时冻结非紧急合并。
- 回滚预案必须写在发布单里。`,
  },
  {
    name: "API 接入指南.md",
    content: `# TinyBuddy API 接入指南

## 认证
所有接口使用 Bearer Token。用户态使用登录返回的 JWT（有效期 30 天）；服务间调用使用 API Key，格式为 tb_ 前缀 + 32 位随机串。

## 主要端点
- POST /api/auth/login：邮箱密码登录，返回 token 与用户信息（含权限列表）。
- POST /api/sessions：创建会话；POST /api/sessions/:id/messages：发送消息，返回 SSE 事件流。
- GET /api/memories：分页查询记忆；POST /api/memories：手动写入记忆。
- GET /api/knowledge/bases：知识库列表；POST /api/knowledge/bases/:id/documents：上传文档。
- POST /api/mcp：平台级 MCP 服务端点（Streamable HTTP），使用 API Key 认证。

## SSE 事件
事件类型包括 run.start、text.delta、tool.start、tool.end、memory.recall、message.end、run.end、error。
客户端应按 event 字段分发，message.end 携带完整消息体，可直接落库。

## 限流与错误
错误响应统一为 { error: { code, message, details } }。401 表示令牌失效，403 表示权限不足，429 表示触发限流。`,
  },
  {
    name: "新成员入职手册.md",
    content: `# 新成员入职手册

## 第一天
1. 领取账号，登录 TinyBuddy，完善个人资料（语言、主题）。
2. 阅读《团队协作规范》与《TinyBuddy 产品说明》。
3. 加入周会日历，配置开发环境（Node 20+、pnpm 10+）。

## 第一周
- 完成一个 good-first-issue，走完整 PR 流程。
- 与 mentor 进行两次 1:1，明确 30/60/90 天目标。
- 在知识库补充一篇你负责模块的说明文档。

## 常用入口
- 需求池：/product/backlog
- 发布单：/release
- 值班表：每周五更新

## 遇到问题
先在知识库检索，再问 mentor；问题解决后把答案补回知识库。`,
  },
];

function seedKnowledge(ownerId: string): void {
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM knowledge_bases`).get() as { n: number }).n;
  if (count > 0) return;

  const kbId = newId("kb");
  db.prepare(`INSERT INTO knowledge_bases (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    kbId,
    "团队手册",
    "产品说明、协作规范、接入指南与入职材料",
    ownerId,
    now(),
  );

  for (const doc of KB_DOCS) {
    const docId = newId("doc");
    const chunks = chunkText(doc.content);
    db.prepare(
      `INSERT INTO documents (id, kb_id, name, mime, size, status, chunks, content, created_at) VALUES (?, ?, ?, 'text/markdown', ?, 'ready', ?, ?, ?)`,
    ).run(docId, kbId, doc.name, doc.content.length, chunks.length, doc.content, now());
    const stmt = db.prepare(
      `INSERT INTO chunks (id, doc_id, kb_id, idx, content, tokens, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    chunks.forEach((content, idx) => {
      stmt.run(newId("chk"), docId, kbId, idx, content, estimateTokens(content), JSON.stringify(embed(content)));
    });
  }
}

const DEMO_MEMORIES = [
  { content: "用户偏好简洁、结论先行的中文回答，不喜欢冗长的客套话。", kind: "preference", importance: 0.9, tags: ["沟通风格"] },
  { content: "用户是产品负责人，主要关注 Agent 产品的落地效率与团队协作成本。", kind: "fact", importance: 0.85, tags: ["角色"] },
  { content: "团队每周一 10:00 开周会，每人 5 分钟同步进展。", kind: "fact", importance: 0.6, tags: ["团队", "日程"] },
  { content: "发布窗口固定在每周四下午，发布前 24 小时冻结非紧急合并。", kind: "procedure", importance: 0.7, tags: ["发布"] },
];

function seedMemories(userId: string): void {
  const existing = (db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE user_id = ?`).get(userId) as { n: number }).n;
  if (existing > 0) return;
  const stmt = db.prepare(
    `INSERT INTO memories (id, user_id, scope, kind, content, tags, importance, source, embedding, created_at, updated_at)
     VALUES (?, ?, 'user', ?, ?, ?, ?, 'seed', ?, ?, ?)`,
  );
  const ts = now();
  for (const m of DEMO_MEMORIES) {
    stmt.run(newId("mem"), userId, m.kind, m.content, JSON.stringify(m.tags), m.importance, JSON.stringify(embed(m.content)), ts, ts);
  }
}

function seedConversations(userId: string): void {
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(userId) as { n: number }).n;
  if (count > 0) return;

  const nowMs = Date.now();
  const mk = (
    title: string,
    skillKey: string | null,
    messages: { role: string; content: string; parts?: unknown[] }[],
    daysAgo = 0,
    hoursAgo = 0,
  ) => {
    const sid = newId("ses");
    const base = nowMs - daysAgo * 86_400_000 - hoursAgo * 3_600_000;
    const createdAt = new Date(base).toISOString();
    const updatedAt = new Date(base + (messages.length - 1) * 45_000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_id, title, agent_key, skill_key, created_at, updated_at) VALUES (?, ?, ?, 'buddy', ?, ?, ?)`,
    ).run(sid, userId, title, skillKey, createdAt, updatedAt);
    messages.forEach((m, i) => {
      db.prepare(`INSERT INTO messages (id, session_id, role, content, parts, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        newId("msg"),
        sid,
        m.role,
        m.content,
        JSON.stringify(m.parts ?? [{ type: "text", text: m.content }]),
        new Date(base + i * 45_000).toISOString(),
      );
    });
  };

  mk("欢迎使用 TinyBuddy", null, [
    { role: "user", content: "你能帮我做什么？" },
    {
      role: "assistant",
      content:
        "我是 TinyBuddy，你的团队 AI 同事。简单说，我能做四件事：\n\n1. **记住**：你的偏好、团队规则、历史决策，写入长期记忆并可检索；\n2. **查**：在团队知识库里做混合检索，回答内部流程与产品细节；\n3. **做**：调用技能（调研、写作、代码审查…）与 MCP 工具完成实际任务；\n4. **按时做**：用 cron 定时任务，每天/每周自动产出简报。\n\n试试对我说「记住：我偏好中文、结论先行的回答」，然后去「记忆」页面看看它被存到了哪里。",
    },
  ], 5);

  mk("如何接入外部 MCP 工具", null, [
    { role: "user", content: "我想把公司内部的工单系统接进来，怎么弄？" },
    {
      role: "assistant",
      content:
        "两步：\n\n1. 在「MCP」页面新增一个连接，填入工单系统的 MCP 端点 URL（支持 Streamable HTTP 与 SSE），如果需要鉴权就在 Headers 里加 `Authorization`。保存后会立即拉取工具清单。\n2. 连接成功后，工具会以 `mcp_<服务名>__<工具名>` 的形式出现在 Agent 的工具列表里，对话时会被自动调用。\n\n反过来，如果你希望别的客户端（比如 Claude Desktop）调用 TinyBuddy 的能力，可以在「MCP 服务」标签页生成 API Key，端点就是 `POST /api/mcp`。",
    },
  ], 3);

  mk("在知识库中查一下发布流程", null, [
    { role: "user", content: "在知识库中查一下发布流程" },
    {
      role: "assistant",
      content:
        "我先检索一下知识库。\n\n> [1] 《团队协作规范.md》（团队手册，相关度 0.246）\n> ## 发布\n> - 每周四下午发布，发布前 24 小时冻结非紧急合并。\n> - 回滚预案必须写在发布单里。\n\n## 发布\n\n- **窗口**：每周四 14:00–16:00，避开月末与销售冲刺周。\n- **冻结**：发布前 24 小时只允许紧急修复，需在发布单注明原因。\n- **回滚**：任何变更都要写清回滚步骤与验证方式，回滚人默认是当次发布的值班同学。\n\n需要我把这份流程整理成发布检查清单吗？",
      parts: [
        { type: "text", text: "我先检索一下知识库。" },
        {
          type: "tool",
          id: "call_seed_kb",
          name: "knowledge_search",
          title: "知识库检索",
          input: { query: "发布流程", limit: 3 },
          output:
            "[1] 《团队协作规范.md》（团队手册，相关度 0.246）\n## 发布\n- 每周四下午发布，发布前 24 小时冻结非紧急合并。\n- 回滚预案必须写在发布单里。",
          status: "done",
          durationMs: 3,
          source: "platform",
        },
        {
          type: "text",
          text: "## 发布\n\n- **窗口**：每周四 14:00–16:00，避开月末与销售冲刺周。\n- **冻结**：发布前 24 小时只允许紧急修复，需在发布单注明原因。\n- **回滚**：任何变更都要写清回滚步骤与验证方式，回滚人默认是当次发布的值班同学。\n\n需要我把这份流程整理成发布检查清单吗？",
        },
      ],
    },
  ], 1);

  mk("帮我总结一下发布流程", null, [
    { role: "user", content: "帮我总结一下发布流程的要点" },
    {
      role: "assistant",
      content:
        "## 发布流程要点\n\n1. **窗口**：每周四 14:00–16:00，避开月末与销售冲刺周。\n2. **冻结**：发布前 24 小时只允许紧急修复，且要在发布单注明原因。\n3. **回滚**：每个变更都要写清回滚步骤与验证方式，回滚人默认是当次值班同学。\n4. **复盘**：发布后观察 30 分钟错误率与 P95 延迟，异常立即回滚。\n\n> 需要我按这份流程生成发布前的检查清单吗？",
    },
  ], 0, 4);

  mk("Look up the release process", null, [
    { role: "user", content: "Look up the release process in the knowledge base" },
    {
      role: "assistant",
      content:
        "Here is what the team handbook says about releases.\n\n## Release process\n\n- **Window** — Thursdays 14:00–16:00, avoiding month-end and sales sprints.\n- **Freeze** — only emergency fixes in the 24 hours before a release; note the reason on the release ticket.\n- **Rollback** — every change ships with rollback steps and a verification plan; the on-call engineer owns the rollback.\n- **Review** — watch error rate and P95 latency for 30 minutes after release.\n\nWant me to turn this into a pre-release checklist?",
    },
  ], 0, 0.8);

  mk("写一段产品介绍", "writing", [
    { role: "user", content: "写一段产品介绍，面向团队负责人" },
    {
      role: "assistant",
      content:
        "**TinyBuddy：把 AI 变成团队里真正干活的那个人。**\n\n大多数 AI 助手停在对话框里：记不住偏好，够不到资料，也接不进系统。TinyBuddy 把 AI 当作团队成员来建模——它有**长期记忆**，能记住每个人的习惯与团队规范；有**团队知识库**，回答问题会带上出处；有**声明式技能**，把「怎么做一件事」沉淀成可复用的能力包；还能通过 **MCP** 连接你已有的工具，并把平台能力反向开放给 Claude Desktop、Cursor 等客户端。\n\n需要时，它还会按 cron 定时自主完成任务。对团队负责人来说，这意味着少一次重复解释、少一次手工汇总，多一个随时在线的同事。",
    },
  ], 0, 1.5);
}

function seedSchedule(userId: string): void {
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM schedules`).get() as { n: number }).n;
  if (count > 0) return;
  const cron = "0 9 * * 1-5";
  db.prepare(
    `INSERT INTO schedules (id, name, cron, timezone, prompt, enabled, next_run_at, created_by, created_at)
     VALUES (?, ?, ?, 'Asia/Shanghai', ?, 1, ?, ?, ?)`,
  ).run(
    newId("sch"),
    "工作日晨间简报",
    cron,
    "汇总今天需要关注的事项：检索知识库中的协作规范，列出发布窗口与周会安排，给出今日三条优先事项。控制在 200 字内。",
    nextRun(cron)?.toISOString() ?? null,
    userId,
    now(),
  );
}

/** 演示用运行历史：让用量面板在全新安装后就有可看的趋势 */
function seedRuns(ownerId: string): void {
  const existing = (db.prepare(`SELECT COUNT(*) AS n FROM runs`).get() as { n: number }).n;
  if (existing > 0) return;

  const prompts = [
    "在知识库中查一下发布流程",
    "帮我总结一下这周的发布计划",
    "把这段会议纪要整理成待办",
    "写一段 MCP 服务端的产品介绍",
    "根据团队规范做一次代码审查",
    "生成本周的周报草稿",
  ];
  const kinds = ["chat", "chat", "chat", "chat", "schedule", "skill", "mcp"];
  const insert = db.prepare(
    `INSERT INTO runs (id, kind, ref_id, user_id, status, input, output, steps, tool_calls, usage, error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const nowMs = Date.now();

  for (let d = 13; d >= 0; d--) {
    const weekday = new Date(nowMs - d * 86_400_000).getDay();
    if (weekday === 0 && d !== 0) continue;
    const count = d === 0 ? 4 : 1 + ((d * 3) % 3);
    for (let i = 0; i < count; i++) {
      const started = new Date(nowMs - d * 86_400_000 - (i + 1) * 47 * 60_000);
      const failed = (d * 5 + i * 7) % 13 === 0;
      const tools = (d + i) % 4;
      const tokens = 320 + ((d * 131 + i * 67) % 1200);
      const promptTokens = Math.round(tokens * 0.72);
      insert.run(
        newId("run"),
        kinds[(d + i) % kinds.length],
        null,
        ownerId,
        failed ? "failed" : "success",
        prompts[(d + i) % prompts.length],
        failed ? "" : "已结合知识库与历史记忆整理出结果，包含结论、依据与下一步建议。",
        1 + ((d + i) % 3),
        tools,
        JSON.stringify({ promptTokens, completionTokens: tokens - promptTokens, totalTokens: tokens }),
        failed ? "模型调用超时" : null,
        started.toISOString(),
        new Date(started.getTime() + 900 + ((d * 97 + i * 53) % 2200)).toISOString(),
      );
    }
  }
}

/** 新注册用户的初始工作区 */
export function seedUserWorkspace(userId: string, name: string): void {
  const ts = now();
  const welcome = [
    `用户的名字是 ${name}。`,
    "用户偏好简洁、结论先行的中文回答。",
  ];
  const stmt = db.prepare(
    `INSERT INTO memories (id, user_id, scope, kind, content, tags, importance, source, embedding, created_at, updated_at)
     VALUES (?, ?, 'user', ?, ?, '[]', 0.7, 'system', ?, ?, ?)`,
  );
  for (const content of welcome) {
    stmt.run(newId("mem"), userId, "fact", content, JSON.stringify(embed(content)), ts, ts);
  }
  const sid = newId("ses");
  db.prepare(
    `INSERT INTO sessions (id, user_id, title, agent_key, created_at, updated_at) VALUES (?, ?, '欢迎使用 TinyBuddy', 'buddy', ?, ?)`,
  ).run(sid, userId, ts, ts);
  db.prepare(`INSERT INTO messages (id, session_id, role, content, parts, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`).run(
    newId("msg"),
    sid,
    "欢迎加入 TinyBuddy。我是你的 AI 同事，可以记住偏好、检索知识库、调用技能与 MCP 工具，也能按时执行任务。\n\n试着告诉我一件值得长期记住的事，或者直接问一个团队内部的问题。",
    JSON.stringify([
      {
        type: "text",
        text: "欢迎加入 TinyBuddy。我是你的 AI 同事，可以记住偏好、检索知识库、调用技能与 MCP 工具，也能按时执行任务。\n\n试着告诉我一件值得长期记住的事，或者直接问一个团队内部的问题。",
      },
    ]),
    ts,
  );
}


/** 内置提示词模板：只读，团队可复制后修改 */
const BUILTIN_PROMPTS: {
  id: string;
  title: string;
  description: string;
  body: string;
  category: string;
  icon: string;
  tags: string[];
}[] = [
  {
    id: "prm_builtin_weekly",
    title: "周报生成",
    description: "把零散的每日记录整理成有结论、有风险、有下周计划的周报。",
    category: "writing",
    icon: "file-text",
    tags: ["周报", "汇报"],
    body:
      "把下面这周的零散记录整理成一份周报，面向直属上级。\n\n" +
      "要求：\n" +
      "1. 开头三句话给结论：本周最重要的进展、当前最大风险、需要对方做的决定。\n" +
      "2. 正文按「已完成 / 进行中 / 受阻」分组，每条写清结果与影响，不写过程流水账。\n" +
      "3. 下周计划不超过 5 条，标注优先级与预计完成时间。\n" +
      "4. 全文控制在 400 字以内，不使用「赋能、抓手、闭环」这类空话。\n\n" +
      "本周记录：\n{{本周记录}}",
  },
  {
    id: "prm_builtin_meeting",
    title: "会议纪要",
    description: "从录音转写或聊天记录里提炼决议、待办与责任人。",
    category: "meeting",
    icon: "clipboard-list",
    tags: ["会议", "待办"],
    body:
      "把下面的会议内容整理成纪要。\n\n" +
      "输出结构：\n" +
      "- 一句话结论（这次会决定了什么）\n" +
      "- 决议清单：每条注明「决定了什么 / 为什么 / 生效时间」\n" +
      "- 待办表格：事项 | 负责人 | 截止时间 | 依赖\n" +
      "- 未达成一致的问题：写明分歧点与下一步动作\n\n" +
      "不要臆造没有出现的负责人或时间；信息缺失就写「待确认」。\n\n" +
      "会议内容：\n{{会议内容}}",
  },
  {
    id: "prm_builtin_prd",
    title: "需求拆解",
    description: "把一句模糊需求拆成可验收的用户故事与边界条件。",
    category: "product",
    icon: "list-checks",
    tags: ["需求", "PRD"],
    body:
      "把这条需求拆成可开发的规格：{{需求描述}}\n\n" +
      "1. 先复述你理解的目标用户与核心场景，列出 2-3 个仍然模糊、需要产品确认的问题。\n" +
      "2. 拆成用户故事（作为…我希望…以便…），按优先级排序，标注 MVP 范围。\n" +
      "3. 每个故事补验收标准：正常路径、空状态、权限不足、失败重试。\n" +
      "4. 明确指出这次不做什么（Out of scope），避免范围蔓延。",
  },
  {
    id: "prm_builtin_review",
    title: "代码审查",
    description: "按正确性、边界、性能、可读性、安全五个维度审查，按严重程度排序。",
    category: "dev",
    icon: "git-pull-request",
    tags: ["代码", "Review"],
    body:
      "审查下面的代码，按严重程度从高到低输出问题。\n\n" +
      "维度：正确性与边界条件、并发与资源释放、性能热点、可读性与命名、安全风险（注入、越权、密钥泄漏）。\n" +
      "每条问题写：位置、为什么会出问题、最小修改建议（给 diff 或改写后的代码）。\n" +
      "最后单独列「可以保留的写法」，避免为了改而改。\n\n" +
      "语言/框架：{{技术栈}}\n代码：\n```\n{{代码}}\n```",
  },
  {
    id: "prm_builtin_postmortem",
    title: "故障复盘",
    description: "从时间线还原故障，区分直接原因与系统性原因，给出可验证的改进项。",
    category: "dev",
    icon: "shield-alert",
    tags: ["复盘", "稳定性"],
    body:
      "根据下面的故障信息写一份无指责复盘（blameless postmortem）。\n\n" +
      "结构：影响面（用户/时长/数据）→ 时间线 → 直接原因 → 系统性原因（为什么监控/流程没兜住）→ 改进项。\n" +
      "改进项必须是可验证的动作，注明负责人角色与截止时间；区分「已修复」与「待跟进」。\n" +
      "如果信息不足以定位根因，先列出还需要哪些日志或指标。\n\n" +
      "故障信息：\n{{故障信息}}",
  },
  {
    id: "prm_builtin_competitor",
    title: "竞品调研",
    description: "围绕同一场景对比多家产品，输出差异点与可借鉴的取舍。",
    category: "research",
    icon: "search",
    tags: ["调研", "竞品"],
    body:
      "对比 {{竞品列表}} 在「{{场景}}」上的做法。\n\n" +
      "1. 先用一张表对齐：目标用户、核心流程、关键差异、定价策略、明显短板。\n" +
      "2. 指出哪些差异是「能力差异」，哪些只是「设计取舍」，不要把后者说成缺陷。\n" +
      "3. 给出 3 条可落地到我们产品的建议，按投入产出排序，并说明风险。\n" +
      "4. 标注哪些结论来自公开资料、哪些是推测；推测必须显式标注。",
  },
  {
    id: "prm_builtin_data",
    title: "数据解读",
    description: "从指标变化里找出真正的驱动因素，避免把相关性当因果。",
    category: "analysis",
    icon: "bar-chart-3",
    tags: ["数据", "分析"],
    body:
      "解读这组数据：\n{{数据}}\n\n" +
      "1. 先描述趋势与异常点，不要急着解释。\n" +
      "2. 列出可能的驱动因素，按可验证性排序，并说明每种解释需要什么额外数据才能证实。\n" +
      "3. 明确区分「相关」与「因果」，标注样本量与时间窗口带来的局限。\n" +
      "4. 给出下一步建议：先看哪个指标、做什么对照。",
  },
  {
    id: "prm_builtin_email",
    title: "邮件润色",
    description: "把生硬的草稿改成礼貌、直接、有明确下一步的邮件。",
    category: "writing",
    icon: "mail",
    tags: ["邮件", "沟通"],
    body:
      "润色下面这封邮件，保持原意，语气{{语气}}。\n\n" +
      "要求：\n" +
      "- 主题行不超过 20 字，让人一眼知道要做什么\n" +
      "- 第一段说清目的与期望动作\n" +
      "- 删掉客套与重复，长句拆短\n" +
      "- 结尾给出明确的下一步与时间点\n\n" +
      "原邮件：\n{{原邮件}}",
  },
  {
    id: "prm_builtin_release",
    title: "发布说明",
    description: "把提交记录整理成用户看得懂的更新日志。",
    category: "dev",
    icon: "rocket",
    tags: ["发布", "Changelog"],
    body:
      "把下面的变更整理成发布说明，读者是真实用户，不是开发者。\n\n" +
      "分组：新增 / 改进 / 修复 / 破坏性变更。每条一句话说清「用户能感知到什么变化」，不要照抄 commit message。\n" +
      "破坏性变更必须写清升级步骤与影响范围。\n" +
      "最后用一句话总结这次版本的主题。\n\n" +
      "版本号：{{版本号}}\n变更：\n{{变更列表}}",
  },
  {
    id: "prm_builtin_decision",
    title: "决策对比",
    description: "在几个方案之间做结构化取舍，给出可被质疑的推荐。",
    category: "analysis",
    icon: "scale",
    tags: ["决策", "方案"],
    body:
      "帮我在这几个方案之间做选择：{{方案列表}}\n\n" +
      "约束条件：{{约束条件}}\n\n" +
      "1. 先定义评估维度（成本、交付周期、可维护性、风险、可逆性），并说明权重来自哪里。\n" +
      "2. 用表格逐项打分，分数要给出理由，不要只给结论。\n" +
      "3. 指出每个方案「在什么条件下会变成更好的选择」。\n" +
      "4. 给出推荐与最关键的反对意见，明确哪些假设一旦不成立就要改选。",
  },
];

function seedPrompts(): void {
  const ts = now();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO prompts (id, title, description, body, category, icon, tags, builtin, usage_count, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
  );
  for (const p of BUILTIN_PROMPTS) {
    insert.run(p.id, p.title, p.description, p.body, p.category, p.icon, JSON.stringify(p.tags), ts, ts);
  }
}

export function seedDatabase(): void {
  ensureRoles();
  seedSkills();
  seedPrompts();

  const ownerId = ensureUser({ email: "admin@tinybuddy.dev", name: "林小满", roleKey: "owner", colorIndex: 0 });
  ensureUser({ email: "ops@tinybuddy.dev", name: "陈可", roleKey: "admin", colorIndex: 1 });
  ensureUser({ email: "dev@tinybuddy.dev", name: "Alex Chen", roleKey: "member", colorIndex: 2 });
  ensureUser({ email: "guest@tinybuddy.dev", name: "访客", roleKey: "viewer", colorIndex: 3 });

  seedKnowledge(ownerId);
  seedMemories(ownerId);
  seedConversations(ownerId);
  seedSchedule(ownerId);
  seedRuns(ownerId);
}

# TinyBuddy UI 设计规范

> 适用范围：`apps/web` 全部界面。规范里的每个数值都来自当前代码，不是设想值——
> 颜色取自 `apps/web/src/styles.css`，字号/圆角取自实际使用频次，对比度由脚本按 WCAG 2.1 公式计算。
>
> 目标：任何人拿到这份文档（含 `design-tokens.json`），不读组件源码也能做出**看起来属于同一个产品**的页面。

---

## 0. 快速上手（3 分钟）

1. 复制 `apps/web/src/styles.css` 里的 `:root` / `.dark` 变量块 + `@layer components` 组件层。
2. 把 `apps/web/tailwind.config.js` 的 `theme.extend` 整体搬过去（颜色、字体、圆角、阴影、动画）。
3. 页面骨架直接套第 7 节的三种容器之一，控件只用第 6 节的类名，**不写裸色值**。

四条硬规则，违反其中任何一条都会立刻显出「不是这个产品」：

| 规则 | 说明 |
| --- | --- |
| 颜色只走语义令牌 | 禁止 `bg-[#fff]`、`text-gray-500`；只用 `bg-surface` / `text-muted` 这类语义名 |
| 只用两个断点 | `sm`(640) 与 `lg`(1024)，不引入 `md` / `xl` / `2xl` |
| 控件圆角 14px、容器 18px | `rounded-xl` / `rounded-2xl`，不混用 4/6/10px 的中间值 |
| 边框优先于阴影 | 卡片 = 1px `border-line` + `shadow-soft`；阴影只做「浮起」暗示，不做装饰 |

---

## 1. 设计原则

**1.1 移动优先，但不是「手机版放大」**
先写 390px 下可用的布局，再用 `sm:` / `lg:` 逐级增强。桌面端的侧边栏是**增量**，不是主体；`lg` 以下全部退化为「顶部标题 + 底部四Tab + 更多面板」。

**1.2 语义色，不语义化色值**
界面只有 11 个颜色角色（`bg/surface/elevated/line/ink/muted/faint/brand/brand-soft/brand-ink` + 三态色）。暗色模式不是「反色」，而是**同一组角色重新赋值**，所以组件里一个 `dark:` 都不需要写。

**1.3 单一品牌色，靠面积控制强弱**
品牌紫只出现在：主按钮、选中态、品牌图标、链接、进度。大面积区域用 `brand-soft`（浅紫）而不是 `brand`，保证一屏只有一个视觉焦点。

**1.4 密而不挤**
信息密度偏高（12–13.5px 正文），靠 0.5px 级字号阶梯 + 4px 间距基准维持秩序；卡片内边距 16–20px，控件间距 8–12px，区块间距 20–28px。

**1.5 渐进披露**
工具调用、记忆召回、附件内容默认折叠成一行摘要，点开才展开。首屏只回答「发生了什么」，细节按需展开。

---

## 2. 颜色系统

### 2.1 令牌表

值写成 `R G B` 三元组，配合 Tailwind 的 `rgb(var(--x) / <alpha-value>)`，因此 `bg-brand/10`、`border-danger/25` 这类透明度修饰符可直接用。

| 令牌 | 角色 | 亮色 | 暗色 | 典型用途 |
| --- | --- | --- | --- | --- |
| `bg` | 画布 | `246 246 249` | `12 12 17` | 页面底色、聊天滚动区 |
| `surface` | 卡片面 | `255 255 255` | `20 20 27` | 卡片、输入框、弹窗、侧边栏 |
| `elevated` | 抬升面 | `255 255 255` | `25 25 33` | 悬浮行、Tab 底槽、代码块底、hover 背景 |
| `line` | 分隔线 | `233 233 240` | `38 38 47` | 1px 边框、分割线、Switch 关闭态 |
| `ink` | 主文字 | `23 23 29` | `236 236 242` | 标题、正文、按钮文字 |
| `muted` | 次要文字 | `106 107 118` | `155 156 168` | 描述、说明、未选中导航 |
| `faint` | 辅助文字 | `154 155 166` | `111 112 124` | 时间戳、计数、占位符、图标 |
| `brand` | 品牌 | `109 74 255` | `139 109 255` | 主按钮底、选中图标、焦点环 |
| `brand-soft` | 品牌浅底 | `240 236 255` | `33 26 61` | 选中行背景、用户气泡、图标底 |
| `brand-ink` | 品牌文字 | `75 47 208` | `196 181 255` | `brand-soft` 上的文字、正文链接 |
| `ok` | 成功 | `31 157 114` | `62 207 154` | 状态点、成功图标 |
| `warn` | 警告 | `194 117 31` | `226 164 90` | 警告点、额度提示 |
| `danger` | 危险 | `209 73 91` | `242 112 127` | 删除按钮、错误文字、危险点 |

### 2.2 对比度实测（WCAG 2.1）

| 组合 | 亮色 | 暗色 | 结论 |
| --- | --- | --- | --- |
| `ink` / `surface` | 17.85 | 15.58 | AAA |
| `ink` / `bg` | 16.54 | 16.58 | AAA |
| `muted` / `surface` | 5.28 | 6.73 | AA 正文合格 |
| `brand-ink` / `brand-soft` | 6.94 | 8.91 | AAA，选中态安全 |
| `danger` / `surface` | 4.36 | 6.46 | 亮色略低于 4.5，仅用于 ≥13px 短文本 |
| `ok` / `surface` | 3.43 | 9.25 | 只作圆点/图标，**不作正文** |
| `faint` / `surface` | **2.76** | 3.74 | 不达 AA —— 见下方约束 |
| 白字 / `brand` | 5.15 | **3.67** | 暗色主按钮仅达 AA-Large |

两条必须遵守的约束：

- **`faint` 不承载必读信息。** 它只用于时间戳、计数、占位符、禁用图标。任何「用户必须看清才能完成任务」的文字，最低用 `muted`。
- **暗色主按钮**（白字 on `#8B6DFF` = 3.67）只在 **≥14px 且 semibold** 时使用；更小的按钮文字改用 `bg-brand-ink` 底 + `text-[#12101f]`，或干脆用 `btn-outline`。

### 2.3 使用规则

| 场景 | ✅ | ❌ |
| --- | --- | --- |
| 卡片在页面上的层次 | `bg-surface` + `border-line` | `bg-white shadow-xl` |
| 强调一块区域 | `bg-brand-soft` + `text-brand-ink` | `bg-brand` + 白字大面积 |
| 危险操作 | `btn-danger`（10% 底 + 25% 边） | 实心红按钮 |
| 分隔 | `border-line` 1px | 灰色阴影条 |
| 选中态 | `bg-brand-soft text-brand-ink` + 右侧 6px 圆点 | 左侧 3px 竖条 + 加粗 |

---

## 3. 字体与排版

### 3.1 字体栈

```css
font-family: -apple-system, BlinkMacSystemFont, Inter, "Segoe UI",
             "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
font-family-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
```

顺序的理由：先命中系统 UI 字体（Mac 上 SF，Windows 上 Segoe），**中文回退放在拉丁字体之后**，保证中英混排时英文用几何感更强的 Inter/Segoe、中文用苹方/微软雅黑，而不是整段被中文字体接管。

### 3.2 字号阶梯

实际使用是 0.5px 步进的密集阶梯（9.5 → 34px），不是传统的 12/14/16/20。这让 10.5px 的元信息与 11.5px 的标签能拉开层次，代价是**必须按语义取值，不能随手写**。

| 尺寸 | 语义 | 字重 / 行高 | 用在哪 |
| --- | --- | --- | --- |
| 34px | 营销标题 | 600 / 1.2 | 登录页左侧 hero |
| 26px | 页面主标题 | 600 / tight | `PageHeader` 的 h1（`sm` 以上） |
| 22px | 页面主标题（移动） | 600 / tight | 同上，`sm` 以下 |
| 16px | 弹窗标题 | 600 | `Modal` 标题 |
| 15px | 强调正文 | 500–650 | Markdown 正文、空状态标题、Logo |
| 14.5px | 聊天气泡正文 | 400 / relaxed | 用户消息 |
| 14px | 按钮（大） | 500 | 登录提交按钮 `h-11` |
| 13.5px | 导航项、描述 | 500 / relaxed | 侧边栏项、页面副标题、Toast |
| 13px | 控件文字 | 500 | 按钮、Tab、输入值、卡片标题 |
| 12.5px | 次级控件 | 400–500 | 小按钮、行内链接 |
| 12px | 标签、作者名 | 500 | `.label`、消息作者、徽章 |
| 11.5px | 元信息 | 400–500 | 附件名、提示语、分享有效期 |
| 11px | 微标签 | 500 | `.chip`、记忆徽章、工具状态 |
| 10.5px | 极小字 | 500 | 底部导航文字、Logo 副标、工具元信息 |
| 9.5–10px | 装饰性 | 400–500 | 计数、代码块 copy 按钮 |

规则：**同一层级内相邻两级最多差 1px**；跨层至少差 2px，否则层次会糊。

### 3.3 排版细节

| 属性 | 值 | 说明 |
| --- | --- | --- |
| 字距 | 标题 `tracking-tight`（-0.01em）；`.label` 用 `tracking-wide` | 大字号收紧，小字号（全大写）放宽 |
| 大写标签 | `text-[12px] uppercase tracking-wide text-faint` | 仅用于 `.label`；中文下不上大写，靠字重区分 |
| 数字 | 计数/耗时用 `font-mono` | 表格与统计里数字等宽，避免跳动 |
| 正文行高 | 1.72（`.md-body`） | 中文正文需要比英文更松 |
| 段落间距 | `0.65em`，标题上 `1.1em` / 下 `0.5em` | 见 `.md-body` 定义 |
| 断词 | `word-break: break-word` | 长 URL、无空格中文混排必须加 |

### 3.4 Markdown 正文（`.md-body`）

这套样式同时用于助回答、知识库详情、分享页，属于「内容排版」而非「界面排版」，单独成层：

- 字号 15px / 行高 1.72，`h1 1.25em` `h2 1.12em` `h3 1.02em`，字重 650
- 行内代码：`0.86em`，`faint` 14% 透明底，圆角 5px
- 代码块：**固定深色** `#0f0f16` / 文字 `#e8e8f0`，圆角 12px，13px/1.6，横向滚动——亮色模式下也保持深色，形成「终端」质感
- 引用：左侧 3px 品牌色 55% 透明描边 + 5% 品牌底 + 右侧圆角
- 表格：`display:block` + 横向滚动，单元格 7×10px 内边距，表头 `bg-elevated`
- 链接：`brand-ink` + 下划线 + `underline-offset: 2px`

---

## 4. 间距、圆角、阴影

### 4.1 间距（4px 基准）

| 关系 | 值 | 典型场景 |
| --- | --- | --- |
| 图标 ↔ 文字 | 6–10px (`gap-1.5` / `gap-2` / `gap-2.5`) | 按钮、导航、chip |
| 控件内部 | 垂直 8–10px，水平 12–14px (`px-3.5 py-2`) | 按钮、输入框 |
| 卡片内边距 | 16–20px (`p-4` / `p-5`) | 卡片、弹窗正文 |
| 列表项间距 | 2–8px (`gap-0.5` ~ `gap-2`) | 导航、会话列表 |
| 区块间距 | 20–28px (`mb-5` / `mt-7`) | 页头到内容、表单分组 |
| 页面内边距 | 移动 12–16px，桌面 24px (`px-3` → `sm:px-6`) | 所有页面容器 |

### 4.2 圆角

| 类 | 值 | 用在哪 |
| --- | --- | --- |
| `rounded-lg` | 8px | 行内小方块、Tab 内部、代码 copy 按钮 |
| `rounded-xl` | **14px** | **所有控件**：按钮、输入框、导航项、图标按钮、工具卡 |
| `rounded-2xl` | **18px** | **所有容器**：卡片、聊天气泡、Toast、附件卡 |
| `rounded-3xl` | 24px | 弹窗（移动端只圆上两角） |
| `rounded-full` | 999 | chip、头像、状态点、Switch、有效期标签 |

记忆口诀：**控件 14、容器 18、胶囊 full**。用户气泡用 `rounded-2xl rounded-br-md`（右下角 6px）指向说话人。

### 4.3 阴影

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `shadow-soft` | `0 1px 2px rgba(16,16,24,.04), 0 8px 24px -12px rgba(16,16,24,.12)` | 卡片、输入区 |
| `shadow-lift` | `0 2px 4px rgba(16,16,24,.04), 0 16px 40px -16px rgba(16,16,24,.2)` | 弹窗、Toast、下拉菜单 |

规则：**阴影只用于「浮在页面上」的元素**。平铺卡片靠边框区分即可；暗色下阴影几乎不可见，层次改由 `surface → elevated` 的明度差承担（这也是为什么暗色的 `elevated` 比 `surface` 亮 5 个灰度）。

> 已知不一致：`--shadow-color` 变量在两个主题里都定义了，但 `boxShadow` 里写的是固定 `rgba(16,16,24,…)`。若要暗色阴影更自然，把阴影改成 `rgb(var(--shadow-color) / .12)` 之类；当前不做，是因为暗色下本来就不该靠阴影。

---

## 5. 动效

| 名称 | 值 | 用途 |
| --- | --- | --- |
| `fade-up` | `.28s cubic-bezier(.2,.8,.2,1) both`，`translateY(6px)` → 0 | 页面进入、弹窗、Toast、列表首屏 |
| `pulse-soft` | `1.4s ease-in-out infinite`，透明度 1 → .35 | 打字光标、运行中状态 |
| `transition` | Tailwind 默认 150ms `cubic-bezier(.4,0,.2,1)` |  hover、颜色、边框 |
| `active:scale-[.98]` | 按下缩放 2% | 所有按钮（`.btn` 内置） |
| `animate-ping` | 1s 无限 | `StatusDot` 的 ok 态外圈 |

原则：**动效只解释状态变化，不做表演**。进入用 `fade-up` 且位移不超过 6px；hover 只改颜色/边框，不改尺寸（避免布局抖动）；所有可点元素都有按下反馈。

> 缺口：当前未实现 `prefers-reduced-motion` 降级。建议在全局加
> `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }`。

---

## 6. 组件规范

所有组件类都在 `styles.css` 的 `@layer components` 里，页面里**只写语义类名**，不重复拼装原子类。

### 6.1 按钮

| 类 | 外观 | 用途 |
| --- | --- | --- |
| `.btn-primary` | 品牌底 + 白字 + `hover:brightness-110` | 一屏最多一个 |
| `.btn-outline` | `surface` 底 + `line` 边 + `ink` 字 | 次要操作、取消 |
| `.btn-ghost` | 透明底，hover 才出 `elevated` | 工具栏、图标旁文字 |
| `.btn-danger` | `danger/10` 底 + `danger/25` 边 + `danger` 字 | 删除、撤销分享 |

共同基类 `.btn`：`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium`，高度约 36px，`active:scale-[.98]`，`disabled:opacity-50 disabled:pointer-events-none`。

尺寸变体：默认 36px；登录主按钮 `h-11`（44px）；小号 `px-2.5 py-1.5 text-[11.5px]`（约 28px，仅用于卡片内联操作）。

### 6.2 图标按钮

`.icon-btn` = 36×36px，`rounded-xl`，默认 `text-muted`，hover 出 `elevated` 底 + `ink` 字。用于页头操作、弹窗关闭、语言/主题切换。

> 触控热区：36px 是视觉尺寸，移动端关键操作（底栏、发送）实际热区 40–48px。低于 36px 的图标按钮不允许出现。

### 6.3 表单

```html
<label class="mb-3.5 block">
  <span class="label">名称</span>
  <input class="input" />
  <span class="mt-1 block text-[11.5px] leading-relaxed text-faint">说明文字</span>
</label>
```

- `.input`：`rounded-xl border-line bg-surface px-3.5 py-2.5 text-sm`，聚焦时 `border-brand/50` + `ring-4 ring-brand/10`（不是 outline，避免布局位移）
- `.label`：12px / 500 / `uppercase tracking-wide` / `faint`，下边距 6px
- 用 `Field` 组件包一层，保证 label / hint 的间距一致
- 错误态：整块 `rounded-xl border-danger/25 bg-danger/10 px-3 py-2 text-[12.5px] text-danger`，放在提交按钮上方

### 6.4 卡片

`.card` = `rounded-2xl border border-line bg-surface shadow-soft`。

变体：可点击卡片加 `transition hover:border-faint/60 hover:bg-elevated/40`；强调卡片用 `border-brand/30 bg-brand-soft/40`；虚线空态用 `border-dashed`。

### 6.5 Chip / 徽章

`.chip` = 11px / 500 / `rounded-full` / `border-line` / `bg-elevated` / `text-muted`。
语义变体：品牌 `border-brand/20 bg-brand-soft/60 text-brand-ink`；成功 `bg-ok/10 text-ok`；危险 `bg-danger/10 text-danger`。高度 20px，用于「MCP」「已启用」「长期有效」这类状态。

### 6.6 状态与开关

- `StatusDot`：8px 圆点，`ok / warn / danger / idle` 四态；ok 额外加一层 `animate-ping` 外圈表示「在线」
- `Switch`：38×22px 胶囊，滑块 16px，开 `bg-brand` / 关 `bg-line`，位移 16px

### 6.7 Tabs

`inline-flex rounded-xl border border-line bg-elevated p-1` 作底槽；选中项 `bg-surface text-ink shadow-sm`，未选中 `text-muted hover:text-ink`；项内 `px-3.5 py-1.5 text-[13px]`，可带计数（11px `faint`）。

### 6.8 Modal

- 层级 `z-[80]`，遮罩 `bg-black/40 backdrop-blur-[2px]`
- **移动端从底部升起**（`items-end` + `rounded-t-3xl`），桌面居中（`sm:items-center` + `sm:rounded-3xl`）
- 宽度：默认 `sm:max-w-lg`，`wide` 为 `sm:max-w-2xl`；高度上限 `90vh`，正文区独立滚动
- 结构：头部（16px 标题 + 关闭按钮）/ 正文（`px-5 pb-6 pt-4`）/ 页脚（`border-t bg-elevated/60 px-5 py-3`，按钮右对齐，带 `safe-bottom`）
- 行为：`Esc` 关闭、打开时锁 `body` 滚动、点遮罩关闭

### 6.9 Toast

顶部居中（移动）/ 右上角（桌面），`z-[100]`，最大同时 3 条。样式：`rounded-2xl border-line bg-surface/95 shadow-lift backdrop-blur`，17px 图标 + 13.5px 文字。成功/信息 3.2s，错误 5.2s 自动消失，可手动关闭。

### 6.10 空状态

`.EmptyState`：虚线边框容器 + 48px 品牌浅底图标块（`rounded-2xl bg-brand-soft text-brand`）+ 15px 标题 + 13px 说明（`max-w-sm`）+ 可选操作按钮。垂直内边距 56px，居中对齐。

### 6.11 页头

`PageHeader`：标题 22px（`sm` 26px）/ 600 / `tracking-tight`；副标题 13.5px `muted`、行高 relaxed；右侧操作区 `shrink-0`；小屏纵向堆叠，`sm` 起左右分布。下边距 20px。

### 6.12 导航

| 区域 | 规格 |
| --- | --- |
| 侧边栏 | 宽 **252px**，`bg-surface/60` + 右侧 1px 边框；Logo 区 20px 内边距；导航项 13.5px / 500，高约 34px，激活态 `bg-brand-soft text-brand-ink` + 图标 2.2 描边 + 右侧 6px 圆点 |
| 顶栏（移动） | 高 48px（`sm` 56px），`bg-bg/90 backdrop-blur`，左 Logo + 当前页名，右语言/主题 |
| 底栏（移动） | 4 个主入口 + 「更多」，图标 20px、文字 10.5px，激活态顶部 2px×24px 品牌短横 + 图标加粗 |
| 更多面板 | `MoreSheet` 用 Modal，网格 2 列，每项 12px 内边距 + 图标 + 13px 文字 |
| 侧滑抽屉 | 宽 82% / 最大 320px，`animate-fade-up`，含完整导航 + 用户卡 |

导航按权限过滤：`NAV_ITEMS` 里声明 `permission`，无权限的入口**直接不渲染**（不是禁用置灰）。

### 6.13 聊天专属

| 组件 | 规格 |
| --- | --- |
| 用户气泡 | `bg-brand-soft`，`rounded-2xl rounded-br-md`，14.5px / relaxed，右对齐，`max-w-[85%] sm:max-w-[75%]`，内边距 16×10px |
| 助手消息 | **无气泡**，左对齐，28px 渐变头像（`#8b6dff → #5b3ae0`，圆角 9px）+ 12px 作者名 + 正文 15px |
| 工具卡 | 整行可点，`rounded-xl border-line`，时间/状态 10.5px，状态用 9px spinner 或 ✓；展开后 input/output 各一块 11px 等宽 `pre`，`bg-elevated`，最大高 40/56（10rem/14rem） |
| 记忆徽章 | 胶囊 11px，`border-brand/20 bg-brand-soft/60 text-brand-ink`，展开列出召回片段（11.5px） |
| 输入区 | 外层 `rounded-2xl border-line bg-surface shadow-soft`，聚焦 `border-brand/40 ring-4 ring-brand/10`；底部固定，`bg-bg/80 backdrop-blur`，`safe-bottom` |
| 斜杠面板 | 绝对定位在输入框上方（`bottom-full`），`max-h-[320px]`，方向键 + Enter 选择、Esc 关闭 |
| 消息操作 | 复制 / 编辑 / 重新生成，高 24px、11px 文字，hover 才显形（移动端常显） |

聊天列宽 **760px**，是全站最窄的容器——为了行长控制在 40–55 个中文字符。

### 6.14 命令面板

| 项 | 规格 |
| --- | --- |
| 层级 | 遮罩 `z-[90]`（高于弹窗 80、低于 Toast 100），`bg-black/40 backdrop-blur-[2px]` |
| 容器 | `max-w-xl`，`max-h-[76vh]`，`rounded-2xl` + `shadow-lift`，顶部距 6vh（`sm` 10vh） |
| 输入行 | 高 48px，左侧 16px 搜索图标，右侧 `ESC` 键帽 |
| 结果行 | 图标块 26×26（选中时 `bg-surface text-brand`），标题 13px，副标 10px，片段 11px 单行截断 |
| 分组标题 | 10px / 500 / `uppercase tracking-[0.1em]` / `faint`，上下 2.5 / 0.5 |
| 选中态 | `bg-brand-soft/70` + 标题转 `brand-ink` + 右侧 13px 箭头 |
| 页脚 | 11px `faint`，左侧「↵ 打开」、右侧「⌘K 随时唤起」 |

行为：输入防抖 160ms 并取消上一次请求；↑↓ 才触发滚动，鼠标悬停只改选中态；空输入展示「快捷操作 + 最近会话」。

### 6.15 模板卡

`card p-4` 竖排：32px 品牌浅底图标块 + 13.5px 标题 + 内置徽章 + 分类 10.5px；描述固定两行（`line-clamp-2` + `min-h-[34px]`，保证同排卡片底部对齐）；标签用 10px 圆角小方块；底部左「使用 N 次」、右「查看 / 使用 / 复制」，主操作「使用」用 `bg-brand-soft text-brand-ink` 的 28px 高小按钮。

---

## 7. 布局与响应式

### 7.1 断点策略

只使用两个断点：

| 断点 | 宽度 | 形态 |
| --- | --- | --- |
| 默认 | < 640px | 单列；顶栏 48px + 底部导航；弹窗为底部抽屉 |
| `sm` | ≥ 640px | 内边距 24px；弹窗居中；消息操作 hover 显形；卡片可两列 |
| `lg` | ≥ 1024px | 出现 252px 侧边栏；顶栏与底栏隐藏 |

不引入 `md`/`xl`：中间态在这一类「聊天为主」的产品里没有真实场景，多一个断点就多一套需要维护的布局。

### 7.2 页面容器

| 页面 | 最大宽度 | 内边距 |
| --- | --- | --- |
| 对话 `/chat` | `760px` | `px-3 py-4 sm:px-6 sm:py-6` |
| 分享页 `/s/:token` | `860px` | `px-3 pb-16 sm:px-6` |
| 设置 `/settings` | `max-w-3xl`（768） | `px-4 py-5 sm:px-6 sm:py-7` |
| 审计 / 成员 / 定时 | `max-w-4xl`（896） | 同上 |
| 技能 / 知识 / MCP / 记忆 | `max-w-5xl`（1024） | 同上 |
| 用量 `/usage` | `1100px` | 同上 + `lg:pb-8` |

选择逻辑：**读长文 → 窄**，**看列表 → 中**，**看图表/网格 → 宽**。

### 7.3 应用外壳

```
<div class="flex h-[100dvh] overflow-hidden">
  <Sidebar/>              // lg 才显示，252px
  <div class="flex flex-1 flex-col min-w-0">
      <MobileHeader/>     // lg 以下
      <main class="flex-1 min-h-0 overflow-hidden"><Outlet/></main>
      <BottomNav/>        // lg 以下
  </div>
</div>
```

- 用 `h-[100dvh]` 而非 `h-screen`，规避移动浏览器地址栏伸缩
- 滚动交给内部容器（`.scroll-thin`），页面本身不滚
- 顶部/底部安全区用 `.safe-top` / `.safe-bottom`（`env(safe-area-inset-*)`）
- 对话页自带 header，`Layout` 检测到 `/chat` 前缀时**不再叠加**全局顶栏，避免双标题

---

## 8. 暗色模式

- 策略：`darkMode: "class"`，根节点加 `.dark`；三档（亮/暗/跟随系统）由 `useTheme` 管理，持久化在 `localStorage.tb.theme`
- **组件里不写 `dark:`**，只换令牌值。整个项目 `dark:` 前缀只出现在少数「必须反色」的地方（如代码块边框）
- 暗色不是简单反色：`bg` 12/12/17 比纯黑略暖，`surface` 20/20/27，`elevated` 25/25/33（每层 +5）；`brand` 提亮到 `#8B6DFF` 保证在深底上够亮；`brand-soft` 变成深紫 `33 26 61`
- 阴影在暗色下几乎无效，层次靠明度差与 1px 边框
- 代码块在暗色下底色再降一档（`#08080c`）并补 1px 边框，避免与卡片糊在一起

---

## 9. 可访问性

现状与要求：

| 项 | 现状 | 要求 |
| --- | --- | --- |
| 语义化 | 大量 `div` + `onClick` | 可点元素必须是 `button` / `a`，或补 `role` + 键盘处理 |
| 焦点可见 | 输入框有 ring，按钮**没有**显式 focus ring | 建议全局加 `:focus-visible { outline: 2px solid rgb(var(--brand)); outline-offset: 2px; }` |
| 键盘 | Modal `Esc` 关闭、斜杠命令 ↑↓/Enter/Esc | 弹窗需补焦点陷阱与初始焦点 |
| 对比度 | 见 2.2 | `faint` 不用作正文；暗色主按钮注意字号 |
| 热区 | 图标按钮 36px | 移动端关键操作 ≥ 40px |
| 状态播报 | 流式输出无 `aria-live` | 建议给消息区加 `aria-live="polite"`，或提供「停止朗读」开关 |
| 动效 | 无 reduced-motion 降级 | 见第 5 节补丁 |

---

## 10. 国际化排版

- 文案全部走 `t("namespace.key")`，**组件里不出现中文字面量**
- 两种语言共用同一套字号；英文平均长 30%，因此：按钮不设固定宽度（用 `whitespace-nowrap` + padding），标签容器用 `min-w-0` + `truncate`
- 中文不需要 `uppercase`，`.label` 的 `tracking-wide` 在中文下表现为字距略松，可接受；**不要给中文加 `uppercase`**
- 数字、时间、字节用 `Intl`（`formatBytes` / `formatTime`）而不是手拼
- 日期分组（今天/昨天/更早）由语言包提供，避免硬编码

---

## 11. 复用清单

新页面提交前逐条对照：

- [ ] 容器选了 7.2 里的某一档，移动端 `px-4`、桌面 `sm:px-6`
- [ ] 页头用 `PageHeader`，标题/副标题字号没改
- [ ] 所有颜色来自语义令牌，没有 `#hex` / `gray-*`
- [ ] 控件圆角 `rounded-xl`，容器 `rounded-2xl`，没有 4/6/10px 混入
- [ ] 主按钮一屏只有一个，危险操作用 `btn-danger`
- [ ] 空列表用 `EmptyState`，加载用 `Spinner`，错误用 Toast（不弹 `alert`）
- [ ] 有权限要求的入口按 `can()` 过滤
- [ ] 所有文案进语言包，中英各一份
- [ ] 390px 宽度下无横向滚动（`document.scrollWidth === clientWidth`）
- [ ] 暗色下逐屏看过一遍，没有「白卡片浮在深底上」

代码骨架：

```tsx
export function XxxPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7">
      <PageHeader
        title={t("xxx.title")}
        subtitle={t("xxx.subtitle")}
        actions={<button className="btn-primary">{t("common.new")}</button>}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.id} className="card p-4 transition hover:border-faint/60">
            <div className="text-[13.5px] font-medium text-ink">{it.name}</div>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{it.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 12. 附录

| 内容 | 位置 |
| --- | --- |
| 颜色/字号/圆角/阴影令牌（JSON） | [`design-tokens.json`](./design-tokens.json) |
| 可视化样式手册 | [`styleguide.html`](./styleguide.html)（浏览器直接打开，支持明暗切换） |
| CSS 变量与组件层源码 | `apps/web/src/styles.css` |
| Tailwind 主题扩展 | `apps/web/tailwind.config.js` |
| 通用组件实现 | `apps/web/src/components/ui.tsx` |
| 导航清单 | `apps/web/src/components/nav.ts` |
| 聊天组件 | `apps/web/src/components/chat/` |

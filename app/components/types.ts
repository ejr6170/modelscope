export interface ToolInput {
  command?: string; description?: string; file?: string; content?: string;
  lines?: number; oldString?: string; newString?: string; replaceAll?: boolean;
  pattern?: string; path?: string; outputMode?: string; type?: string; query?: string;
  background?: boolean;
  [key: string]: unknown;
}

export interface LineHunk { startLine: number; lineCount: number; }
export interface LineInfo { startLine: number; endLine: number; hunks: LineHunk[]; }

export interface ToolUse {
  tool: string; id: string; input: ToolInput | null;
  callerType?: string; readSource?: string;
  isSubagent?: boolean; subagentType?: string; subagentDesc?: string; subagentBackground?: boolean;
  lineInfo?: LineInfo;
}

export interface SessionEvent {
  uuid: string; timestamp: string; type: string; role?: string; model?: string;
  thinking?: string[]; text?: string[]; toolUses?: ToolUse[];
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUSD?: number; stopReason?: string | null;
  toolResults?: { toolUseId: string; content: string; isError: boolean }[];
  isSidechain?: boolean; agentId?: string; isSubagentEvent?: boolean;
}

export interface ModelBreakdown { model: string; tokens: number; pct: number; }
export interface PlanInfo { subscriptionType: string; rateLimitTier: string; }

export interface CursorMetrics {
  totalHashes: number;
  composerHashes: number;
  humanHashes: number;
  aiPercentage: number;
  activeModel: string;
  trackingSince: string | null;
  dailyActivity: { date: string; composer: number; human: number }[];
  topFiles: { fileName: string; fileExtension: string; count: number }[];
  commits: { commitHash: string; commitMessage: string; commitDate: string; linesAdded: number; linesDeleted: number; composerLinesAdded: number; humanLinesAdded: number; aiPercentage: number }[];
}

export interface Metrics {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number; turns: number; toolCalls: number;
  elapsed: number; velocity: number; startTime: number;
  hourlyTurns: number; topFiles: { file: string; count: number }[];
  errorCount: number; activeSubagents: { id: string; type: string; desc: string; startTime: string }[];
  plan?: PlanInfo; modelBreakdown?: ModelBreakdown[];
  usage?: { sessionPercent: number | null; weeklyPercent: number | null; sonnetPercent: number | null; resetAt: string | null; resetLabel: string | null; lastUpdated: string | null; source: string };
  rollingVelocity?: number;
  efficiencyRatio?: number;
  costHistory?: { timestamp: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cost: number; model: string }[];
  rateLimitHistory?: { timestamp: string; status: string; resetsAt: string }[];
  cursorMetrics?: CursorMetrics | null;
}

export interface SessionInfo { sessionId: string; project: string; startedAt: string; }
export interface PinnedError { id: string; timestamp: string; content: string; toolUseId: string; }

export interface ProjectInfo {
  id: string;
  name: string;
  lastActive: string | null;
  lastActiveMtime: number;
  isLive: boolean;
  sessionCount: number;
}

export type CardKind = "thought" | "reply" | "code" | "tool" | "user" | "error" | "subagent" | "read";

export interface FeedCard {
  id: string; kind: CardKind; timestamp: string; text?: string;
  filename?: string; code?: string; diff?: { removed: string; added: string };
  toolName?: string; toolSummary?: string; model?: string;
  subagentType?: string; subagentDesc?: string; isNested?: boolean; agentId?: string;
  readSource?: string;
  isError?: boolean;
  fullPath?: string;
  lineInfo?: LineInfo;
  isNewFile?: boolean;
  turnTokens?: number;
  turnCost?: number;
  turnInputTokens?: number;
  turnOutputTokens?: number;
  rationale?: string;
  subagentMission?: string;
}

export interface DetectedConcept { key: string; title: string; def: string; firstCardId: string; }

export interface HudSettings {
  glassOpacity: number;
  blurIntensity: "none" | "low" | "high";
  sidebarShadows: boolean;
  hotspotsEnabled: boolean;
  rationaleAutoExpand: boolean;
  tooltipDelay: number;
  sessionBudget: number;
  inputRate: number;
  outputRate: number;
  alwaysOnTop: boolean;
  simpleHotspots: boolean;
  autoSnipeLargeFiles: boolean;
}

export interface AgentNode {
  id: string;
  type: string;
  desc: string;
  startTime: string;
  background?: boolean;
  status: "active" | "done" | "failed";
  result?: string;
  isError?: boolean;
}

export interface HwMetrics {
  cpu: { percent: number };
  memory: { usedGB: number; totalGB: number; percent: number };
  gpu: { available: boolean; name?: string; utilPercent?: number; vramUsedMB?: number; vramTotalMB?: number; tempC?: number } | null;
  processes: { pid: number; name: string; cpuPercent: number; memoryMB: number; parentPid: number }[];
}

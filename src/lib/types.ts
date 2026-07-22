export type Period = "1h" | "6h" | "1d" | "7d";
/**
 * Widget look:
 * - `site` (default) — inherit host page font/color (mimics the publisher site)
 * - `light` / `dark` — self-contained Google News–style palettes
 *
 * Legacy `auto` is accepted on write and normalizes to `site`.
 */
export type Theme = "site" | "light" | "dark";
/** Theme field on write; "auto" is a legacy alias for "site". */
export type ThemeInput = Theme | "auto";
/** active = served+cron; paused = user stop; inactive = system idle (no traffic). */
export type WidgetStatus = "active" | "paused" | "inactive";

const THEME_INPUTS = new Set<string>(["site", "light", "dark", "auto"]);

export function isThemeInput(raw: unknown): raw is ThemeInput {
  return typeof raw === "string" && THEME_INPUTS.has(raw);
}

/** Map any accepted/legacy value to a stored Theme. Unknown → site. */
export function normalizeTheme(raw: string | undefined | null): Theme {
  if (raw === "light" || raw === "dark") return raw;
  return "site";
}

export function isUserStatus(raw: unknown): raw is "active" | "paused" {
  return raw === "active" || raw === "paused";
}

/** D1 may return 0/1 or boolean-ish for INTEGER flags. */
export function asBool(raw: unknown, fallback = false): boolean {
  if (raw === true || raw === 1 || raw === "1") return true;
  if (raw === false || raw === 0 || raw === "0") return false;
  return fallback;
}

export interface WidgetRow {
  id: string;
  public_id: string;
  admin_token_hash: string;
  /** Stored as `name`; API exposes as `title`. */
  name: string | null;
  query: string;
  period: Period;
  num_results: number;
  widget_limit: number;
  theme: Theme;
  status: WidgetStatus;
  borderless: number;
  show_summaries: number;
  /** Last Exa Search request id (for ops/debug). */
  last_run_id: string | null;
  last_synced_at: string | null;
  /** Last embed presence (throttled). */
  last_seen_at: string | null;
  /** ISO timestamp while a refresh is running (overlap lock). */
  sync_locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWidgetBody {
  query: string;
  period?: Period;
  numResults?: number;
  widgetLimit?: number;
  theme?: ThemeInput;
  /** Preferred; section title in the widget. */
  title?: string;
  /** @deprecated use title */
  name?: string;
  borderless?: boolean;
  showSummaries?: boolean;
  /**
   * Optional client access key. If set, the new widget is bound to this key
   * (same key can manage several widgets). If omitted, a new key is generated.
   */
  accessToken?: string;
}

export interface PatchWidgetBody {
  query?: string;
  period?: Period | null;
  numResults?: number;
  widgetLimit?: number;
  theme?: ThemeInput;
  /** User may only set active | paused (not inactive). */
  status?: "active" | "paused";
  title?: string;
  /** @deprecated use title */
  name?: string;
  borderless?: boolean;
  showSummaries?: boolean;
}

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  publishedDate: string | null;
  summary: string | null;
  highlights: string[];
  source: string | null;
  seenAt: string;
}

export interface FeedSnapshot {
  publicId: string;
  query: string;
  /** Optional section title (null/omit = no header). */
  title?: string | null;
  theme: Theme;
  widgetLimit: number;
  borderless?: boolean;
  showSummaries?: boolean;
  updatedAt: string;
  items: FeedItem[];
}

/**
 * Domain search hit — normalized after Exa Search (or any future provider).
 * Provider-specific shapes stay inside the client module.
 */
export interface SearchHit {
  title?: string;
  url?: string;
  publishedDate?: string;
  summary?: string;
  highlights?: string[];
  text?: string;
  author?: string;
}

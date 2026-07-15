export type Period = "1h" | "6h" | "1d" | "7d";
export type Theme = "light" | "dark" | "auto";
export type WidgetStatus = "active" | "paused";

export interface WidgetRow {
  id: string;
  public_id: string;
  admin_token_hash: string;
  name: string | null;
  query: string;
  period: Period;
  num_results: number;
  widget_limit: number;
  theme: Theme;
  status: WidgetStatus;
  last_run_id: string | null;
  last_synced_at: string | null;
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
  theme?: Theme;
  name?: string;
}

export interface PatchWidgetBody {
  query?: string;
  period?: Period | null;
  numResults?: number;
  widgetLimit?: number;
  theme?: Theme;
  status?: WidgetStatus;
  name?: string;
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
  theme: Theme;
  widgetLimit: number;
  updatedAt: string;
  items: FeedItem[];
}

export interface ExaSearchResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  summary?: string;
  highlights?: string[] | string;
  text?: string;
  author?: string;
}

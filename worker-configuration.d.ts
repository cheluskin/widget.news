interface Env {
  DB: D1Database;
  FEEDS: R2Bucket;
  ASSETS: Fetcher;
  /** Workers AI binding for article summaries */
  AI: Ai;
  EXA_API_KEY: string;
  PUBLIC_BASE_URL: string;
  FEED_BASE_URL: string;
  FEED_CAP: string;
  /** Optional CF API token for cache purge (prod) */
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
  /**
   * Root token — full system control (list/edit all widgets).
   * Distinct from per-widget client access keys (admin_token_hash).
   */
  ROOT_TOKEN?: string;
}

/**
 * HSMC Local DB Client
 *
 * This is the self-hosted SQLite API client.
 * All existing imports continue to work — the local db
 * client is API-compatible with the local DB query builder.
 *
 * Import: import { supabase } from "@/integrations/db/client";
 */
import { localDb } from "@/integrations/local-db/client";
export const supabase = localDb;

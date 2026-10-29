import type { StatusCard } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { queryKeys } from "@/api/queryKeys";
import { statusCardsApi } from "@/api/status-cards";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { cardIsBusy } from "./status-model";

/*
 * The status cards' queries. A card's state also changes on the server's own schedule (the update
 * engine counts pending changes and pauses cards without logging activity), and a run's end isn't
 * always logged, so lists with a card setting up or updating poll every 5 seconds; the rest follow
 * the live events (`status_card` activity refreshes everything under `["status-cards"]`).
 */

const BUSY_POLL_MS = 5_000;

/** Whether the instance has status cards on; undefined until the settings arrive. */
export function useStatusCardsEnabled(): () => boolean | undefined {
  const experimental = useExperimentalSettingsQuery();
  return () => (experimental.data ? experimental.data.enableStatusCards === true : undefined);
}

export function useCardsQuery(archived: () => boolean, enabled: () => boolean = () => true) {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.statusCards.list(company().id, archived()),
    queryFn: ({ signal }) => statusCardsApi.list(company().id, archived(), signal),
    enabled: enabled(),
    refetchInterval: (query: { state: { data?: StatusCard[] } }) => (query.state.data?.some(cardIsBusy) ? BUSY_POLL_MS : false),
  }));
}

/** One card, for a link to a card that isn't in the loaded lists. */
export function useCardQuery(id: () => string | null) {
  return createQuery(() => ({
    queryKey: queryKeys.statusCards.detail(id() ?? ""),
    queryFn: ({ signal }) => statusCardsApi.get(id()!, signal),
    enabled: id() !== null,
    retry: false,
    refetchInterval: (query: { state: { data?: StatusCard } }) => (query.state.data && cardIsBusy(query.state.data) ? BUSY_POLL_MS : false),
  }));
}

export function useUpdatesQuery(id: () => string, options: { enabled?: () => boolean; poll?: () => boolean } = {}) {
  return createQuery(() => ({
    queryKey: queryKeys.statusCards.updates(id()),
    queryFn: ({ signal }) => statusCardsApi.updates(id(), signal),
    enabled: options.enabled?.() ?? true,
    refetchInterval: options.poll?.() ? BUSY_POLL_MS : false,
  }));
}

export function useRevisionsQuery(id: () => string, enabled: () => boolean) {
  return createQuery(() => ({
    queryKey: queryKeys.statusCards.summaryRevisions(id()),
    queryFn: ({ signal }) => statusCardsApi.summaryRevisions(id(), signal),
    enabled: enabled(),
  }));
}

export function useDryRunQuery(id: () => string, enabled: () => boolean) {
  return createQuery(() => ({
    queryKey: queryKeys.statusCards.dryRun(id()),
    queryFn: ({ signal }) => statusCardsApi.dryRun(id(), signal),
    enabled: enabled(),
    retry: false,
  }));
}

/** Refresh every status-card query after a change (the lists, the card, its ledger and revisions). */
export function useRefreshCards() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.statusCards.all });
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { v4 as uuidV4 } from "uuid";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient";
import { AUTH_STATUS, useAuth } from "./AuthContext";
import { HOUSEHOLD_STATUS, useHousehold } from "./HouseholdContext";
import { getBooksKey } from "../booksKey";
import { decryptDocument, encryptDocument } from "../booksCrypto";

/**
 * A chronological log of household mutations, for the couple's activity feed.
 *
 * Sits between the infrastructure layers (HouseholdProvider/SyncProvider) and
 * AppProviders, so the store contexts below it can call `useActivity().logActivity`
 * without knowing anything about encryption or Supabase directly.
 *
 * Each entry is written by a store context's mutator after a successful state
 * update — fire-and-forget, so a failed log write never surfaces to the user or
 * rolls back the mutation. The payload is sealed under the household MK before
 * leaving the client, so the server learns only the `action_type` and timestamp.
 *
 * Real-time: subscribes to INSERT events on `activity_log` for the active
 * household. New entries from a partner appear within seconds of them writing.
 * Optimistic-local entries use a client-generated UUID; the realtime handler
 * deduplicates by ID so they appear exactly once.
 *
 * Inert when Supabase is unconfigured, the user is not signed in, or the
 * household is not yet resolved — `logActivity` is a no-op and `entries` is
 * empty. This keeps the test suite unaffected (no AuthProvider above it).
 */
export const ActivityContext = createContext();

export function useActivity() {
  return useContext(ActivityContext);
}

export const ActivityProvider = ({ children }) => {
  const { status: authStatus, userId } = useAuth();
  const { activeHouseholdId, status: householdStatus } = useHousehold() ?? {};

  const remote =
    authStatus === AUTH_STATUS.SIGNED_IN &&
    isSupabaseConfigured &&
    Boolean(userId) &&
    householdStatus === HOUSEHOLD_STATUS.READY &&
    Boolean(activeHouseholdId);

  const [entries, setEntries] = useState([]);
  const [ready, setReady] = useState(false);

  // Client-generated IDs that have already been added optimistically. The
  // realtime handler skips any row whose id is here to prevent double-counting.
  const optimisticIds = useRef(new Set());

  // -------------------------------------------------------------------------
  // Load the last 50 entries whenever the active household changes.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!remote) {
      setEntries([]);
      setReady(false);
      optimisticIds.current.clear();
      return undefined;
    }

    let active = true;
    setReady(false);

    (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, user_id, action_type, payload, created_at")
        .eq("household_id", activeHouseholdId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!active || error) {
        if (active) setReady(true);
        return;
      }

      const bk = getBooksKey();
      if (!bk || bk.householdId !== activeHouseholdId) {
        if (active) setReady(true);
        return;
      }

      const decrypted = [];
      for (const row of data ?? []) {
        if (!active) return;
        const result = await decryptDocument(bk.mk, row.payload);
        if (result.ok) {
          decrypted.push({
            id: row.id,
            userId: row.user_id,
            actionType: row.action_type,
            createdAt: row.created_at,
            ...result.value,
          });
        }
      }

      if (!active) return;
      setEntries(decrypted);
      setReady(true);
    })();

    return () => {
      active = false;
    };
  }, [remote, activeHouseholdId]);

  // -------------------------------------------------------------------------
  // Realtime — new entries from any member appear live.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!remote || !activeHouseholdId) return undefined;

    const supabase = getSupabase();
    const channel = supabase
      .channel(`activity:${activeHouseholdId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_log",
          filter: `household_id=eq.${activeHouseholdId}`,
        },
        async (event) => {
          const row = event.new;
          // Skip entries this client already added optimistically.
          if (optimisticIds.current.has(row.id)) return;

          const bk = getBooksKey();
          if (!bk) return;
          const result = await decryptDocument(bk.mk, row.payload);
          if (!result.ok) return;

          setEntries((prev) => {
            if (prev.some((e) => e.id === row.id)) return prev;
            return [
              {
                id: row.id,
                userId: row.user_id,
                actionType: row.action_type,
                createdAt: row.created_at,
                ...result.value,
              },
              ...prev,
            ].slice(0, 50);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [remote, activeHouseholdId]);

  // -------------------------------------------------------------------------
  // logActivity — called by store contexts after successful mutations.
  // -------------------------------------------------------------------------
  const logActivity = useCallback(
    async (actionType, payload) => {
      const bk = getBooksKey();
      if (!bk || !userId || !bk.householdId) return;

      const supabase = getSupabase();
      if (!supabase) return;

      const enc = await encryptDocument(bk.mk, bk.kid, payload);
      if (!enc.ok) return;

      const id = uuidV4();
      optimisticIds.current.add(id);

      // Optimistic add — the user sees their own action immediately.
      setEntries((prev) =>
        [
          {
            id,
            userId,
            actionType,
            createdAt: new Date().toISOString(),
            ...payload,
          },
          ...prev,
        ].slice(0, 50)
      );

      // Fire and forget — a log failure never surfaces or rolls back the mutation.
      supabase.from("activity_log").insert({
        id,
        household_id: bk.householdId,
        user_id: userId,
        action_type: actionType,
        payload: enc.envelope,
      });
    },
    [userId]
  );

  const value = useMemo(
    () => ({ entries, ready, logActivity }),
    [entries, ready, logActivity]
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
};

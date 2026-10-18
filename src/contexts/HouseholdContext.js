import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidV4 } from "uuid";
import { getSupabase, isSupabaseConfigured } from "../supabaseClient";
import { AUTH_STATUS, useAuth } from "./AuthContext";
import { IDENTITY_STATUS, useIdentityKey } from "./IdentityKeyContext";
import {
  BOOKS_KEY_CACHE_KEY,
  getStorageScope,
  householdScope,
  readKey,
  removeKey,
  setStorageScope,
  writeKey,
} from "../storage";
import {
  exportMasterKey,
  importMasterKey,
  importPublicKey,
  newMasterKey,
  unwrapKeyWith,
  wrapKeyFor,
} from "../booksCrypto";
import { clearBooksKey, getBooksKey, setBooksKey } from "../booksKey";

/**
 * The households a person belongs to, which one is active, and the master key
 * that opens it.
 *
 * The second of the two layers that replaced the single-household key gate.
 * `IdentityKeyContext` above it holds the personal keypair the books password
 * guards; this turns that keypair into access to a *shared budget*. A household
 * is a first-class thing now — several people can belong to one, with a role —
 * and its master key is wrapped once per member's public key, so a member opens
 * it with their own private key and no shared passphrase ever exists.
 *
 * It resolves the active household's master key four ways, in order: a cache on
 * this device; the `household_keys` wrap, opened with the private key; the old
 * `app_crypto` master key **adopted** on a first migrated load (same key, same
 * `kid`, so no document is re-encrypted); or, for a brand-new household this
 * person owns, a freshly minted key. A member with no wrap yet — invited but not
 * granted — lands in `NO_ACCESS` and waits.
 *
 * Once resolved it calls `setBooksKey(mk, kid, householdId)`, the module-state
 * handoff `receipts.js` and `SyncContext.flush` read through, exactly as the old
 * key context did — so nothing below this layer had to learn about households.
 *
 * Inert whenever sync is (unconfigured, guest, local-only): `status` is `ready`
 * and it simply renders its children.
 */
export const HouseholdContext = createContext();

export function useHousehold() {
  return useContext(HouseholdContext);
}

export const HOUSEHOLD_STATUS = Object.freeze({
  /** Loading memberships, or resolving the active household's key. */
  CHECKING: "checking",
  /** The active household's key is in force; the books can load. */
  READY: "ready",
  /** A member of the active household, but no key wrap for this person yet. */
  NO_ACCESS: "noAccess",
  /** Something went wrong loading memberships or a key. */
  ERROR: "error",
});

export const ROLES = Object.freeze({ OWNER: "owner", EDITOR: "editor", VIEWER: "viewer" });

/** Where the active-household choice is remembered — under the user's scope,
 *  because it is a fact about the person, not about any one household. */
const ACTIVE_HOUSEHOLD_KEY = "activeHousehold";

function bracket(scope, run) {
  const previous = getStorageScope();
  setStorageScope(scope);
  try {
    return run();
  } finally {
    setStorageScope(previous);
  }
}

const readActive = (userId) => bracket(userId, () => readKey(ACTIVE_HOUSEHOLD_KEY)) ?? null;
const writeActive = (userId, hid) => bracket(userId, () => writeKey(ACTIVE_HOUSEHOLD_KEY, hid));

const readMkCache = (scope) => bracket(scope, () => readKey(BOOKS_KEY_CACHE_KEY));
const writeMkCache = (scope, cached) => bracket(scope, () => writeKey(BOOKS_KEY_CACHE_KEY, cached));
const dropMkCache = (scope) => bracket(scope, () => removeKey(BOOKS_KEY_CACHE_KEY));

export const HouseholdProvider = ({ children }) => {
  const { status: authStatus, userId } = useAuth();
  const identity = useIdentityKey();

  const remote =
    authStatus === AUTH_STATUS.SIGNED_IN &&
    isSupabaseConfigured &&
    Boolean(userId) &&
    identity.status === IDENTITY_STATUS.UNLOCKED;

  const [status, setStatus] = useState(remote ? HOUSEHOLD_STATUS.CHECKING : HOUSEHOLD_STATUS.READY);
  const [error, setError] = useState(null);
  /** [{ householdId, name, role }] — the households this person belongs to. */
  const [memberships, setMemberships] = useState([]);
  const [activeHouseholdId, setActiveHouseholdId] = useState(null);
  /** The active household's roster — [{ userId, role }] — and its open invites. */
  const [members, setMembers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  /** Bumped by a mutator to force the loader to re-read memberships. */
  const [reloadToken, setReloadToken] = useState(0);

  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current += 1;
    return () => { lifetime.current += 1; };
  }, [remote, userId]);

  const { privateKey, publicKey, legacyMk, legacyPresent } = identity;

  /**
   * Put a resolved master key in force for a household: cache it on this device
   * and hand it to the module-state holder every reader shares.
   */
  const installKey = useCallback(
    (mk, kid, hid, rawForCache) => {
      const scope = householdScope(userId, hid);
      if (rawForCache) writeMkCache(scope, { raw: rawForCache, kid });
      setBooksKey(mk, kid, hid);
    },
    [userId]
  );

  /**
   * Resolve and install the master key for one household. Returns the resulting
   * status (`READY` / `NO_ACCESS` / `ERROR`). See the module comment for the
   * four ways in and their order.
   */
  const resolveKey = useCallback(
    async (hid, role, isCurrent) => {
      const supabase = getSupabase();
      const scope = householdScope(userId, hid);

      const { data: keyRow, error: keyError } = await supabase
        .from("household_keys")
        .select("kid, wrapped_mk")
        .eq("household_id", hid)
        .eq("user_id", userId)
        .maybeSingle();
      if (!isCurrent()) return null;
      if (keyError) {
        setError(keyError.message ?? "Could not load this household's key.");
        return HOUSEHOLD_STATUS.ERROR;
      }

      if (keyRow) {
        // 1. This device's cache, trusted only when its kid matches the wrap.
        const cache = readMkCache(scope);
        if (cache && cache.kid === keyRow.kid && typeof cache.raw === "string") {
          const mk = await importMasterKey(cache.raw);
          if (!isCurrent()) return null;
          if (mk.ok) {
            installKey(mk.key, keyRow.kid, hid, null);
            return HOUSEHOLD_STATUS.READY;
          }
        }
        // 2. The wrap, opened with this person's private key.
        const mk = await unwrapKeyWith(privateKey, keyRow.wrapped_mk);
        if (!isCurrent()) return null;
        if (!mk.ok) {
          setError("Your key could not open this household's books.");
          return HOUSEHOLD_STATUS.ERROR;
        }
        const raw = await exportMasterKey(mk.key);
        if (!isCurrent()) return null;
        installKey(mk.key, keyRow.kid, hid, raw.ok ? raw.raw : null);
        return HOUSEHOLD_STATUS.READY;
      }

      // No wrap for this person yet.
      // 3. A migrated account adopts its old master key — same key, same kid, so
      //    every existing document still decrypts.
      if (legacyMk) {
        const wrapped = await wrapKeyFor(legacyMk.mk, publicKey);
        if (!isCurrent()) return null;
        if (!wrapped.ok) {
          setError(wrapped.error);
          return HOUSEHOLD_STATUS.ERROR;
        }
        const { error: insertError } = await supabase
          .from("household_keys")
          .upsert(
            { household_id: hid, user_id: userId, kid: legacyMk.kid, wrapped_mk: wrapped.wrapped },
            { onConflict: "household_id,user_id" }
          );
        if (!isCurrent()) return null;
        if (insertError) {
          setError(insertError.message ?? "Could not save your household key.");
          return HOUSEHOLD_STATUS.ERROR;
        }
        const raw = await exportMasterKey(legacyMk.mk);
        if (!isCurrent()) return null;
        installKey(legacyMk.mk, legacyMk.kid, hid, raw.ok ? raw.raw : null);
        return HOUSEHOLD_STATUS.READY;
      }

      // An old account whose key we have not recovered yet — wait for a password
      // unlock rather than minting a fresh key over books sealed under the old
      // one.
      if (legacyPresent) {
        setError("Unlock with your books password to finish moving your books to this device.");
        return HOUSEHOLD_STATUS.NO_ACCESS;
      }

      // 4. A brand-new household this person owns and whose key-write did not
      //    land yet: mint one. Safe only because such a household has no
      //    documents under any other key.
      if (role === ROLES.OWNER) {
        const mk = await newMasterKey();
        const kid = uuidV4();
        const wrapped = await wrapKeyFor(mk, publicKey);
        if (!isCurrent()) return null;
        if (!wrapped.ok) {
          setError(wrapped.error);
          return HOUSEHOLD_STATUS.ERROR;
        }
        const { error: insertError } = await supabase
          .from("household_keys")
          .upsert(
            { household_id: hid, user_id: userId, kid, wrapped_mk: wrapped.wrapped },
            { onConflict: "household_id,user_id" }
          );
        if (!isCurrent()) return null;
        if (insertError) {
          setError(insertError.message ?? "Could not save your household key.");
          return HOUSEHOLD_STATUS.ERROR;
        }
        const raw = await exportMasterKey(mk);
        if (!isCurrent()) return null;
        installKey(mk, kid, hid, raw.ok ? raw.raw : null);
        return HOUSEHOLD_STATUS.READY;
      }

      // Invited, not yet granted — an existing member will complete the wrap
      // the next time one is online.
      return HOUSEHOLD_STATUS.NO_ACCESS;
    },
    [userId, privateKey, publicKey, legacyMk, legacyPresent, installKey]
  );

  const loadMemberships = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error: membersError } = await supabase
      .from("household_members")
      .select("household_id, role, households(name)")
      .eq("user_id", userId);
    if (membersError) return { ok: false, error: membersError.message };
    const list = (data ?? []).map((r) => ({
      householdId: r.household_id,
      role: r.role,
      name: r.households?.name ?? "Household",
    }));
    return { ok: true, list };
  }, [userId]);

  /** Create a household (the atomic RPC), mint its master key, and make it active. */
  const createHousehold = useCallback(
    async (name) => {
      if (!remote) return { ok: false, error: "This build has no account server configured." };
      if (!publicKey) return { ok: false, error: "Unlock your books first." };
      const supabase = getSupabase();

      const { data: hid, error: rpcError } = await supabase.rpc("create_household", {
        p_name: name ?? "My household",
      });
      if (rpcError || !hid) return { ok: false, error: rpcError?.message ?? "Could not create the household." };

      const mk = await newMasterKey();
      const kid = uuidV4();
      const wrapped = await wrapKeyFor(mk, publicKey);
      if (!wrapped.ok) return { ok: false, error: wrapped.error };
      const { error: keyError } = await supabase
        .from("household_keys")
        .upsert({ household_id: hid, user_id: userId, kid, wrapped_mk: wrapped.wrapped }, { onConflict: "household_id,user_id" });
      if (keyError) return { ok: false, error: keyError.message ?? "Could not save the household key." };

      const raw = await exportMasterKey(mk);
      clearBooksKey();
      installKey(mk, kid, hid, raw.ok ? raw.raw : null);
      setStatus(HOUSEHOLD_STATUS.CHECKING);
      writeActive(userId, hid);
      setActiveHouseholdId(hid);
      setReloadToken((n) => n + 1);
      return { ok: true, householdId: hid };
    },
    [remote, userId, publicKey, installKey]
  );

  // ---------------------------------------------------------------------
  // Load memberships and resolve the active household's key.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!remote) {
      setStatus(HOUSEHOLD_STATUS.READY);
      setMemberships([]);
      setActiveHouseholdId(null);
      return undefined;
    }
    if (!privateKey) return undefined;

    let active = true;
    const started = lifetime.current;
    const isCurrent = () => active && lifetime.current === started;
    setStatus(HOUSEHOLD_STATUS.CHECKING);
    setError(null);

    (async () => {
      const loaded = await loadMemberships();
      if (!isCurrent()) return;
      if (!loaded.ok) {
        setError(loaded.error ?? "Could not load your households.");
        setStatus(HOUSEHOLD_STATUS.ERROR);
        return;
      }

      // A brand-new account with no household yet gets one, unprompted.
      if (loaded.list.length === 0) {
        if (legacyPresent && !legacyMk) {
          setError("Unlock with your books password to finish moving your books to this device.");
          setStatus(HOUSEHOLD_STATUS.NO_ACCESS);
          return;
        }
        const created = await createHousehold("My household");
        if (!isCurrent()) return;
        if (!created.ok) {
          setError(created.error);
          setStatus(HOUSEHOLD_STATUS.ERROR);
        }
        return; // createHousehold set active + bumped reloadToken; the next pass renders it.
      }

      setMemberships(loaded.list);

      const persisted = readActive(userId);
      const chosen =
        loaded.list.find((m) => m.householdId === activeHouseholdId) ??
        loaded.list.find((m) => m.householdId === persisted) ??
        loaded.list[0];

      if (chosen.householdId !== activeHouseholdId) {
        writeActive(userId, chosen.householdId);
        setActiveHouseholdId(chosen.householdId);
        return; // re-runs with the chosen active id.
      }

      const resolved = await resolveKey(chosen.householdId, chosen.role, isCurrent);
      if (!isCurrent() || resolved === null) return;
      setStatus(resolved);
    })();

    return () => {
      active = false;
    };
    // `createHousehold`/`resolveKey`/`loadMemberships` are stable enough; the
    // meaningful triggers are a sign-in, a key unlock, a switch, a recovered
    // legacy key, and an explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, userId, privateKey, activeHouseholdId, legacyMk, reloadToken]);

  /** Switch which household is active. Clears the in-force key first so the sync
   *  layer below cancels the old household's work, then re-resolves. */
  const switchActive = useCallback(
    (hid) => {
      if (hid === activeHouseholdId) return;
      clearBooksKey();
      setStatus(HOUSEHOLD_STATUS.CHECKING);
      writeActive(userId, hid);
      setActiveHouseholdId(hid);
    },
    [activeHouseholdId, userId]
  );

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  // ---------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------

  /** Wrap the active household's master key for one recipient and record their
   *  membership. The crux of sharing: it happens on a member's device, never
   *  the server, because the server never has the key. */
  const grantTo = useCallback(
    async (recipientUserId, recipientSpki, hid, role) => {
      const supabase = getSupabase();
      const key = getBooksKey();
      if (!key) return { ok: false, error: "Unlock this household's books first." };

      const pub = await importPublicKey(recipientSpki);
      if (!pub.ok) return { ok: false, error: "That person's key could not be read." };
      const wrapped = await wrapKeyFor(key.mk, pub.key);
      if (!wrapped.ok) return { ok: false, error: wrapped.error };

      const { error: keyError } = await supabase
        .from("household_keys")
        .upsert(
          { household_id: hid, user_id: recipientUserId, kid: key.kid, wrapped_mk: wrapped.wrapped },
          { onConflict: "household_id,user_id" }
        );
      if (keyError) return { ok: false, error: keyError.message ?? "Could not grant access." };

      const { error: memberError } = await supabase
        .from("household_members")
        .upsert({ household_id: hid, user_id: recipientUserId, role }, { onConflict: "household_id,user_id" });
      if (memberError) return { ok: false, error: memberError.message ?? "Could not add the member." };
      return { ok: true };
    },
    []
  );

  /**
   * Invite someone by email. If they already have a key, wrap this household's
   * master key for them at once; otherwise park a pending invite that any member
   * completes later (see `completePendingInvites`).
   */
  const invite = useCallback(
    async ({ email, role }) => {
      if (!remote || !activeHouseholdId) return { ok: false, error: "Open a household first." };
      const supabase = getSupabase();
      const hid = activeHouseholdId;
      const trimmed = (email ?? "").trim();
      if (!trimmed) return { ok: false, error: "Enter an email address." };
      if (!Object.values(ROLES).includes(role)) return { ok: false, error: "Choose a role." };

      const { data, error: lookupError } = await supabase.rpc("lookup_public_key", { p_email: trimmed });
      if (lookupError) return { ok: false, error: lookupError.message ?? "Could not look up that person." };
      const found = Array.isArray(data) ? data[0] : data;

      if (found?.user_id && found?.public_key) {
        const granted = await grantTo(found.user_id, found.public_key, hid, role);
        if (!granted.ok) return granted;
        setReloadToken((n) => n + 1);
        return { ok: true, pending: false };
      }

      // No key yet — park the invite for completion once they set one up.
      const { error: inviteError } = await supabase
        .from("household_invites")
        .upsert(
          { household_id: hid, invitee_email: trimmed.toLowerCase(), role, invited_by: userId },
          { onConflict: "household_id,invitee_email" }
        );
      if (inviteError) return { ok: false, error: inviteError.message ?? "Could not send the invite." };
      return { ok: true, pending: true };
    },
    [remote, activeHouseholdId, userId, grantTo]
  );

  /**
   * Complete any pending invites whose invitee now has a key — the honest cost
   * of end-to-end sharing, run whenever a member with the key is online.
   */
  const completePendingInvites = useCallback(async () => {
    if (!remote || !activeHouseholdId) return { ok: true, completed: 0 };
    const supabase = getSupabase();
    const hid = activeHouseholdId;
    const { data: invites, error: invitesError } = await supabase
      .from("household_invites")
      .select("id, invitee_email, role")
      .eq("household_id", hid);
    if (invitesError) return { ok: false, error: invitesError.message };

    let completed = 0;
    for (const inv of invites ?? []) {
      const { data } = await supabase.rpc("lookup_public_key", { p_email: inv.invitee_email });
      const found = Array.isArray(data) ? data[0] : data;
      if (!found?.user_id || !found?.public_key) continue;
      const granted = await grantTo(found.user_id, found.public_key, hid, inv.role);
      if (granted.ok) {
        await supabase.from("household_invites").delete().eq("id", inv.id);
        completed += 1;
      }
    }
    if (completed > 0) setReloadToken((n) => n + 1);
    return { ok: true, completed };
  }, [remote, activeHouseholdId, grantTo]);

  const setRole = useCallback(
    async (memberUserId, role) => {
      if (!remote || !activeHouseholdId) return { ok: false, error: "Open a household first." };
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("household_members")
        .update({ role })
        .eq("household_id", activeHouseholdId)
        .eq("user_id", memberUserId);
      if (updateError) return { ok: false, error: updateError.message ?? "Could not change the role." };
      setReloadToken((n) => n + 1);
      return { ok: true };
    },
    [remote, activeHouseholdId]
  );

  const removeMember = useCallback(
    async (memberUserId) => {
      if (!remote || !activeHouseholdId) return { ok: false, error: "Open a household first." };
      const supabase = getSupabase();
      const hid = activeHouseholdId;
      // Drop their key wrap first, then their membership. Their cached copy of
      // the books cannot be clawed back — rotate the key (see `rotateKey`) to cut
      // off someone who has already seen it.
      await supabase.from("household_keys").delete().eq("household_id", hid).eq("user_id", memberUserId);
      const { error: removeError } = await supabase
        .from("household_members")
        .delete()
        .eq("household_id", hid)
        .eq("user_id", memberUserId);
      if (removeError) return { ok: false, error: removeError.message ?? "Could not remove the member." };
      setReloadToken((n) => n + 1);
      return { ok: true };
    },
    [remote, activeHouseholdId]
  );

  const renameHousehold = useCallback(
    async (name) => {
      if (!remote || !activeHouseholdId) return { ok: false, error: "Open a household first." };
      const trimmed = (name ?? "").trim();
      if (!trimmed) return { ok: false, error: "Enter a name." };
      const supabase = getSupabase();
      const { error: renameError } = await supabase
        .from("households")
        .update({ name: trimmed })
        .eq("id", activeHouseholdId);
      if (renameError) return { ok: false, error: renameError.message ?? "Could not rename the household." };
      setReloadToken((n) => n + 1);
      return { ok: true };
    },
    [remote, activeHouseholdId]
  );

  const leaveHousehold = useCallback(async () => {
    if (!remote || !activeHouseholdId) return { ok: false, error: "Open a household first." };
    const supabase = getSupabase();
    const hid = activeHouseholdId;
    await supabase.from("household_keys").delete().eq("household_id", hid).eq("user_id", userId);
    const { error: leaveError } = await supabase
      .from("household_members")
      .delete()
      .eq("household_id", hid)
      .eq("user_id", userId);
    if (leaveError) return { ok: false, error: leaveError.message ?? "Could not leave the household." };
    dropMkCache(householdScope(userId, hid));
    clearBooksKey();
    writeActive(userId, null);
    setActiveHouseholdId(null);
    setReloadToken((n) => n + 1);
    return { ok: true };
  }, [remote, activeHouseholdId, userId]);

  /**
   * Rotate the active household's master key — a fresh MK and `kid`, re-wrapped
   * for every current member. The real cut-off for a removed member who has
   * already seen the key: their old wrap is gone and the new key is one they
   * never held. The caller must then re-seal every document under the new key
   * (`SyncContext.resync`), which is why this returns the new key in force
   * rather than doing the re-seal itself — `SyncContext` is below this layer.
   */
  const rotateKey = useCallback(async () => {
    if (!remote || !activeHouseholdId) return { ok: false, error: "Open a household first." };
    if (!publicKey) return { ok: false, error: "Unlock your books first." };
    const supabase = getSupabase();
    const hid = activeHouseholdId;

    const mk = await newMasterKey();
    const kid = uuidV4();

    // We cannot read other members' public keys from `user_keys` (own-row RLS),
    // so re-wrap for ourselves now and re-grant the survivors from their email on
    // the next reconcile. Self first, so the rotation never locks us out.
    const selfWrap = await wrapKeyFor(mk, publicKey);
    if (!selfWrap.ok) return { ok: false, error: selfWrap.error };

    const { error: writeError } = await supabase
      .from("household_keys")
      .upsert({ household_id: hid, user_id: userId, kid, wrapped_mk: selfWrap.wrapped }, { onConflict: "household_id,user_id" });
    if (writeError) return { ok: false, error: writeError.message ?? "Could not rotate the key." };

    // Remove every other member's stale wrap so a removed member's cached key is
    // useless against new writes; survivors are re-granted on the next reconcile.
    await supabase.from("household_keys").delete().eq("household_id", hid).neq("user_id", userId);

    const raw = await exportMasterKey(mk);
    installKey(mk, kid, hid, raw.ok ? raw.raw : null);
    return { ok: true };
  }, [remote, activeHouseholdId, userId, publicKey, installKey]);

  // The active household's roster and open invites, for the Household panel.
  // Kept apart from the key-resolving loader above so a refresh of the member
  // list never re-runs an unwrap.
  useEffect(() => {
    if (!remote || status !== HOUSEHOLD_STATUS.READY || !activeHouseholdId) {
      setMembers([]);
      setPendingInvites([]);
      return undefined;
    }
    let active = true;
    (async () => {
      const supabase = getSupabase();
      const [{ data: roster }, { data: invites }] = await Promise.all([
        supabase.from("household_members").select("user_id, role").eq("household_id", activeHouseholdId),
        supabase.from("household_invites").select("id, invitee_email, role").eq("household_id", activeHouseholdId),
      ]);
      if (!active) return;
      setMembers((roster ?? []).map((r) => ({ userId: r.user_id, role: r.role })));
      setPendingInvites((invites ?? []).map((i) => ({ id: i.id, email: i.invitee_email, role: i.role })));
    })();
    return () => {
      active = false;
    };
  }, [remote, status, activeHouseholdId, reloadToken]);

  const activeMembership = memberships.find((m) => m.householdId === activeHouseholdId) ?? null;

  const value = useMemo(
    () => ({
      status,
      error,
      memberships,
      members,
      pendingInvites,
      activeHouseholdId,
      activeHousehold: activeMembership,
      role: activeMembership?.role ?? null,
      switchActive,
      reload,
      createHousehold,
      invite,
      completePendingInvites,
      setRole,
      removeMember,
      renameHousehold,
      leaveHousehold,
      rotateKey,
    }),
    [
      status,
      error,
      memberships,
      members,
      pendingInvites,
      activeHouseholdId,
      activeMembership,
      switchActive,
      reload,
      createHousehold,
      invite,
      completePendingInvites,
      setRole,
      removeMember,
      renameHousehold,
      leaveHousehold,
      rotateKey,
    ]
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
};

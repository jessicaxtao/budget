#!/usr/bin/env node
/**
 * Dev seed: two test users sharing one household.
 *
 * Needs in .env.local:
 *   REACT_APP_SUPABASE_URL=https://...
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...   ← service role key, NOT the anon key
 *
 * Run:
 *   node --env-file=.env.local scripts/seedHousehold.mjs
 *
 * Idempotent: re-running leaves both users and the household in place.
 * The household key is re-generated on each run if the users already exist
 * but had no household — run it once and you're done.
 */

import { createClient } from "@supabase/supabase-js";
import { v4 as uuid } from "uuid";

// ---------------------------------------------------------------------------
// Crypto helpers (adapted from src/booksCrypto.js — same algorithms, same
// encoding, so the app can open anything this script writes).
// ---------------------------------------------------------------------------

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fromb64(str) {
  return new Uint8Array(Buffer.from(str, "base64"));
}

// Lower iterations for seed data only — still correct, just faster.
// The app reads the stored kdf field and uses these same values when unlocking.
const SEED_KDF = { alg: "PBKDF2", hash: "SHA-256", iterations: 10000 };

async function deriveKek(secret, salt) {
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromb64(salt),
      iterations: SEED_KDF.iterations,
      hash: SEED_KDF.hash,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function newSalt() {
  return b64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

async function newIdentityKeyPair() {
  return globalThis.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["wrapKey", "unwrapKey"]
  );
}

async function exportSpki(publicKey) {
  return b64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", publicKey)));
}

async function wrapPrivateKey(kek, privateKey) {
  const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", privateKey));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, pkcs8);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return b64(out);
}

async function newMasterKey() {
  return globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function wrapMkFor(mk, recipientPublicKey) {
  const wrapped = await globalThis.crypto.subtle.wrapKey(
    "raw",
    mk,
    recipientPublicKey,
    { name: "RSA-OAEP" }
  );
  return b64(new Uint8Array(wrapped));
}

// ---------------------------------------------------------------------------
// Seed config
// ---------------------------------------------------------------------------

const HOUSEHOLD_NAME = "The Canopy Household";

const USERS = [
  {
    email: "alice@canopy.test",
    authPassword: "alicebooks1234",
    booksPassword: "alicebooks1234",
    role: "owner",
    label: "Alice (owner)",
  },
  {
    email: "bob@canopy.test",
    authPassword: "bobbooks1234",
    booksPassword: "bobbooks1234",
    role: "editor",
    label: "Bob (editor)",
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.REACT_APP_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "\nMissing environment variables.\n" +
        "Add these to .env.local:\n" +
        "  REACT_APP_SUPABASE_URL=https://...\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=eyJ...\n"
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // -------------------------------------------------------------------------
  // 1. Auth users
  // -------------------------------------------------------------------------
  console.log("Creating auth users…");
  const userIds = {};

  for (const u of USERS) {
    // Check if already there before creating.
    const { data: { users: existing } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const found = existing?.find((x) => x.email === u.email);

    if (found) {
      userIds[u.email] = found.id;
      console.log(`  ${u.label} already exists — ${found.id}`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: u.authPassword,
        email_confirm: true,
      });
      if (error) {
        console.error(`  Failed to create ${u.label}:`, error.message);
        process.exit(1);
      }
      userIds[u.email] = data.user.id;
      console.log(`  Created ${u.label} — ${data.user.id}`);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Identity keypairs (RSA-OAEP 3072)
  // -------------------------------------------------------------------------
  console.log("\nGenerating RSA-OAEP keypairs (this takes a moment)…");
  const pairs = await Promise.all(USERS.map(() => newIdentityKeyPair()));
  console.log("  Done.");

  // -------------------------------------------------------------------------
  // 3. user_keys rows — private key wrapped under the books password
  // -------------------------------------------------------------------------
  console.log("\nWriting user_keys rows…");
  const publicKeys = [];

  for (let i = 0; i < USERS.length; i++) {
    const u = USERS[i];
    const pair = pairs[i];
    const userId = userIds[u.email];

    const salt = newSalt();
    const kek = await deriveKek(u.booksPassword, salt);
    const wrappedPrivate = await wrapPrivateKey(kek, pair.privateKey);
    const spki = await exportSpki(pair.publicKey);
    publicKeys.push(pair.publicKey); // keep the CryptoKey for wrapMkFor below

    const { error } = await supabase.from("user_keys").upsert(
      {
        user_id: userId,
        public_key: spki,
        kdf: SEED_KDF,
        password_salt: salt,
        password_wrap: wrappedPrivate,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error(`  user_keys for ${u.label}:`, error.message);
      process.exit(1);
    }
    console.log(`  ${u.label} — saved`);
  }

  // -------------------------------------------------------------------------
  // 4. Household
  // -------------------------------------------------------------------------
  console.log("\nCreating household…");

  const aliceId = userIds[USERS[0].email];
  const bobId = userIds[USERS[1].email];

  // Check if these two users already share a household; skip creating a new one.
  const { data: aliceMemberships } = await supabase
    .from("household_members")
    .select("household_id, households(name)")
    .eq("user_id", aliceId);

  const { data: bobMemberships } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", bobId);

  const bobHhIds = new Set((bobMemberships ?? []).map((m) => m.household_id));
  const shared = (aliceMemberships ?? []).find((m) => bobHhIds.has(m.household_id));

  let householdId;

  if (shared) {
    householdId = shared.household_id;
    const name = shared.households?.name ?? householdId;
    console.log(`  Already sharing "${name}" — ${householdId}`);
  } else {
    householdId = uuid();
    const { error: hhErr } = await supabase.from("households").insert({
      id: householdId,
      name: HOUSEHOLD_NAME,
      created_by: aliceId,
    });
    if (hhErr) {
      console.error("  households insert:", hhErr.message);
      process.exit(1);
    }

    const { error: membersErr } = await supabase.from("household_members").insert([
      { household_id: householdId, user_id: aliceId, role: "owner" },
      { household_id: householdId, user_id: bobId, role: "editor" },
    ]);
    if (membersErr) {
      console.error("  household_members insert:", membersErr.message);
      process.exit(1);
    }
    console.log(`  Created "${HOUSEHOLD_NAME}" — ${householdId}`);
  }

  // -------------------------------------------------------------------------
  // 5. Household master key, wrapped once per member
  // -------------------------------------------------------------------------
  console.log("\nMinting household master key…");

  const { data: existingKeys } = await supabase
    .from("household_keys")
    .select("user_id")
    .eq("household_id", householdId);

  const alreadyHasKey = (existingKeys ?? []).some((k) => k.user_id === aliceId);

  if (alreadyHasKey) {
    console.log("  Household key already exists — skipping.");
  } else {
    const mk = await newMasterKey();
    const kid = uuid();

    const [aliceWrapped, bobWrapped] = await Promise.all([
      wrapMkFor(mk, publicKeys[0]),
      wrapMkFor(mk, publicKeys[1]),
    ]);

    const { error: keyErr } = await supabase.from("household_keys").insert([
      { household_id: householdId, user_id: aliceId, kid, wrapped_mk: aliceWrapped },
      { household_id: householdId, user_id: bobId, kid, wrapped_mk: bobWrapped },
    ]);
    if (keyErr) {
      console.error("  household_keys insert:", keyErr.message);
      process.exit(1);
    }
    console.log("  Master key written for both members.");
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Seed complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Household: ${HOUSEHOLD_NAME}

 Sign in as Alice (owner)
   Email:          alice@canopy.test
   Password:       alicebooks1234
   Books password: alicebooks1234   ← same, for simplicity

 Sign in as Bob (editor)
   Email:          bob@canopy.test
   Password:       bobbooks1234
   Books password: bobbooks1234

 After signing in, go to Settings to see the Household
 sharing panel with both members listed.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});

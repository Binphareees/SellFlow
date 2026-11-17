#!/usr/bin/env node
/**
 * SellFlow pilot seeder — onboarding for real Phase 0 participants.
 *
 * This script is deliberately NOT a demo seeder. It creates exactly what a real
 * supplier + reseller pair needs to start using SellFlow:
 *
 *   User -> Profile -> BUSINESS_OWNER + SUPPLIER/RESELLER roles
 *        -> BusinessWorkspace -> SupplierProfile (supplier only)
 *        -> 3-5 published ProductListings with public retail prices
 *        -> private ResellerOffer versions with wholesale prices
 *        -> an APPROVED reseller application and ACTIVE, pre-approved agreements
 *
 * Safety rules:
 *   - Interactive by default; every write is confirmed by typing "create".
 *   - Aborts if either email already exists. Never updates or deletes accounts.
 *   - All writes happen in one transaction, so a failure leaves no half-onboarded pair.
 *   - Passwords are hashed with src/lib/auth/password.ts (bcrypt, cost 12) and are
 *     never printed, logged, or written by this script.
 *   - Money enters as Naira text and is converted to integer kobo via
 *     src/lib/money.ts. No floats are stored.
 *
 * Usage:
 *   npm run pilot:seed
 *   npm run pilot:seed -- --dry-run
 *   npm run pilot:seed -- --config ./pilot-pair.json --yes
 *
 * A config file can supply the answers for repeatable/automated runs. Keep it
 * private (chmod 600) because it may contain participant passwords. Passwords
 * may also come from PILOT_SUPPLIER_PASSWORD / PILOT_RESELLER_PASSWORD, or be
 * prompted for interactively if omitted.
 *
 * Run through tsx (already a dev dependency) so the TypeScript auth/money
 * helpers are the single source of truth:
 *   npx tsx scripts/seed-pilot.mjs
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { PrismaClient } from "@prisma/client";

import { hashPassword, PASSWORD_RULES } from "../src/lib/auth/password.ts";
import { formatMoney, parseMoneyToMinor } from "../src/lib/money.ts";

const prisma = new PrismaClient();

const MIN_PRODUCTS = 3;
const MAX_PRODUCTS = 5;
const MAX_KOBO = 2_147_483_647; // Prisma Int / SQLite INTEGER ceiling
const DEFAULT_APP_URL = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

const TIER_LABEL = {
  0: "Unverified",
  1: "Contact verified",
  2: "Business reviewed",
  3: "Fully verified",
};

const DELIVERY_RESPONSIBILITY = ["SUPPLIER", "RESELLER", "SPLIT"];
const CUSTOMER_DATA_VISIBILITY = ["NONE", "ORDER_ONLY", "FULL"];

const NG_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
];

const STATE_ALIASES = new Map([
  ["abuja", "FCT"],
  ["fct", "FCT"],
  ["f.c.t", "FCT"],
  ["federal capital territory", "FCT"],
  ["akwa-ibom", "Akwa Ibom"],
  ["cross-river", "Cross River"],
]);

class ValidationError extends Error {}
class InputEndedError extends Error {}

function fail(message) {
  throw new ValidationError(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

function usage(exitCode = 0) {
  output.write(`SellFlow pilot seeder

Onboards one real supplier + one real reseller, with a 3-5 item catalogue and
pre-approved private wholesale agreements. No demo data is created.

Usage:
  npm run pilot:seed
  npm run pilot:seed -- --dry-run
  npm run pilot:seed -- --config ./pilot-pair.json --yes

Options:
  --dry-run           Validate everything and print the plan, write nothing
  --yes, -y           Skip the final "create" confirmation (use with --config)
  --config <file>     Read answers from a JSON file instead of prompting
  --help, -h          Show this help

Environment:
  DATABASE_URL                  Target database (Prisma also reads .env)
  PILOT_SUPPLIER_PASSWORD       Supplier password, instead of prompting
  PILOT_RESELLER_PASSWORD       Reseller password, instead of prompting
  NEXT_PUBLIC_APP_URL           Base URL printed in the summary

Config shape (all money fields are Naira text, never kobo):
{
  "supplier": {
    "email": "...", "password": "...", "displayName": "...",
    "businessName": "...", "phone": "0803...", "addressLine": "...",
    "city": "Kano", "state": "Kano", "verificationTier": 2,
    "about": "...", "verificationEvidence": "..."
  },
  "products": [
    {
      "title": "...", "sku": "...", "category": "...", "description": "...",
      "unit": "piece", "publicPriceNaira": "15000",
      "resellerPriceNaira": "12000", "minResalePriceNaira": "14000",
      "moq": 6, "stockQty": 40
    }
  ],
  "reseller": {
    "email": "...", "password": "...", "displayName": "...",
    "businessName": "...", "phone": "0806...", "city": "...",
    "state": "...", "verificationTier": 1, "businessSummary": "..."
  },
  "agreement": {
    "paymentTermsDays": 0,
    "deliveryResponsibility": "SUPPLIER",
    "advertisingPermission": true,
    "customerDataVisibility": "ORDER_ONLY",
    "notes": "..."
  }
}
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = { dryRun: false, yes: false, config: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--config") {
      opts.config = argv[i + 1];
      if (!opts.config) usage(2);
      i += 1;
    } else if (arg.startsWith("--config=")) {
      opts.config = arg.slice("--config=".length);
    } else {
      output.write(`Unknown option: ${arg}\n\n`);
      usage(2);
    }
  }

  return opts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation (shared by interactive and config modes)
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function normalizeEmail(value, field = "Email") {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !EMAIL_RE.test(email)) {
    fail(`${field} is not a valid email address`);
  }
  return email;
}

function requireText(value, field, { min = 1, max = 200 } = {}) {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    fail(`${field} must be ${min}-${max} characters`);
  }
  return text;
}

function optionalText(value, field, { max = 1000 } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > max) fail(`${field} must be at most ${max} characters`);
  return text;
}

/**
 * Nigerian numbers are stored as digits only, in international form.
 * 0803 123 4567 -> 2348031234567, 8031234567 -> 2348031234567.
 */
function normalizePhone(value, field = "Phone") {
  const digits = String(value ?? "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");

  let normalized = digits;
  if (digits.length === 11 && digits.startsWith("0")) normalized = `234${digits.slice(1)}`;
  else if (digits.length === 10) normalized = `234${digits}`;

  if (!/^\d{7,15}$/.test(normalized)) {
    fail(`${field} must be a valid phone number (e.g. 0803 123 4567)`);
  }
  return normalized;
}

function normalizeState(value) {
  const raw = String(value ?? "").trim();
  if (!raw) fail("State is required");

  const alias = STATE_ALIASES.get(raw.toLowerCase());
  if (alias) return alias;

  const match = NG_STATES.find((state) => state.toLowerCase() === raw.toLowerCase());
  if (!match) {
    fail(`State must be one of: ${NG_STATES.join(", ")}`);
  }
  return match;
}

function parseTier(value, field = "Verification tier") {
  const tier = Number(value);
  if (!Number.isInteger(tier) || tier < 0 || tier > 3) {
    fail(`${field} must be 0, 1, 2 or 3`);
  }
  return tier;
}

function parseInteger(value, field, { min = 0, max = 1_000_000 } = {}) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(`${field} must be a whole number between ${min} and ${max}`);
  }
  return number;
}

/** Naira text -> integer kobo. Rejects negatives, >2 decimals, zero and overflow. */
function parseNaira(value, field) {
  const text = String(value ?? "").trim();
  if (!text) fail(`${field} is required`);

  const minor = parseMoneyToMinor(text);
  if (minor === null) {
    fail(`${field} must be a Naira amount like 12500 or 12,500.50 (no negative values)`);
  }
  if (!Number.isSafeInteger(minor)) fail(`${field} is not a safe integer amount`);
  if (minor <= 0) fail(`${field} must be greater than zero`);
  if (minor > MAX_KOBO) {
    fail(`${field} is too large for the database (max ${formatMoney(MAX_KOBO)})`);
  }
  return minor;
}

function parseOptionalNaira(value, field) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return parseNaira(text, field);
}

function parsePassword(value, field = "Password") {
  const password = String(value ?? "");
  if (password.length < PASSWORD_RULES.min) fail(`${field} must be at least ${PASSWORD_RULES.min} characters`);
  if (password.length > PASSWORD_RULES.max) fail(`${field} must be at most ${PASSWORD_RULES.max} characters`);
  return password;
}

function parseBoolean(value, field, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(text)) return true;
  if (["no", "n", "false", "0"].includes(text)) return false;
  fail(`${field} must be yes or no`);
}

function oneOf(value, field, allowed) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(text)) fail(`${field} must be one of: ${allowed.join(", ")}`);
  return text;
}

function validateProducts(rawProducts) {
  if (!Array.isArray(rawProducts)) fail("Products must be a list");
  if (rawProducts.length < MIN_PRODUCTS || rawProducts.length > MAX_PRODUCTS) {
    fail(`Provide ${MIN_PRODUCTS}-${MAX_PRODUCTS} real product listings (got ${rawProducts.length})`);
  }

  const seenSkus = new Set();

  return rawProducts.map((raw, index) => {
    const label = `Product ${index + 1}`;
    if (!isPlainObject(raw)) fail(`${label} must be an object`);

    const title = requireText(raw.title, `${label} title`, { min: 2, max: 160 });
    const publicPriceKobo = parseNaira(raw.publicPriceNaira ?? raw.publicPrice, `${label} public retail price`);
    const resellerPriceKobo = parseNaira(
      raw.resellerPriceNaira ?? raw.resellerPrice,
      `${label} private wholesale price`,
    );

    if (resellerPriceKobo >= publicPriceKobo) {
      fail(`${label}: private wholesale price must be lower than the public retail price`);
    }

    const minResalePriceKobo = parseOptionalNaira(
      raw.minResalePriceNaira ?? raw.minResalePrice,
      `${label} minimum resale price`,
    );
    if (minResalePriceKobo !== null && minResalePriceKobo < resellerPriceKobo) {
      fail(`${label}: minimum resale price cannot be below the wholesale price`);
    }
    if (minResalePriceKobo !== null && minResalePriceKobo > publicPriceKobo) {
      fail(`${label}: minimum resale price cannot be above the public retail price`);
    }

    const skuRaw = optionalText(raw.sku, `${label} SKU`, { max: 40 });
    if (skuRaw) {
      const key = skuRaw.toLowerCase();
      if (seenSkus.has(key)) fail(`${label}: SKU "${skuRaw}" is used twice`);
      seenSkus.add(key);
    }

    return {
      title,
      sku: skuRaw,
      category: optionalText(raw.category, `${label} category`, { max: 60 }),
      description: optionalText(raw.description, `${label} description`, { max: 2000 }),
      unit: optionalText(raw.unit, `${label} unit`, { max: 20 }) ?? "unit",
      publicPriceKobo,
      resellerPriceKobo,
      minResalePriceKobo,
      moq: parseInteger(raw.moq ?? 1, `${label} MOQ`, { min: 1, max: 100_000 }),
      stockQty: parseInteger(raw.stockQty ?? 0, `${label} stock quantity`, { min: 0, max: 10_000_000 }),
    };
  });
}

function validateAgreement(raw = {}) {
  if (!isPlainObject(raw)) fail("Agreement terms must be an object");
  return {
    paymentTermsDays: parseInteger(raw.paymentTermsDays ?? 0, "Payment terms (days)", { min: 0, max: 365 }),
    deliveryResponsibility: oneOf(
      raw.deliveryResponsibility ?? "SUPPLIER",
      "Delivery responsibility",
      DELIVERY_RESPONSIBILITY,
    ),
    advertisingPermission: parseBoolean(raw.advertisingPermission, "Advertising permission", true),
    customerDataVisibility: oneOf(
      raw.customerDataVisibility ?? "ORDER_ONLY",
      "Customer data visibility",
      CUSTOMER_DATA_VISIBILITY,
    ),
    notes: optionalText(raw.notes, "Agreement notes", { max: 2000 }),
  };
}

function validatePair(raw) {
  if (!isPlainObject(raw)) fail("Config must be a JSON object");
  if (!isPlainObject(raw.supplier)) fail("Config is missing a supplier object");
  if (!isPlainObject(raw.reseller)) fail("Config is missing a reseller object");

  const supplier = {
    email: normalizeEmail(raw.supplier.email, "Supplier email"),
    displayName: requireText(raw.supplier.displayName, "Supplier contact name", { min: 2, max: 80 }),
    businessName: requireText(raw.supplier.businessName, "Supplier business name", { min: 2, max: 120 }),
    phone: normalizePhone(raw.supplier.phone, "Supplier phone"),
    addressLine: requireText(raw.supplier.addressLine, "Supplier address", { min: 2, max: 200 }),
    city: requireText(raw.supplier.city, "Supplier city", { min: 2, max: 80 }),
    state: normalizeState(raw.supplier.state),
    verificationTier: parseTier(raw.supplier.verificationTier ?? 1, "Supplier verification tier"),
    about: optionalText(raw.supplier.about, "Supplier about", { max: 2000 }),
    verificationEvidence: optionalText(raw.supplier.verificationEvidence, "Supplier evidence reference", {
      max: 200,
    }),
    password: raw.supplier.password ? parsePassword(raw.supplier.password, "Supplier password") : null,
  };

  const reseller = {
    email: normalizeEmail(raw.reseller.email, "Reseller email"),
    displayName: requireText(raw.reseller.displayName, "Reseller contact name", { min: 2, max: 80 }),
    businessName: requireText(raw.reseller.businessName, "Reseller business name", { min: 2, max: 120 }),
    phone: normalizePhone(raw.reseller.phone, "Reseller phone"),
    city: requireText(raw.reseller.city, "Reseller city", { min: 2, max: 80 }),
    state: normalizeState(raw.reseller.state),
    verificationTier: parseTier(raw.reseller.verificationTier ?? 1, "Reseller verification tier"),
    businessSummary: optionalText(raw.reseller.businessSummary, "Reseller business summary", { max: 1000 }),
    password: raw.reseller.password ? parsePassword(raw.reseller.password, "Reseller password") : null,
  };

  if (supplier.email === reseller.email) {
    fail("Supplier and reseller must use different email addresses");
  }

  const products = validateProducts(raw.products);
  const agreement = validateAgreement(raw.agreement);

  return { supplier, reseller, products, agreement };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive prompts
// ─────────────────────────────────────────────────────────────────────────────

function buildPrompter({ ask, askHidden, askRaw, close }) {
  async function askValidated(label, defaultValue, validate) {
    for (;;) {
      const raw = await ask(label);
      const value = raw.trim() === "" && defaultValue !== undefined ? defaultValue : raw;
      try {
        return validate(value);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        output.write(`  ! ${error.message}\n`);
      }
    }
  }

  async function askOptional(label, field, options) {
    for (;;) {
      const raw = await ask(`${label} (optional)`);
      try {
        return optionalText(raw, field, options);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        output.write(`  ! ${error.message}\n`);
      }
    }
  }

  async function askPassword(label, envName) {
    const fromEnv = process.env[envName];
    if (fromEnv) return parsePassword(fromEnv, label);

    for (;;) {
      const first = await askHidden(label);
      try {
        parsePassword(first, label);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        output.write(`  ! ${error.message}\n`);
        continue;
      }

      const second = await askHidden(`Confirm ${label.toLowerCase()}`);
      if (first !== second) {
        output.write("  ! Passwords did not match. Try again.\n");
        continue;
      }
      return first;
    }
  }

  return { ask, askHidden, askRaw, askValidated, askOptional, askPassword, close };
}

async function createPrompter() {
  const isTerminal = Boolean(input.isTTY && output.isTTY);

  if (!isTerminal) {
    // Piped stdin is read all at once. readline emits every line immediately, so
    // sequential question() calls would lose every answer after the first one.
    const chunks = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    let cursor = 0;

    const nextLine = () => {
      if (cursor >= lines.length) {
        throw new InputEndedError("Input ended before all questions were answered.");
      }
      return lines[cursor++];
    };

    return buildPrompter({
      ask: async (label) => {
        const value = nextLine();
        output.write(`${label}: ${value}\n`);
        return value;
      },
      askHidden: async (label) => {
        const value = nextLine();
        output.write(`${label}: [hidden]\n`);
        return value.trim();
      },
      askRaw: async (prompt) => {
        const value = nextLine();
        output.write(`${prompt}${value}\n`);
        return value;
      },
      close: () => {},
    });
  }

  const rl = createInterface({ input, output, terminal: true });

  rl.on("SIGINT", () => {
    output.write("\nCancelled. Nothing was written.\n");
    process.exit(130);
  });

  async function askHidden(label) {
    output.write(`${label}: `);
    const internal = rl;
    const originalWrite = internal._writeToOutput;
    internal._writeToOutput = () => {};

    try {
      return await rl.question("");
    } finally {
      internal._writeToOutput = originalWrite;
      output.write("\n");
    }
  }

  return buildPrompter({
    ask: (label) => rl.question(`${label}: `),
    askHidden,
    askRaw: (prompt) => rl.question(prompt),
    close: () => rl.close(),
  });
}

async function collectSupplier(prompter) {
  output.write("\n── Supplier account ─────────────────────────────────────────────\n");
  const { askValidated, askOptional, askPassword } = prompter;

  const email = await askValidated("Supplier email", undefined, (v) => normalizeEmail(v, "Supplier email"));
  const displayName = await askValidated("Supplier contact name", undefined, (v) =>
    requireText(v, "Supplier contact name", { min: 2, max: 80 }),
  );
  const businessName = await askValidated("Business name", undefined, (v) =>
    requireText(v, "Supplier business name", { min: 2, max: 120 }),
  );
  const phone = await askValidated("Phone (e.g. 0803 123 4567)", undefined, (v) =>
    normalizePhone(v, "Supplier phone"),
  );
  const addressLine = await askValidated("Address", undefined, (v) =>
    requireText(v, "Supplier address", { min: 2, max: 200 }),
  );
  const city = await askValidated("City (e.g. Kano or Lagos)", undefined, (v) =>
    requireText(v, "Supplier city", { min: 2, max: 80 }),
  );
  const state = await askValidated("State", undefined, normalizeState);
  const verificationTier = await askValidated(
    `Verification tier 0-3 [${TIER_LABEL[1]}]`,
    "1",
    (v) => parseTier(v, "Supplier verification tier"),
  );
  const verificationEvidence =
    verificationTier >= 2
      ? await askOptional("Evidence reference (e.g. CAC number, ID checked)", "Supplier evidence reference", {
          max: 200,
        })
      : null;
  const about = await askOptional("What the supplier sells (short description)", "Supplier about", {
    max: 2000,
  });
  const password = await askPassword("Supplier password", "PILOT_SUPPLIER_PASSWORD");

  return {
    email,
    displayName,
    businessName,
    phone,
    addressLine,
    city,
    state,
    verificationTier,
    verificationEvidence,
    about,
    password,
  };
}

async function collectProducts(prompter) {
  output.write("\n── Real catalogue (public retail + private wholesale) ───────────\n");
  const { askValidated, askOptional } = prompter;

  const count = await askValidated(
    `How many real listings? ${MIN_PRODUCTS}-${MAX_PRODUCTS}`,
    String(MIN_PRODUCTS),
    (v) => parseInteger(v, "Listing count", { min: MIN_PRODUCTS, max: MAX_PRODUCTS }),
  );

  const products = [];
  for (let index = 0; index < count; index += 1) {
    output.write(`\n  Product ${index + 1} of ${count}\n`);
    const title = await askValidated("    Title", undefined, (v) =>
      requireText(v, "Product title", { min: 2, max: 160 }),
    );
    const sku = await askOptional("    SKU", "Product SKU", { max: 40 });
    const category = await askOptional("    Category", "Product category", { max: 60 });
    const description = await askOptional("    Description", "Product description", { max: 2000 });
    const unit = (await askOptional("    Unit (piece, carton, set)", "Product unit", { max: 20 })) ?? "unit";
    const publicPrice = await askValidated("    Public retail price (Naira)", undefined, (v) =>
      parseNaira(v, "Public retail price"),
    );
    const resellerPrice = await askValidated("    Private wholesale price (Naira)", undefined, (v) => {
      const kobo = parseNaira(v, "Private wholesale price");
      if (kobo >= publicPrice) {
        fail("Private wholesale price must be lower than the public retail price");
      }
      return kobo;
    });

    let minResaleKobo = null;
    for (;;) {
      const raw = await prompter.ask("    Minimum resale price (Naira, optional)");
      const text = raw.trim();
      if (!text) break;
      try {
        const kobo = parseNaira(text, "Minimum resale price");
        if (kobo < resellerPrice) {
          output.write("  ! Minimum resale price cannot be below the wholesale price.\n");
          continue;
        }
        if (kobo > publicPrice) {
          output.write("  ! Minimum resale price cannot be above the public retail price.\n");
          continue;
        }
        minResaleKobo = kobo;
        break;
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        output.write(`  ! ${error.message}\n`);
      }
    }

    const moq = await askValidated("    Minimum order quantity (MOQ)", "1", (v) =>
      parseInteger(v, "MOQ", { min: 1, max: 100_000 }),
    );
    const stockQty = await askValidated("    Stock quantity", "0", (v) =>
      parseInteger(v, "Stock quantity", { min: 0, max: 10_000_000 }),
    );

    products.push({
      title,
      sku,
      category,
      description,
      unit,
      publicPriceNaira: String(publicPrice / 100),
      resellerPriceNaira: String(resellerPrice / 100),
      minResalePriceNaira: minResaleKobo !== null ? String(minResaleKobo / 100) : undefined,
      moq,
      stockQty,
    });
  }

  return products;
}

async function collectReseller(prompter) {
  output.write("\n── Reseller account ─────────────────────────────────────────────\n");
  const { askValidated, askOptional, askPassword } = prompter;

  const email = await askValidated("Reseller email", undefined, (v) => normalizeEmail(v, "Reseller email"));
  const displayName = await askValidated("Reseller contact name", undefined, (v) =>
    requireText(v, "Reseller contact name", { min: 2, max: 80 }),
  );
  const businessName = await askValidated("Reseller business name", undefined, (v) =>
    requireText(v, "Reseller business name", { min: 2, max: 120 }),
  );
  const phone = await askValidated("Phone (e.g. 0806 987 6543)", undefined, (v) =>
    normalizePhone(v, "Reseller phone"),
  );
  const city = await askValidated("City", undefined, (v) => requireText(v, "Reseller city", { min: 2, max: 80 }));
  const state = await askValidated("State", undefined, normalizeState);
  const verificationTier = await askValidated(
    `Verification tier 0-3 [${TIER_LABEL[1]}]`,
    "1",
    (v) => parseTier(v, "Reseller verification tier"),
  );
  const businessSummary = await askOptional("How the reseller sells today", "Reseller business summary", {
    max: 1000,
  });
  const password = await askPassword("Reseller password", "PILOT_RESELLER_PASSWORD");

  return {
    email,
    displayName,
    businessName,
    phone,
    city,
    state,
    verificationTier,
    businessSummary,
    password,
  };
}

async function collectAgreement(prompter) {
  output.write("\n── Pre-approved agreement terms ─────────────────────────────────\n");
  const { askValidated, askOptional } = prompter;

  const paymentTermsDays = await askValidated("Payment terms in days (0 = pay before dispatch)", "0", (v) =>
    parseInteger(v, "Payment terms", { min: 0, max: 365 }),
  );
  const deliveryResponsibility = await askValidated(
    "Delivery responsibility (SUPPLIER/RESELLER/SPLIT)",
    "SUPPLIER",
    (v) => oneOf(v, "Delivery responsibility", DELIVERY_RESPONSIBILITY),
  );
  const advertisingPermission = await askValidated(
    "May the reseller advertise these products? (yes/no)",
    "yes",
    (v) => parseBoolean(v, "Advertising permission", true),
  );
  const customerDataVisibility = await askValidated(
    "Customer data visibility (NONE/ORDER_ONLY/FULL)",
    "ORDER_ONLY",
    (v) => oneOf(v, "Customer data visibility", CUSTOMER_DATA_VISIBILITY),
  );
  const notes = await askOptional("Agreement notes", "Agreement notes", { max: 2000 });

  return { paymentTermsDays, deliveryResponsibility, advertisingPermission, customerDataVisibility, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for the write phase
// ─────────────────────────────────────────────────────────────────────────────

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function redactDatabaseUrl(url) {
  return String(url ?? "").replace(/(\/\/[^:/@]+:)[^@]+(@)/, "$1***$2");
}

async function assertNoExistingAccounts(pair) {
  const [supplierUser, resellerUser] = await Promise.all([
    prisma.user.findUnique({ where: { email: pair.supplier.email }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: pair.reseller.email }, select: { id: true } }),
  ]);

  if (supplierUser) fail(`Supplier email already exists (${pair.supplier.email}). Nothing was written.`);
  if (resellerUser) fail(`Reseller email already exists (${pair.reseller.email}). Nothing was written.`);
}

async function createPilotAccount(tx, input) {
  const now = new Date();

  const user = await tx.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      emailVerifiedAt: now, // the pilot operator has reached this person directly
    },
  });

  const profile = await tx.profile.create({
    data: {
      userId: user.id,
      displayName: input.displayName,
      phone: input.phone,
      city: input.city,
      state: input.state,
      country: "NG",
      verificationTier: input.verificationTier,
      tierUpdatedAt: now,
    },
  });

  for (const role of ["BUSINESS_OWNER", input.role]) {
    await tx.profileRole.create({ data: { profileId: profile.id, role } });
  }

  const workspace = await tx.businessWorkspace.create({
    data: {
      ownerProfileId: profile.id,
      name: input.businessName,
      currency: "NGN",
      whatsappNumber: input.phone,
      addressLine: input.addressLine ?? null,
      city: input.city,
      state: input.state,
    },
  });

  if (input.verificationTier > 0) {
    await tx.verificationEvent.create({
      data: {
        profileId: profile.id,
        fromTier: 0,
        toTier: input.verificationTier,
        reason:
          input.verificationTier >= 2
            ? "Pilot onboarding: business details reviewed by operator (CLI)"
            : "Pilot onboarding: contact reached directly by operator (CLI)",
        evidenceRef: input.verificationEvidence ?? null,
      },
    });
  }

  await tx.subscription.create({
    data: { workspaceId: workspace.id, tier: "FREE", status: "ACTIVE" },
  });

  return { user, profile, workspace };
}

async function uniqueSlug(tx, title, taken) {
  const base = slugify(title) || "listing";
  let candidate = base;
  let suffix = 2;

  for (;;) {
    if (!taken.has(candidate)) {
      const existing = await tx.productListing.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!existing) {
        taken.add(candidate);
        return candidate;
      }
    }
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

async function uniqueSku(tx, workspaceId, preferred, index, taken) {
  const base = preferred || `PILOT-${String(index + 1).padStart(3, "0")}`;
  let candidate = base;
  let suffix = 2;

  for (;;) {
    const key = candidate.toLowerCase();
    if (!taken.has(key)) {
      const existing = await tx.product.findFirst({
        where: { workspaceId, sku: candidate },
        select: { id: true },
      });
      if (!existing) {
        taken.add(key);
        return candidate;
      }
    }
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary + execution
// ─────────────────────────────────────────────────────────────────────────────

function printSummary(pair) {
  const { supplier, reseller, products, agreement } = pair;

  output.write("\n── Review before writing ────────────────────────────────────────\n");
  output.write(`Database: ${redactDatabaseUrl(process.env.DATABASE_URL) || "(from Prisma default)"}\n`);

  output.write("\nSupplier\n");
  output.write(`  Contact:  ${supplier.displayName} <${supplier.email}>\n`);
  output.write(`  Business: ${supplier.businessName}\n`);
  output.write(`  Phone:    ${supplier.phone}\n`);
  output.write(`  Address:  ${supplier.addressLine}, ${supplier.city}, ${supplier.state}\n`);
  output.write(`  Tier:     ${supplier.verificationTier} — ${TIER_LABEL[supplier.verificationTier]}\n`);

  output.write("\nCatalogue\n");
  output.write("  #  Title                          Public        Wholesale     Min resale    MOQ  Stock\n");
  products.forEach((product, index) => {
    const row = [
      String(index + 1).padEnd(2),
      product.title.slice(0, 30).padEnd(30),
      formatMoney(product.publicPriceKobo).padEnd(13),
      formatMoney(product.resellerPriceKobo).padEnd(13),
      (product.minResalePriceKobo === null ? "—" : formatMoney(product.minResalePriceKobo)).padEnd(13),
      String(product.moq).padEnd(4),
      String(product.stockQty),
    ];
    output.write(`  ${row.join("  ")}\n`);
  });

  output.write("\nReseller\n");
  output.write(`  Contact:  ${reseller.displayName} <${reseller.email}>\n`);
  output.write(`  Business: ${reseller.businessName}\n`);
  output.write(`  Phone:    ${reseller.phone}\n`);
  output.write(`  Location: ${reseller.city}, ${reseller.state}\n`);
  output.write(`  Tier:     ${reseller.verificationTier} — ${TIER_LABEL[reseller.verificationTier]}\n`);

  output.write("\nAgreement (pre-approved, ACTIVE for every listing)\n");
  output.write(`  Payment terms:        ${agreement.paymentTermsDays} day(s)\n`);
  output.write(`  Delivery:             ${agreement.deliveryResponsibility}\n`);
  output.write(`  Advertising allowed:  ${agreement.advertisingPermission ? "yes" : "no"}\n`);
  output.write(`  Customer data:        ${agreement.customerDataVisibility}\n`);
  if (agreement.notes) output.write(`  Notes:                ${agreement.notes}\n`);
}

async function writePilotPair(pair, passwordHashes) {
  return prisma.$transaction(
    async (tx) => {
      const supplierAccount = await createPilotAccount(tx, {
        ...pair.supplier,
        passwordHash: passwordHashes.supplier,
        role: "SUPPLIER",
      });

      const resellerAccount = await createPilotAccount(tx, {
        ...pair.reseller,
        passwordHash: passwordHashes.reseller,
        addressLine: null,
        role: "RESELLER",
      });

      const supplierProfile = await tx.supplierProfile.create({
        data: {
          workspaceId: supplierAccount.workspace.id,
          profileId: supplierAccount.profile.id,
          businessName: pair.supplier.businessName,
          about: pair.supplier.about,
          city: pair.supplier.city,
          state: pair.supplier.state,
          verificationTier: pair.supplier.verificationTier,
          isActive: true,
        },
      });

      const takenSlugs = new Set();
      const takenSkus = new Set();
      const createdListings = [];
      const createdAgreements = [];
      let firstOfferId = null;

      for (let index = 0; index < pair.products.length; index += 1) {
        const product = pair.products[index];
        const slug = await uniqueSlug(tx, product.title, takenSlugs);
        const sku = await uniqueSku(tx, supplierAccount.workspace.id, product.sku, index, takenSkus);

        const workspaceProduct = await tx.product.create({
          data: {
            workspaceId: supplierAccount.workspace.id,
            name: product.title,
            sku,
            description: product.description,
            unit: product.unit,
            costPriceKobo: 0, // unknown at onboarding; never expose this publicly
            sellingPriceKobo: product.publicPriceKobo,
            stockQty: product.stockQty,
            lowStockAt: Math.max(1, Math.floor(product.stockQty * 0.1)),
            isActive: true,
          },
        });

        const listing = await tx.productListing.create({
          data: {
            supplierProfileId: supplierProfile.id,
            productId: workspaceProduct.id,
            slug,
            title: product.title,
            description: product.description,
            category: product.category,
            publicPriceKobo: product.publicPriceKobo,
            currency: "NGN",
            moq: product.moq,
            stockQty: product.stockQty,
            isPublished: true,
          },
        });

        const offer = await tx.resellerOffer.create({
          data: { listingId: listing.id, status: "ACTIVE" },
        });
        if (!firstOfferId) firstOfferId = offer.id;

        const offerVersion = await tx.resellerOfferVersion.create({
          data: {
            offerId: offer.id,
            version: 1,
            resellerPriceKobo: product.resellerPriceKobo,
            minResalePriceKobo: product.minResalePriceKobo,
            commissionType: "NONE",
            commissionValue: 0,
            moq: product.moq,
            stockQty: product.stockQty,
            paymentTermsDays: pair.agreement.paymentTermsDays,
            deliveryResponsibility: pair.agreement.deliveryResponsibility,
            advertisingPermission: pair.agreement.advertisingPermission,
            customerDataVisibility: pair.agreement.customerDataVisibility,
            createdByProfileId: supplierAccount.profile.id,
            notes: pair.agreement.notes,
          },
        });

        await tx.resellerOffer.update({
          where: { id: offer.id },
          data: { currentVersionId: offerVersion.id },
        });

        const agreement = await tx.resellerAgreement.create({
          data: {
            offerId: offer.id,
            supplierProfileId: supplierProfile.id,
            resellerProfileId: resellerAccount.profile.id,
            status: "ACTIVE",
          },
        });

        const agreementVersion = await tx.resellerAgreementVersion.create({
          data: {
            agreementId: agreement.id,
            version: 1,
            resellerPriceKobo: product.resellerPriceKobo,
            minResalePriceKobo: product.minResalePriceKobo,
            commissionType: "NONE",
            commissionValue: 0,
            moq: product.moq,
            paymentTermsDays: pair.agreement.paymentTermsDays,
            deliveryResponsibility: pair.agreement.deliveryResponsibility,
            advertisingPermission: pair.agreement.advertisingPermission,
            customerDataVisibility: pair.agreement.customerDataVisibility,
            createdByProfileId: supplierAccount.profile.id,
            acceptedBySupplierAt: new Date(),
            acceptedByResellerAt: new Date(),
            notes: pair.agreement.notes ?? "Pre-approved during pilot onboarding (CLI).",
          },
        });

        await tx.resellerAgreement.update({
          where: { id: agreement.id },
          data: { currentVersionId: agreementVersion.id },
        });

        createdListings.push({ listing, product, offerVersion });
        createdAgreements.push({ agreement, agreementVersion, listing });
      }

      const application = await tx.resellerApplication.create({
        data: {
          supplierProfileId: supplierProfile.id,
          resellerProfileId: resellerAccount.profile.id,
          offerId: firstOfferId,
          status: "APPROVED",
          message: pair.reseller.businessSummary,
          businessSummary: pair.reseller.businessSummary,
          verificationTierAtApply: pair.reseller.verificationTier,
          decidedAt: new Date(),
          decidedByProfileId: supplierAccount.profile.id,
          decisionNote: "Pre-approved by the supplier during pilot onboarding (CLI).",
        },
      });

      // Append-only audit trail for the operator's actions.
      const auditRows = [
        {
          actorProfileId: supplierAccount.profile.id,
          actorRole: "SUPPLIER",
          action: "pilot.supplier_onboarded",
          entityType: "SupplierProfile",
          entityId: supplierProfile.id,
          metadataJson: JSON.stringify({
            email: pair.supplier.email,
            workspaceId: supplierAccount.workspace.id,
            verificationTier: pair.supplier.verificationTier,
            operator: "scripts/seed-pilot.mjs",
          }),
        },
        {
          actorProfileId: resellerAccount.profile.id,
          actorRole: "RESELLER",
          action: "pilot.reseller_onboarded",
          entityType: "Profile",
          entityId: resellerAccount.profile.id,
          metadataJson: JSON.stringify({
            email: pair.reseller.email,
            workspaceId: resellerAccount.workspace.id,
            verificationTier: pair.reseller.verificationTier,
            operator: "scripts/seed-pilot.mjs",
          }),
        },
        {
          actorProfileId: supplierAccount.profile.id,
          actorRole: "SUPPLIER",
          action: "pilot.catalog_published",
          entityType: "SupplierProfile",
          entityId: supplierProfile.id,
          metadataJson: JSON.stringify({
            listingIds: createdListings.map((row) => row.listing.id),
            count: createdListings.length,
          }),
        },
        {
          actorProfileId: supplierAccount.profile.id,
          actorRole: "SUPPLIER",
          action: "pilot.agreements_preapproved",
          entityType: "ResellerApplication",
          entityId: application.id,
          metadataJson: JSON.stringify({
            agreementIds: createdAgreements.map((row) => row.agreement.id),
            count: createdAgreements.length,
            resellerProfileId: resellerAccount.profile.id,
          }),
        },
      ];
      await tx.auditLog.createMany({ data: auditRows });

      return {
        supplierAccount,
        resellerAccount,
        supplierProfile,
        application,
        createdListings,
        createdAgreements,
      };
    },
    { timeout: 30_000 },
  );
}

function printResult(result) {
  const { supplierAccount, resellerAccount, supplierProfile, application, createdListings, createdAgreements } =
    result;

  output.write("\n✓ Pilot pair created. Nothing else was touched.\n");

  output.write("\nSupplier\n");
  output.write(`  Email:              ${supplierAccount.user.email}\n`);
  output.write(`  User ID:            ${supplierAccount.user.id}\n`);
  output.write(`  Profile ID:         ${supplierAccount.profile.id}\n`);
  output.write(`  Workspace ID:       ${supplierAccount.workspace.id}\n`);
  output.write(`  SupplierProfile ID: ${supplierProfile.id}\n`);
  output.write(`  Sign in:            ${DEFAULT_APP_URL}/login\n`);

  output.write("\nReseller\n");
  output.write(`  Email:              ${resellerAccount.user.email}\n`);
  output.write(`  User ID:            ${resellerAccount.user.id}\n`);
  output.write(`  Profile ID:         ${resellerAccount.profile.id}\n`);
  output.write(`  Workspace ID:       ${resellerAccount.workspace.id}\n`);
  output.write(`  Application ID:     ${application.id} (APPROVED)\n`);
  output.write(`  Sign in:            ${DEFAULT_APP_URL}/login\n`);

  output.write("\nListings and private agreements\n");
  createdAgreements.forEach((row, index) => {
    const listing = createdListings[index].listing;
    output.write(
      `  ${index + 1}. ${listing.title} — public ${formatMoney(listing.publicPriceKobo)}, ` +
        `wholesale ${formatMoney(row.agreementVersion.resellerPriceKobo)} — ` +
        `agreement ${row.agreement.id} (ACTIVE)\n`,
    );
  });

  output.write("\nRecord these IDs in PILOT_TRACKER.md, then send each person their sign-in link.\n");
  output.write("Passwords were hashed with bcrypt (cost 12) and were not stored in plain text.\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function loadConfig(configPath) {
  const absolute = path.resolve(process.cwd(), configPath);

  try {
    const mode = statSync(absolute).mode;
    if (process.platform !== "win32" && (mode & 0o077) !== 0) {
      output.write(`! ${absolute} is readable by other users. Run: chmod 600 ${absolute}\n`);
    }
  } catch {
    fail(`Cannot read config file: ${absolute}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`Config file is not valid JSON: ${error.message}`);
  }

  return parsed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) usage(0);

  let prompter = null;
  let pair;

  try {
    if (opts.config) {
      output.write("SellFlow pilot seeder — config mode\n");
      pair = validatePair(await loadConfig(opts.config));

      // Passwords may be omitted from a config file and supplied securely instead.
      if (!pair.supplier.password && process.env.PILOT_SUPPLIER_PASSWORD) {
        pair.supplier.password = parsePassword(process.env.PILOT_SUPPLIER_PASSWORD, "Supplier password");
      }
      if (!pair.reseller.password && process.env.PILOT_RESELLER_PASSWORD) {
        pair.reseller.password = parsePassword(process.env.PILOT_RESELLER_PASSWORD, "Reseller password");
      }
      if (!pair.supplier.password || !pair.reseller.password) {
        prompter = await createPrompter();
        if (!pair.supplier.password) {
          pair.supplier.password = await prompter.askPassword("Supplier password", "PILOT_SUPPLIER_PASSWORD");
        }
        if (!pair.reseller.password) {
          pair.reseller.password = await prompter.askPassword("Reseller password", "PILOT_RESELLER_PASSWORD");
        }
      }
    } else {
      output.write("SellFlow pilot seeder — interactive mode\n");
      output.write("Real accounts only. Nothing is written until you type \"create\".\n");
      prompter = await createPrompter();

      const supplier = await collectSupplier(prompter);
      const products = await collectProducts(prompter);
      const reseller = await collectReseller(prompter);
      const agreement = await collectAgreement(prompter);

      pair = validatePair({ supplier, products, reseller, agreement });
    }

    // Validate before touching the database.
    pair.supplier.password = parsePassword(pair.supplier.password, "Supplier password");
    pair.reseller.password = parsePassword(pair.reseller.password, "Reseller password");
    await assertNoExistingAccounts(pair);

    printSummary(pair);

    if (opts.dryRun) {
      output.write("\nDry run: all checks passed. No database writes were made.\n");
      return;
    }

    if (!opts.yes) {
      if (!prompter) prompter = await createPrompter();
      const answer = await prompter.askRaw('\nType "create" to write these accounts: ');
      if (answer.trim().toLowerCase() !== "create") {
        output.write("Aborted. Nothing was written.\n");
        return;
      }
    }

    output.write("\nHashing passwords with bcrypt (cost 12)…\n");
    const [supplierHash, resellerHash] = await Promise.all([
      hashPassword(pair.supplier.password),
      hashPassword(pair.reseller.password),
    ]);

    output.write("Writing supplier, catalogue, reseller and agreements in one transaction…\n");
    const result = await writePilotPair(pair, { supplier: supplierHash, reseller: resellerHash });
    printResult(result);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof InputEndedError) {
      output.write(`\n✗ ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    prompter?.close();
  }
}

main()
  .catch((error) => {
    console.error("\nPilot onboarding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import type Stripe from "stripe";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { stripe } from "../lib/stripe";
import { ApiError } from "../utils/ApiError";
import { MESSAGES } from "../constants/messages.constants";
import type { OrganiserStripeAccount } from "../../generated/prisma/client";

/**
 * Creates (or fetches) an organiser's Stripe Connect account. Deliberately a
 * v1 Express account with only the `transfers` capability requested — this
 * account only ever receives platform-initiated transfers (§ separate
 * charges & transfers), it never takes charges directly, so `card_payments`
 * is never requested. See the plan's "engineering call on API generation"
 * for why v1 (not Accounts v2) is used here.
 */
export async function createOrGetConnectAccount(
  organiserId: string,
): Promise<OrganiserStripeAccount> {
  const existing = await prisma.organiserStripeAccount.findUnique({ where: { organiserId } });
  if (existing) {
    return existing;
  }

  const user = await prisma.user.findUnique({ where: { id: organiserId } });

  let account: Stripe.Account;
  try {
    account = await stripe.accounts.create({
      type: "express",
      email: user?.email,
      capabilities: { transfers: { requested: true } },
    });
  } catch (error) {
    logger.error({ err: error, organiserId }, "failed to create stripe connect account");
    throw new ApiError(502, MESSAGES.stripeConnect.onboardingLinkCreateFailed);
  }

  const created = await prisma.organiserStripeAccount.create({
    data: {
      organiserId,
      stripeAccountId: account.id,
      status: "ONBOARDING_INCOMPLETE",
    },
  });

  logger.info({ organiserId, stripeAccountId: account.id }, "stripe connect account created");

  return created;
}

/**
 * Ensures a Connect account exists for this organiser, then mints a fresh
 * Stripe-hosted Account Link (v1 Account Links) for onboarding/re-onboarding.
 */
export async function createOnboardingLink(organiserId: string): Promise<string> {
  const account = await createOrGetConnectAccount(organiserId);

  let link: Stripe.AccountLink;
  try {
    link = await stripe.accountLinks.create({
      account: account.stripeAccountId,
      type: "account_onboarding",
      return_url: env.STRIPE_CONNECT_ONBOARDING_RETURN_URL,
      refresh_url: env.STRIPE_CONNECT_ONBOARDING_REFRESH_URL,
    });
  } catch (error) {
    logger.error(
      { err: error, organiserId, stripeAccountId: account.stripeAccountId },
      "failed to create stripe account link",
    );
    throw new ApiError(502, MESSAGES.stripeConnect.onboardingLinkCreateFailed);
  }

  return link.url;
}

function deriveStatus(
  account: Stripe.Account,
): "NOT_CONNECTED" | "ONBOARDING_INCOMPLETE" | "RESTRICTED" | "ACTIVE" {
  const transfers = account.capabilities?.transfers;

  if (transfers === "active") {
    return "ACTIVE";
  }
  if (transfers === "pending") {
    return "ONBOARDING_INCOMPLETE";
  }
  if (account.requirements?.disabled_reason) {
    return "RESTRICTED";
  }
  return "ONBOARDING_INCOMPLETE";
}

/**
 * Called from the `account.updated` webhook case. Always re-derives the
 * full local status from the event payload rather than incrementally
 * patching it — idempotent by construction, safe under replays/out-of-order
 * delivery.
 */
export async function syncAccountStatus(account: Stripe.Account): Promise<void> {
  const existing = await prisma.organiserStripeAccount.findUnique({
    where: { stripeAccountId: account.id },
  });

  if (!existing) {
    logger.warn(
      { stripeAccountId: account.id },
      "account.updated for a stripe account we don't have a record of",
    );
    return;
  }

  const status = deriveStatus(account);

  await prisma.organiserStripeAccount.update({
    where: { id: existing.id },
    data: {
      status,
      transfersCapability: account.capabilities?.transfers ?? null,
      requirementsDue: account.requirements?.currently_due ?? [],
      lastSyncedAt: new Date(),
    },
  });

  logger.info(
    { organiserId: existing.organiserId, stripeAccountId: account.id, status },
    "stripe connect account status synced",
  );
}

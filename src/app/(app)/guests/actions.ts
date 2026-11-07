"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { revealPhone } from "@/server/services/guests";
import { ConsentError, createBlock, setConsent, CONTACT_CHANNELS } from "@/server/services/consent";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "FORBIDDEN" };
    if (e instanceof ConsentError) return { ok: false, error: e.code };
    if (e instanceof z.ZodError) return { ok: false, error: "INVALID_INPUT" };
    throw e;
  }
}

const reason = z.string().trim().min(5, "Gerekçe en az 5 karakter").max(300);

export async function revealPhoneAction(phoneId: string, why: string) {
  return run(async () => {
    const user = await requirePermission("field.contact.full", "GuestPhone");
    const value = await revealPhone(user, z.string().min(1).parse(phoneId), reason.parse(why));
    if (!value) throw new ConsentError("NOT_FOUND");
    return value;
  });
}

const blockSchema = z.object({
  guestId: z.string().min(1),
  allChannels: z.boolean(),
  channel: z.enum(CONTACT_CHANNELS).optional(),
  requestedAt: z.string().datetime({ offset: true }),
  proof: z.string().max(300).optional(),
});

export async function createBlockAction(input: z.input<typeof blockSchema>) {
  const r = await run(async () => {
    const user = await requirePermission("block.create", "ContactBlock");
    const p = blockSchema.parse(input);
    await createBlock(user, { ...p, requestedAt: new Date(p.requestedAt) });
    return true;
  });
  revalidatePath(`/guests/${input.guestId}`);
  return r;
}

const consentSchema = z.object({
  guestId: z.string().min(1),
  channel: z.enum(["CALL", "SMS", "WHATSAPP", "EMAIL", "RECORDING"]),
  status: z.enum(["GRANTED", "DENIED", "UNKNOWN"]),
  scope: z.enum(["MARKETING", "SERVICE"]),
  source: z.string().max(200).optional(),
  proofRef: z.string().max(300).optional(),
});

export async function setConsentAction(input: z.input<typeof consentSchema>) {
  const r = await run(async () => {
    const user = await requirePermission("consent.view", "ConsentRecord");
    await setConsent(user, consentSchema.parse(input));
    return true;
  });
  revalidatePath(`/guests/${input.guestId}`);
  return r;
}

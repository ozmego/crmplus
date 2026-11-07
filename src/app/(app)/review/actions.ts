"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { resolveReview, ReviewError } from "@/server/services/review";

const schema = z.object({
  id: z.string().min(1),
  action: z.enum(["MERGE", "CREATE_NEW", "DISMISS", "KEEP_CURRENT", "USE_INCOMING", "ACCEPT_INCOMING", "REMOVE_PHONE", "CONFIRM_OWNER"]),
  reason: z.string().trim().min(5).max(300),
  targetGuestId: z.string().optional(),
  proofRef: z.string().max(300).optional(),
});

export async function resolveReviewAction(input: z.input<typeof schema>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requirePermission("review.resolve");
    await resolveReview(user, schema.parse(input));
    revalidatePath("/review");
    return { ok: true };
  } catch (e) {
    if (e instanceof ReviewError) return { ok: false, error: e.code };
    if (e instanceof ForbiddenError) return { ok: false, error: "FORBIDDEN" };
    if (e instanceof z.ZodError) return { ok: false, error: "INVALID_INPUT" };
    throw e;
  }
}

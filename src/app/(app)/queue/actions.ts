"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, ForbiddenError } from "@/server/auth/rbac";
import { CallError, closeCall, endCall, markAnswered, startCall } from "@/server/services/calls";
import { DISPOSITION_CODES } from "@/lib/disposition";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof CallError) return { ok: false, error: e.code };
    if (e instanceof ForbiddenError) return { ok: false, error: "FORBIDDEN" };
    throw e;
  }
}

const id = z.string().min(1).max(64);

export async function startCallAction(taskId: string) {
  return run(async () => startCall(await requirePermission("call.make"), id.parse(taskId)));
}

export async function answerCallAction(callId: string) {
  return run(async () => markAnswered(await requirePermission("call.make"), id.parse(callId)));
}

export async function endCallAction(callId: string) {
  return run(async () => endCall(await requirePermission("call.make"), id.parse(callId)));
}

const closeSchema = z.object({
  callId: id,
  disposition: z.enum(DISPOSITION_CODES),
  note: z.string().max(2000).default(""),
  callbackAt: z.string().datetime({ offset: true }).nullable().optional(),
  language: z.string().regex(/^[a-z]{2}$/).nullable().optional(),
  dncAllChannels: z.boolean().optional(),
});

export async function closeCallAction(input: z.input<typeof closeSchema>) {
  const r = await run(async () => {
    const user = await requirePermission("call.make");
    const p = closeSchema.parse(input);
    return closeCall(user, { ...p, callbackAt: p.callbackAt ? new Date(p.callbackAt) : null });
  });
  revalidatePath("/queue");
  return r;
}

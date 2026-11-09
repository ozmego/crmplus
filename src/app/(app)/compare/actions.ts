"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { CompareError, runComparison } from "@/server/services/compare";

export type CompareState = { error?: string } | undefined;

export async function runCompareAction(_: CompareState, formData: FormData): Promise<CompareState> {
  let jobId: string;
  try {
    const user = await requirePermission("compare.run");
    const input = z
      .object({ mode: z.enum(["FILE", "CRM"]), leftBatchId: z.string().min(1), rightBatchId: z.string().min(1) })
      .parse({ mode: formData.get("mode"), leftBatchId: formData.get("leftBatchId"), rightBatchId: formData.get("rightBatchId") });
    jobId = (await runComparison(user, input)).id;
  } catch (e) {
    if (e instanceof CompareError) return { error: e.code };
    if (e instanceof ForbiddenError) return { error: "FORBIDDEN" };
    if (e instanceof z.ZodError) return { error: "INVALID_INPUT" };
    throw e;
  }
  redirect(`/compare/${jobId}`);
}

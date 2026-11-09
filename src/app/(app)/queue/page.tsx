import { getLocale, getTranslations } from "next-intl/server";
import { requirePage } from "@/server/auth/rbac";
import { loadQueue } from "@/server/services/queue";
import { db } from "@/server/db";
import { CallWorkspace, type QueueRow } from "@/components/call-workspace";
import { isPbxMode } from "@/server/telephony/provider";
import { gateOpen, getRecordingGate } from "@/server/services/settings";
import { currentWorkStatus } from "@/server/services/field-routes";
import { WorkStatus } from "@/components/work-status";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const user = await requirePage("queue.view");
  const t = await getTranslations("queue");
  const locale = await getLocale();
  const gate = await getRecordingGate();
  const [{ items, blocked }, dispositions, openCall, ws] = await Promise.all([
    loadQueue(user),
    db.disposition.findMany({ orderBy: { sortOrder: "asc" } }),
    db.call.findFirst({ where: { agentId: user.id, closedAt: null }, select: { id: true, taskId: true, startedAt: true, answeredAt: true, endedAt: true } }),
    currentWorkStatus(user.id),
  ]);

  const rows: QueueRow[] = items.map((i) => ({
    taskId: i.taskId,
    crm: `CRM-${String(i.crmNo).padStart(6, "0")}`,
    name: i.name,
    language: i.language.toUpperCase(),
    timezone: i.timezone,
    phone: i.phoneMasked,
    phoneState: i.phoneReachability,
    consentSource: i.consentSource,
    recordingPref: i.recordingPref,
    reason: i.reason,
    assignedAt: i.assignedAt.toISOString(),
    callbackAt: i.callbackAt?.toISOString() ?? null,
    callbackState: i.callbackState,
    lastCall: i.lastCall
      ? { at: i.lastCall.at.toISOString(), disposition: i.lastCall.disposition, talkSec: i.lastCall.talkSec }
      : null,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="page-title">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("hint")}</p>
      </div>
      <WorkStatus status={ws.status} since={ws.since?.toISOString() ?? null} />
      {blocked > 0 && (
        <p className="callout-info">
          {blocked} görev uygunluk kontrolünden geçemediği için kuyruktan çıkarıldı (izin, durdurma veya numara durumu).
        </p>
      )}
      <CallWorkspace
        rows={rows}
        locale={locale}
        pbxMode={isPbxMode()}
        recordingNotice={gateOpen(gate) ? gate.noticeText : null}
        dispositions={dispositions.map((d) => ({ code: d.code, label: locale === "en" ? d.labelEn : d.labelTr, noteRequired: d.noteRequired }))}
        openCall={
          openCall
            ? {
                callId: openCall.id,
                taskId: openCall.taskId,
                startedAt: openCall.startedAt.toISOString(),
                answeredAt: openCall.answeredAt?.toISOString() ?? null,
                endedAt: openCall.endedAt?.toISOString() ?? null,
              }
            : null
        }
      />
    </div>
  );
}

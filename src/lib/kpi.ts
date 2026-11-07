/**
 * KPI formülleri — docs/05 ile birebir. Saf fonksiyonlar; veriyi çağıran yükler.
 * Payda 0 ise sonuç null döner (ekranda "—"), 0 değil.
 */

export interface CallFact {
  agentId: string;
  phoneId: string;
  taskId: string | null;
  answered: boolean;
  disposition: string | null;
  talkSec: number | null;
  ringSec: number | null;
  wrapSec: number | null;
  autoClosed: boolean;
  noteLength: number;
}

export interface DispositionMeta {
  code: string;
  category: "REACHED" | "UNREACHED" | string;
  noteRequired: boolean;
}

export interface CallbackFact {
  assigneeId: string;
  scheduledAt: Date;
  status: string; // PENDING | DONE | CANCELLED
  firstAttemptAt: Date | null; // ilk deneme (DONE ise)
}

export const NOTE_MIN = 10;
const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

export interface AgentKpi {
  attempts: number;
  uniqueNumbers: number;
  tasksCalled: number;
  talkSecTotal: number;
  talkSecAvg: number | null;
  ringSecAvg: number | null;
  reachRate: number | null;
  unreachRate: number | null;
  callbackRequests: number;
  dncCount: number;
  rejectRate: number | null;
  wrongPersonRate: number | null;
  missingDispositionRate: number | null;
  missingNoteRate: number | null;
}

/** docs/05 §2–3 */
export function agentKpi(calls: CallFact[], dispositions: DispositionMeta[]): AgentKpi {
  const meta = new Map(dispositions.map((d) => [d.code, d]));
  const valid = calls.filter((c) => !c.autoClosed);
  const answeredValid = valid.filter((c) => c.answered);
  const reached = calls.filter((c) => c.disposition && meta.get(c.disposition)?.category === "REACHED" && c.disposition !== "WRONG_PERSON");
  const unreached = calls.filter((c) => c.disposition && meta.get(c.disposition)?.category === "UNREACHED");
  const answered = calls.filter((c) => c.answered);
  const dnc = calls.filter((c) => c.disposition === "DO_NOT_CONTACT").length;
  const noteRequired = calls.filter((c) => c.disposition && meta.get(c.disposition)?.noteRequired);
  return {
    attempts: calls.length,
    uniqueNumbers: new Set(calls.map((c) => c.phoneId)).size,
    tasksCalled: new Set(calls.map((c) => c.taskId).filter(Boolean)).size,
    talkSecTotal: valid.reduce((s, c) => s + (c.talkSec ?? 0), 0),
    talkSecAvg: answeredValid.length ? answeredValid.reduce((s, c) => s + (c.talkSec ?? 0), 0) / answeredValid.length : null,
    ringSecAvg: valid.length ? valid.reduce((s, c) => s + (c.ringSec ?? 0), 0) / valid.length : null,
    reachRate: ratio(reached.length, calls.length),
    unreachRate: ratio(unreached.length, calls.length),
    callbackRequests: calls.filter((c) => c.disposition === "CALLBACK_REQUESTED").length,
    dncCount: dnc,
    rejectRate: ratio(dnc, reached.length),
    wrongPersonRate: ratio(calls.filter((c) => c.disposition === "WRONG_PERSON").length, answered.length),
    missingDispositionRate: ratio(calls.filter((c) => c.autoClosed && !c.disposition).length, calls.length),
    missingNoteRate: ratio(noteRequired.filter((c) => c.noteLength < NOTE_MIN).length, noteRequired.length),
  };
}

/** docs/03 §5, docs/05 §3: zamanında = DONE ve ilk deneme planlanan ±15 dk içinde. CANCELLED paydaya girmez. */
export function callbackKpi(callbacks: CallbackFact[]) {
  const relevant = callbacks.filter((c) => c.status !== "CANCELLED");
  const done = relevant.filter((c) => c.status === "DONE");
  const onTime = done.filter((c) => c.firstAttemptAt && Math.abs(c.firstAttemptAt.getTime() - c.scheduledAt.getTime()) <= 15 * 60_000);
  return { total: relevant.length, done: done.length, completionRate: ratio(done.length, relevant.length), onTimeRate: ratio(onTime.length, relevant.length) };
}

/** Durdurma yansıma süresi: medyan ve 95. yüzdelik (saniye). */
export function percentiles(values: number[]): { median: number | null; p95: number | null } {
  if (!values.length) return { median: null, p95: null };
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { median: at(0.5), p95: at(0.95) };
}

export const pct = (v: number | null, digits = 0) => (v === null ? "—" : `%${(v * 100).toFixed(digits).replace(".", ",")}`);
export const hm = (sec: number | null) => {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} sa ${String(m).padStart(2, "0")} dk` : `${m} dk`;
};
export const mmss = (sec: number | null) => (sec === null ? "—" : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`);

/**
 * Sonuç kodu → etkiler (docs/03 §2–§4). Saf fonksiyon: ne yapılacağını söyler, yapmaz.
 */

export const DISPOSITION_CODES = [
  "REACHED",
  "NO_ANSWER",
  "BUSY",
  "INVALID_NUMBER",
  "CALLBACK_REQUESTED",
  "WRONG_PERSON",
  "DO_NOT_CONTACT",
  "LANGUAGE_SUPPORT",
  "ESCALATE",
] as const;
export type DispositionCode = (typeof DISPOSITION_CODES)[number];

export const MAX_ATTEMPTS = 5;
export const NOTE_MIN = 10;

export interface DispositionInput {
  code: DispositionCode;
  now: Date;
  attempts: number; // bu çağrı dahil deneme sayısı
  priorNoAnswer: number; // bu görevde daha önceki "cevap yok" sayısı
  phoneConsecutiveFails: number; // bu çağrıdan önceki
  note: string;
  noteRequired: boolean;
  callbackAt?: Date | null;
  language?: string | null;
  dncAllChannels?: boolean;
}

export interface DispositionPlan {
  task: { status: "OPEN" | "DONE" | "CANCELLED" | "BLOCKED" | "EXHAUSTED"; nextAttemptAt?: Date | null; closeReason?: string };
  phone?: { reachability?: "REACHED" | "UNREACHED" | "UNREACHABLE"; ownership?: "DISPUTED"; consecutiveFails: number; reached?: boolean };
  createCallbackAt?: Date;
  block?: { allChannels: boolean };
  review?: "DISPUTED_PHONE";
  reassignToLead?: boolean;
  escalateToLead?: boolean;
  setLanguage?: string;
}

export type DispositionError = "NOTE_REQUIRED" | "CALLBACK_TIME_REQUIRED" | "CALLBACK_IN_PAST" | "LANGUAGE_REQUIRED";

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export function planDisposition(i: DispositionInput): { ok: true; plan: DispositionPlan } | { ok: false; error: DispositionError } {
  if (i.noteRequired && i.note.trim().length < NOTE_MIN) return { ok: false, error: "NOTE_REQUIRED" };

  const retry = (minutes: number): DispositionPlan["task"] =>
    i.attempts >= MAX_ATTEMPTS
      ? { status: "EXHAUSTED", closeReason: "MAX_ATTEMPTS" }
      : { status: "OPEN", nextAttemptAt: addMinutes(i.now, minutes) };

  switch (i.code) {
    case "REACHED":
      return { ok: true, plan: { task: { status: "DONE" }, phone: { reachability: "REACHED", consecutiveFails: 0, reached: true } } };

    case "NO_ANSWER": {
      // 1. cevapsızlıktan sonra 4 saat, 2. ve sonrasında ertesi gün (24 saat)
      const minutes = i.priorNoAnswer >= 1 ? 24 * 60 : 4 * 60;
      return { ok: true, plan: { task: retry(minutes), phone: { reachability: "UNREACHED", consecutiveFails: i.phoneConsecutiveFails } } };
    }

    case "BUSY":
      return { ok: true, plan: { task: retry(30), phone: { consecutiveFails: i.phoneConsecutiveFails } } };

    case "INVALID_NUMBER": {
      const fails = i.phoneConsecutiveFails + 1;
      const unreachable = fails >= 2;
      return {
        ok: true,
        plan: {
          task: unreachable ? { status: "BLOCKED", closeReason: "UNREACHABLE_PHONE" } : retry(24 * 60),
          phone: { reachability: unreachable ? "UNREACHABLE" : "UNREACHED", consecutiveFails: fails },
        },
      };
    }

    case "CALLBACK_REQUESTED":
      if (!i.callbackAt) return { ok: false, error: "CALLBACK_TIME_REQUIRED" };
      if (i.callbackAt <= i.now) return { ok: false, error: "CALLBACK_IN_PAST" };
      return {
        ok: true,
        plan: {
          task: { status: "OPEN", nextAttemptAt: i.callbackAt },
          phone: { reachability: "REACHED", consecutiveFails: 0, reached: true },
          createCallbackAt: i.callbackAt,
        },
      };

    case "WRONG_PERSON":
      return {
        ok: true,
        plan: {
          task: { status: "BLOCKED", closeReason: "WRONG_PERSON" },
          phone: { ownership: "DISPUTED", consecutiveFails: 0 },
          review: "DISPUTED_PHONE",
        },
      };

    case "DO_NOT_CONTACT":
      return {
        ok: true,
        plan: {
          task: { status: "CANCELLED", closeReason: "DO_NOT_CONTACT" },
          phone: { reachability: "REACHED", consecutiveFails: 0, reached: true },
          block: { allChannels: i.dncAllChannels ?? true },
        },
      };

    case "LANGUAGE_SUPPORT":
      if (!i.language) return { ok: false, error: "LANGUAGE_REQUIRED" };
      return {
        ok: true,
        plan: {
          task: { status: "OPEN", nextAttemptAt: i.now },
          phone: { reachability: "REACHED", consecutiveFails: 0, reached: true },
          setLanguage: i.language,
          reassignToLead: true,
        },
      };

    case "ESCALATE":
      return {
        ok: true,
        plan: {
          task: { status: "DONE", closeReason: "ESCALATED" },
          phone: { reachability: "REACHED", consecutiveFails: 0, reached: true },
          escalateToLead: true,
        },
      };
  }
}

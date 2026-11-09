import { describe, expect, it } from "vitest";
import { analyzeTranscript, extractCallbackTime, type Segment } from "@/lib/speech-analysis";

const now = new Date("2026-11-08T09:00:00Z"); // İstanbul 12:00, Pazar
const seg = (speaker: Segment["speaker"], start: number, text: string): Segment => ({ speaker, start, end: start + 5, text });

describe("extractCallbackTime", () => {
  it("yarın saat 15:30", () => expect(extractCallbackTime("Yarın saat 15:30'da arayın", now)).toBe("2026-11-09T12:30:00.000Z"));
  it("pazartesi saat 2 → 14:00", () => expect(extractCallbackTime("pazartesi saat 2'de", now)).toBe("2026-11-09T11:00:00.000Z"));
  it("bugün geçmiş saat belirsiz sayılır", () => expect(extractCallbackTime("saat 10'da", now)).toBeUndefined());
  it("saat yoksa tanımsız", () => expect(extractCallbackTime("sonra arayın", now)).toBeUndefined());
});

describe("analyzeTranscript", () => {
  const base = [
    seg("AGENT", 0, "Merhaba, ben Deniz, crmPlus adına arıyorum. Görüşmemiz kalite için kayıt altına alınmaktadır."),
    seg("GUEST", 8, "Merhaba, Aralık'taki Kıbrıs tripi için otel ve fiyat bilgisi almak istiyorum."),
  ];

  it("konuları ve bildirim/tanıtım adımlarını tanır; uyuşmazlık yok", () => {
    const r = analyzeTranscript(base, "REACHED", now);
    expect(r.topics).toEqual(expect.arrayContaining(["TRIP_INTEREST", "OFFER_PRICE"]));
    expect(r.processFlags).toEqual([]);
    expect(r.dispositionMismatch).toBe(false);
  });

  it("iletişim istememe söylenip sonuç kodu farklıysa kritik uyarı", () => {
    const r = analyzeTranscript([...base, seg("GUEST", 30, "Lütfen beni bir daha aramayın.")], "REACHED", now);
    expect(r.dispositionMismatch).toBe(true);
    expect(r.processFlags.find((f) => f.code === "OPT_OUT_NOT_RECORDED")?.severity).toBe("critical");
    expect(analyzeTranscript([...base, seg("GUEST", 30, "Lütfen beni bir daha aramayın.")], "DO_NOT_CONTACT", now).dispositionMismatch).toBe(false);
  });

  it("geri arama talebi → zamanlı aksiyon önerisi", () => {
    const r = analyzeTranscript([...base, seg("GUEST", 40, "Şu an müsait değilim, yarın saat 15:30'da tekrar arayın.")], "CALLBACK_REQUESTED", now);
    expect(r.actions[0]).toMatchObject({ type: "CALLBACK", at: "2026-11-09T12:30:00.000Z" });
    expect(r.dispositionMismatch).toBe(false);
  });

  it("kayıt bildirimi ve tanıtım yoksa uyarı", () => {
    const r = analyzeTranscript([seg("AGENT", 0, "Merhaba."), seg("GUEST", 3, "Evet?")], "REACHED", now);
    expect(r.processFlags.map((f) => f.code)).toEqual(["RECORDING_NOTICE_MISSING", "SELF_INTRO_MISSING"]);
  });

  it("sonuçta duygu/skor alanı yok (ürün sınırı)", () => {
    const r = analyzeTranscript(base, "REACHED", now) as unknown as Record<string, unknown>;
    for (const forbidden of ["sentiment", "emotion", "score", "risk", "personality", "persuadability"]) expect(r).not.toHaveProperty(forbidden);
  });
});

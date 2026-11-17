import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { checkWaTemplate, optOutSuspect, parseMetaWebhook, renderWaTemplate, verifyMetaSignature, windowState } from "@/lib/whatsapp";

describe("24 saat penceresi", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("son misafir mesajından 24 saat", () => {
    expect(windowState(new Date("2026-11-11T13:00:00Z"), now).open).toBe(true);
    expect(windowState(new Date("2026-11-11T11:59:00Z"), now).open).toBe(false);
    expect(windowState(null, now).open).toBe(false);
  });
});

describe("şablon kontrolü", () => {
  const base = { name: "kasim_gezisi", body: "Merhaba {{1}}, temsilciniz {{2}} sizi arayacak.", variables: ["ad", "temsilci_adi"], category: "UTILITY" as const, optOutButton: false };
  it("geçerli şablon", () => expect(checkWaTemplate(base).errors).toEqual([]));
  it("Meta ad kuralı, sıra, değişken sayısı", () => {
    expect(checkWaTemplate({ ...base, name: "Kasım Gezisi" }).errors[0]).toContain("küçük harf");
    expect(checkWaTemplate({ ...base, body: "Merhaba {{2}}" , variables: ["ad"] }).errors.join()).toContain("sırayla");
    expect(checkWaTemplate({ ...base, variables: ["ad"] }).errors.join()).toContain("2 yer tutucu");
  });
  it("finansal değişken ve pazarlamada ret düğmesi", () => {
    expect(checkWaTemplate({ ...base, variables: ["ad", "kayip_tutari"] }).errors.join()).toContain("izinli değişken değil");
    expect(checkWaTemplate({ ...base, category: "MARKETING" }).errors.join()).toContain("Aboneliği iptal et");
  });
  it("doldurma", () => expect(renderWaTemplate(base.body, base.variables, { ad: "Ayşe", temsilci_adi: "Deniz" })).toBe("Merhaba Ayşe, temsilciniz Deniz sizi arayacak."));
});

describe("ret şüphesi", () => {
  it.each(["Lütfen bana bir daha yazmayın", "Rahatsız etmeyin", "ilgilenmiyorum teşekkürler"])("%s → şüphe", (t) => expect(optOutSuspect(t)).toBe(true));
  it.each(["RET", "Ne zaman?", "Teşekkürler"])("%s → şüphe değil", (t) => expect(optOutSuspect(t)).toBe(false));
});

describe("Meta webhook", () => {
  it("imza doğrulama", () => {
    const body = '{"a":1}';
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyMetaSignature("s3cret", body, sig)).toBe(true);
    expect(verifyMetaSignature("s3cret", body + " ", sig)).toBe(false);
    expect(verifyMetaSignature(undefined, body, sig)).toBe(false);
  });
  it("mesaj, düğme ve durum olayları", () => {
    const ev = parseMetaWebhook({
      entry: [{ changes: [{ value: {
        messages: [
          { id: "wamid.1", from: "4915112345678", timestamp: "1794480000", type: "text", text: { body: "Merhaba" } },
          { id: "wamid.2", from: "4915112345678", timestamp: "1794480010", type: "button", button: { payload: "OPT_OUT", text: "Aboneliği iptal et" } },
        ],
        statuses: [{ id: "wamid.out", status: "read", timestamp: "1794480020", recipient_id: "4915112345678" }, { id: "x", status: "deleted", timestamp: "1", recipient_id: "1" }],
      } }] }],
    });
    expect(ev).toHaveLength(3);
    expect(ev[0]).toMatchObject({ kind: "message", from: "+4915112345678", text: "Merhaba" });
    expect(ev[1]).toMatchObject({ kind: "message", buttonPayload: "OPT_OUT" });
    expect(ev[2]).toMatchObject({ kind: "status", status: "read" });
  });
});

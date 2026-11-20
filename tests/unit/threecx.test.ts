import { describe, expect, it } from "vitest";
import { parseWsEvent, ParticipantTracker, toDialString } from "@/lib/threecx";

describe("toDialString", () => {
  it("santral biçimine çevirir", () => {
    expect(toDialString("+905321234567")).toBe("+905321234567");
    expect(toDialString("+905321234567", "00")).toBe("00905321234567");
    expect(toDialString("+905321234567", "national")).toBe("05321234567");
    expect(toDialString("+4915112345678", "national")).toBe("004915112345678"); // yurt dışı: uluslararası önek
    expect(() => toDialString("05321234567")).toThrow();
  });
});

describe("parseWsEvent", () => {
  it("katılımcı olaylarını ayrıştırır, diğerlerini tanır", () => {
    expect(parseWsEvent('{"sequence":3,"event":{"event_type":0,"entity":"/callcontrol/101/participants/7"}}')).toEqual({ type: "upsert", entity: "/callcontrol/101/participants/7", dn: "101", participantId: 7 });
    expect(parseWsEvent('{"event":{"event_type":1,"entity":"/callcontrol/101/participants/7"}}')?.type).toBe("remove");
    expect(parseWsEvent('{"event":{"event_type":0,"entity":"/callcontrol/101"}}')).toMatchObject({ type: "upsert", dn: undefined });
    expect(parseWsEvent("bozuk")).toBeNull();
    expect(parseWsEvent('{"x":1}')).toBeNull();
  });
});

describe("ParticipantTracker", () => {
  const t0 = new Date("2026-11-17T10:00:00Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it("Dialing → Connected → kaldırma: bir kez answered, sonra konuşma süreli ended", () => {
    const tr = new ParticipantTracker();
    expect(tr.upsert({ id: 7, dn: "101", status: "Dialing", callid: 555 }, at(0))).toEqual([]);
    expect(tr.upsert({ id: 7, dn: "101", status: "Connected", callid: 555 }, at(12))).toEqual([{ eventId: "3cx:555:answered", event: "answered", externalId: "555", at: at(12).toISOString() }]);
    expect(tr.upsert({ id: 7, dn: "101", status: "Connected", callid: 555 }, at(20))).toEqual([]); // tekrar bağlandı sayılmaz
    expect(tr.remove("101", 7, at(95))).toEqual([{ eventId: "3cx:555:ended", event: "ended", externalId: "555", at: at(95).toISOString(), talkSec: 83 }]);
    expect(tr.size).toBe(0);
  });

  it("cevaplanmayan arama: konuşma süresi 0; bilinmeyen katılımcının kaldırılması yok sayılır", () => {
    const tr = new ParticipantTracker();
    tr.upsert({ id: 9, dn: "102", status: "Dialing", callid: 600 }, at(0));
    expect(tr.remove("102", 9, at(30))).toEqual([{ eventId: "3cx:600:ended", event: "ended", externalId: "600", at: at(30).toISOString(), talkSec: 0 }]);
    expect(tr.remove("102", 99, at(31))).toEqual([]);
  });
});

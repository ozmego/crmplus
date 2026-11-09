import { describe, expect, it } from "vitest";
import { evaluateAnomalies, type ActorCounts } from "@/lib/anomaly";

const quiet: ActorCounts = { actorId: "u1", distinctGuestViews10m: 5, reveals24h: 2, exports24h: 1, maxExportRows24h: 200, deniedExports1h: 0, denied1h: 0, listens24h: 1 };

describe("evaluateAnomalies (docs/08 §2)", () => {
  it("normal kullanım uyarı üretmez", () => expect(evaluateAnomalies([quiet], [{ key: "a@b", failed15m: 2 }])).toEqual([]));
  it("toplu görüntüleme, maskesiz eşik, toplu export, yetkisiz export, dinleme hacmi", () => {
    const r = evaluateAnomalies(
      [{ ...quiet, distinctGuestViews10m: 140, reveals24h: 24, maxExportRows24h: 9000, deniedExports1h: 2, listens24h: 31, denied1h: 11 }],
      [],
    );
    expect(r.map((a) => [a.rule, a.severity])).toEqual([
      ["MASS_VIEW", "P2"], ["REVEAL_THRESHOLD", "P3"], ["BULK_EXPORT", "P2"], ["DENIED_EXPORT", "P2"], ["REPEATED_DENIED", "P3"], ["LISTEN_VOLUME", "P3"],
    ]);
  });
  it("başarısız giriş patlaması", () => expect(evaluateAnomalies([], [{ key: "1.2.3.4", failed15m: 12 }])[0]).toMatchObject({ rule: "FAILED_LOGIN_BURST", severity: "P3" }));
});

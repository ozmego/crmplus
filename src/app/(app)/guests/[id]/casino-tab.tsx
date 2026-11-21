import { BadgeCheck, CircleAlert, FileText, Gem, Hash, IdCard, Landmark, Lock, Plane, Settings2 } from "lucide-react";
import { can, type Principal } from "@/server/auth/rbac";
import { db } from "@/server/db";
import { getCasinoProfile, guestCreditLines } from "@/server/services/casino-profile";
import { DOCUMENT_KINDS, DOCUMENT_MAX_BYTES, GAMES } from "@/lib/identity";
import { FinanceForm } from "@/components/finance-form";
import { OpenDocument, ProfileForm } from "@/components/profile-forms";
import { casinoNumberAction, creditAction, documentDeleteAction, documentUploadAction, identityAction, preferencesAction, travelAction } from "./profile-actions";

const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("tr-TR", { timeZone: "UTC" }) : "—");
const dt = (d: Date | null | undefined) => (d ? d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }) : "—");
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const isoLocal = (d: Date | null | undefined) =>
  d ? new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 16) : ""; // datetime-local (İstanbul)
const money = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const GENDER: Record<string, string> = { F: "Kadın", M: "Erkek", X: "Belirtilmemiş" };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-sm last:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium text-ink">{v}</dd>
    </div>
  );
}

function Card({ title, icon: Icon, children, locked }: { title: string; icon: typeof Gem; children: React.ReactNode; locked?: string }) {
  return (
    <section className={"rounded-xl border p-4 shadow-[0_1px_2px_rgb(18_18_20/0.04)] " + (locked ? "border-warn/50 bg-warn-bg/50" : "border-line bg-white")}>
      <h2 className="card-title flex items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden /> {title}
        {locked && <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-warn-ink"><Lock className="h-3 w-3" aria-hidden /> {locked}</span>}
      </h2>
      {children}
    </section>
  );
}

export async function CasinoTab({ user, guestId }: { user: Principal; guestId: string }) {
  const p = await getCasinoProfile(user, guestId);
  const editIdentity = can(user, "guest.edit") && can(user, "field.identity");
  const edit = can(user, "guest.edit");
  const editTravel = edit || can(user, "finance.result.edit");
  const hosts = edit ? await db.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const id = p.identity;

  return (
    <div className="flex flex-col gap-4">
      {p.gaps.length > 0 ? (
        <div className="callout-warn flex items-start gap-2" data-testid="profile-gaps">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" aria-hidden />
          <div>
            <b>Casino profili eksik:</b> {p.gaps.join(" · ")}
          </div>
        </div>
      ) : (
        <p className="callout-info flex items-center gap-2" data-testid="profile-gaps"><BadgeCheck className="h-4 w-4 text-teal-ink" aria-hidden /> Casino profili tamam.</p>
      )}
      <p className="text-xs text-muted">Bu kayıt yalnız sistem içinde tutulur; dışa aktarılmaz. Kimlik ve belge görüntülemeleri erişim kaydına yazılır.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Kimlik" icon={IdCard} locked={p.seeIdentity ? undefined : "kimlik yetkisi gerekir"}>
          <dl>
            <Row k="Uyruk" v={id?.nationality ?? "—"} />
            <Row k="Cinsiyet" v={id?.gender ? GENDER[id.gender] ?? id.gender : "—"} />
            <Row k="Doğum tarihi" v={p.seeIdentity ? day(id?.birthDate) : "gizli"} />
            <Row k="T.C. kimlik no" v={<span className="font-mono">{id?.tcNo ?? id?.tcNoMasked ?? "—"}</span>} />
            <Row k="Pasaport no" v={<span className="font-mono">{id?.passportNo ?? id?.passportNoMasked ?? "—"}{id?.passportCountry ? ` (${id.passportCountry})` : ""}</span>} />
            <Row k="Pasaport geçerlilik" v={day(id?.passportExpiry)} />
            <Row k="Adres" v={p.seeIdentity ? id?.address ?? "—" : id?.hasAddress ? "kayıtlı (gizli)" : "—"} />
          </dl>
          {editIdentity && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Kimlik bilgilerini düzenle</summary>
              <ProfileForm action={identityAction} submit="Kimliği kaydet" className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="guestId" value={guestId} />
                <div><label className="label" htmlFor="nationality">Uyruk (ISO)</label><input id="nationality" name="nationality" defaultValue={id?.nationality ?? ""} maxLength={2} className="input uppercase" placeholder="TR" /></div>
                <div><label className="label" htmlFor="gender">Cinsiyet</label>
                  <select id="gender" name="gender" defaultValue={id?.gender ?? ""} className="input min-h-11"><option value="">—</option><option value="F">Kadın</option><option value="M">Erkek</option><option value="X">Belirtilmemiş</option></select>
                </div>
                <div><label className="label" htmlFor="birthDate">Doğum tarihi</label><input id="birthDate" name="birthDate" type="date" defaultValue={iso(id?.birthDate)} className="input" /></div>
                <div><label className="label" htmlFor="tcNo">T.C. kimlik no (değiştirmek için)</label><input id="tcNo" name="tcNo" inputMode="numeric" maxLength={11} className="input font-mono" placeholder={id?.tcNoMasked ?? "11 hane"} /></div>
                <div><label className="label" htmlFor="passportNo">Pasaport no (değiştirmek için)</label><input id="passportNo" name="passportNo" className="input font-mono" placeholder={id?.passportNoMasked ?? ""} /></div>
                <div><label className="label" htmlFor="passportCountry">Pasaport ülkesi</label><input id="passportCountry" name="passportCountry" defaultValue={id?.passportCountry ?? ""} maxLength={2} className="input uppercase" /></div>
                <div><label className="label" htmlFor="passportExpiry">Pasaport geçerlilik</label><input id="passportExpiry" name="passportExpiry" type="date" defaultValue={iso(id?.passportExpiry)} className="input" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="address">Adres (değiştirmek için)</label><input id="address" name="address" maxLength={500} className="input" placeholder={id?.hasAddress ? "kayıtlı" : ""} /></div>
              </ProfileForm>
            </details>
          )}
        </Card>

        <Card title="Belgeler" icon={FileText} locked={p.seeIdentity ? undefined : "kimlik yetkisi gerekir"}>
          {!p.documents ? (
            <p className="text-sm text-muted">{p.documentCount} belge kayıtlı. Görüntülemek için kimlik yetkisi gerekir.</p>
          ) : p.documents.length === 0 ? (
            <p className="text-sm text-muted">Belge yok.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {p.documents.map((d) => (
                <li key={d.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><b>{DOCUMENT_KINDS[d.kind] ?? d.kind}</b> · {d.fileName} <span className="text-xs text-muted">({Math.round(d.size / 1024)} KB · {dt(d.createdAt)})</span></span>
                    <OpenDocument documentId={d.id} label={DOCUMENT_KINDS[d.kind] ?? d.kind} />
                  </div>
                  {editIdentity && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted hover:text-critical">Kaldır</summary>
                      <FinanceForm action={documentDeleteAction} submit="Belgeyi kaldır" tone="danger" inline fields={[{ name: "guestId", type: "hidden", value: guestId }, { name: "documentId", type: "hidden", value: d.id }, { name: "reason", label: "Gerekçe", required: true }]} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editIdentity && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Belge yükle</summary>
              <ProfileForm action={documentUploadAction} submit="Yükle ve tara" className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="guestId" value={guestId} />
                <div><label className="label" htmlFor="kind">Tür</label>
                  <select id="kind" name="kind" required className="input min-h-11">{Object.entries(DOCUMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                </div>
                <div><label className="label" htmlFor="file">Dosya (JPEG, PNG, PDF · en fazla {DOCUMENT_MAX_BYTES / 1024 / 1024} MB)</label><input id="file" name="file" type="file" required accept="image/jpeg,image/png,application/pdf" className="input py-2" /></div>
              </ProfileForm>
            </details>
          )}
        </Card>

        <Card title="Casino tercihleri ve limitler" icon={Settings2}>
          <dl>
            <Row k="Oyunlar" v={p.preferences?.games.length ? p.preferences.games.map((g) => GAMES[g] ?? g).join(", ") : "—"} />
            <Row k="Masa limiti" v={p.preferences && (p.preferences.tableMin || p.preferences.tableMax) ? `${(p.preferences.tableMin ?? 0).toLocaleString("tr-TR")} – ${(p.preferences.tableMax ?? 0).toLocaleString("tr-TR")} ${p.preferences.limitCurrency ?? ""}` : "—"} />
            <Row k="Host" v={p.preferences?.host?.name ?? "—"} />
            <Row k="Özel istekler" v={p.preferences?.preferences ?? "—"} />
          </dl>
          {edit && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-teal-ink">Tercihleri düzenle</summary>
              <ProfileForm action={preferencesAction} submit="Tercihleri kaydet" className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="guestId" value={guestId} />
                <fieldset className="sm:col-span-2">
                  <legend className="label">Oyunlar</legend>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {Object.entries(GAMES).map(([k, v]) => (
                      <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" name="games" value={k} defaultChecked={p.preferences?.games.includes(k)} /> {v}</label>
                    ))}
                  </div>
                </fieldset>
                <div><label className="label" htmlFor="tableMin">Masa alt limit</label><input id="tableMin" name="tableMin" inputMode="numeric" defaultValue={p.preferences?.tableMin ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="tableMax">Masa üst limit</label><input id="tableMax" name="tableMax" inputMode="numeric" defaultValue={p.preferences?.tableMax ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="limitCurrency">Para birimi</label><input id="limitCurrency" name="limitCurrency" maxLength={3} defaultValue={p.preferences?.limitCurrency ?? "TRY"} className="input uppercase" /></div>
                <div><label className="label" htmlFor="hostUserId">Host</label>
                  <select id="hostUserId" name="hostUserId" defaultValue={p.preferences?.host?.id ?? ""} className="input min-h-11"><option value="">—</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
                </div>
                <div className="sm:col-span-2"><label className="label" htmlFor="preferences">Özel istekler (oda, yemek, sigara…; sağlık bilgisi yazmayın)</label><textarea id="preferences" name="preferences" rows={2} maxLength={1000} defaultValue={p.preferences?.preferences ?? ""} className="input py-2" /></div>
              </ProfileForm>
            </details>
          )}
        </Card>

        <Card title="Casino oyuncu numaraları" icon={Hash}>
          {p.casinoNumbers.length === 0 ? (
            <p className="text-sm text-muted">Kayıtlı numara yok.</p>
          ) : (
            <dl>{p.casinoNumbers.map((n) => <Row key={n.id} k={n.source} v={<span className="font-mono">{n.value}</span>} />)}</dl>
          )}
          {edit && p.casinos.length > 0 && (
            <div className="mt-3">
              <FinanceForm action={casinoNumberAction} submit="Ekle" inline fields={[
                { name: "guestId", type: "hidden", value: guestId },
                { name: "casinoId", label: "Casino", type: "select", required: true, options: p.casinos.map((c) => ({ value: c.id, label: c.name })) },
                { name: "number", label: "Oyuncu no", required: true },
              ]} />
            </div>
          )}
        </Card>
      </div>

      <Card title="Seyahat · trip bazında" icon={Plane}>
        {p.trips.length === 0 ? (
          <p className="text-sm text-muted">Trip katılımı yok. Tripe ekleme finans bölümünden yapılır.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {p.trips.map((t) => (
              <li key={t.tripGuestId} className="rounded-lg border border-line p-3" data-testid="travel">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink">{t.name} <span className="text-sm font-normal text-muted">· {t.casino} · {day(t.startDate)} – {day(t.endDate)}</span></p>
                  {!t.travel && t.status === "PLANNED" && <span className="pill border-warn text-warn-ink">seyahat bilgisi yok</span>}
                </div>
                {t.travel && (
                  <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
                    <Row k="Gidiş" v={`${t.travel.outFlight ?? "—"} · ${t.travel.outRoute ?? ""} · ${dt(t.travel.outAt)}`} />
                    <Row k="Dönüş" v={`${t.travel.retFlight ?? "—"} · ${t.travel.retRoute ?? ""} · ${dt(t.travel.retAt)}`} />
                    <Row k="PNR" v={<span className="font-mono">{t.travel.pnr ?? "—"}</span>} />
                    <Row k="Otel / oda" v={`${t.travel.hotel ?? "—"}${t.travel.roomType ? ` · ${t.travel.roomType}` : ""}`} />
                    <Row k="Giriş – çıkış" v={`${day(t.travel.checkIn)} – ${day(t.travel.checkOut)}`} />
                    <Row k="Transfer" v={t.travel.transfer ?? "—"} />
                    <Row k="Refakatçi" v={t.travel.companion ?? "—"} />
                    <Row k="Not" v={t.travel.note ?? "—"} />
                  </dl>
                )}
                {editTravel && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold text-teal-ink">{t.travel ? "Seyahat bilgisini düzenle" : "Seyahat bilgisi ekle"}</summary>
                    <ProfileForm action={travelAction} submit="Seyahati kaydet" className="mt-3 grid gap-3 sm:grid-cols-3">
                      <input type="hidden" name="guestId" value={guestId} />
                      <input type="hidden" name="tripGuestId" value={t.tripGuestId} />
                      {(
                        [
                          ["outFlight", "Gidiş uçuşu", "text", t.travel?.outFlight], ["outRoute", "Gidiş güzergâhı", "text", t.travel?.outRoute], ["outAt", "Gidiş zamanı", "datetime-local", isoLocal(t.travel?.outAt)],
                          ["retFlight", "Dönüş uçuşu", "text", t.travel?.retFlight], ["retRoute", "Dönüş güzergâhı", "text", t.travel?.retRoute], ["retAt", "Dönüş zamanı", "datetime-local", isoLocal(t.travel?.retAt)],
                          ["pnr", "PNR", "text", t.travel?.pnr], ["hotel", "Otel", "text", t.travel?.hotel], ["roomType", "Oda tipi", "text", t.travel?.roomType],
                          ["checkIn", "Otel giriş", "date", iso(t.travel?.checkIn)], ["checkOut", "Otel çıkış", "date", iso(t.travel?.checkOut)], ["transfer", "Transfer", "text", t.travel?.transfer],
                          ["companion", "Refakatçi", "text", t.travel?.companion], ["note", "Not", "text", t.travel?.note],
                        ] as const
                      ).map(([name, label, type, val]) => (
                        <div key={name}><label className="label" htmlFor={`${name}-${t.tripGuestId}`}>{label}</label><input id={`${name}-${t.tripGuestId}`} name={name} type={type} defaultValue={val ?? ""} className="input" /></div>
                      ))}
                    </ProfileForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Finans sekmesindeki ön yatırım / kredi hattı (finance.view; düzenleme finance.result.edit). */
export async function CreditLines({ user, guestId }: { user: Principal; guestId: string }) {
  const { lines, casinos } = await guestCreditLines(user, guestId);
  return (
    <Card title="Ön yatırım ve kredi hattı" icon={Landmark}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">Kayıt yok.</p>
      ) : (
        <table className="table-ink">
          <thead><tr><th scope="col">Casino</th><th scope="col">Ön yatırım</th><th scope="col">Kredi hattı</th><th scope="col">Not</th><th scope="col">Güncelleme</th></tr></thead>
          <tbody className="tabular-nums">
            {lines.map((c) => (
              <tr key={c.casinoId}><td>{c.casino}</td><td>{money(c.frontMoney)} {c.currency}</td><td>{money(c.creditLimit)} {c.currency}</td><td>{c.note ?? "—"}</td><td>{dt(c.updatedAt)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {can(user, "finance.result.edit") && casinos.length > 0 && (
        <div className="mt-3">
          <FinanceForm action={creditAction} submit="Kaydet" inline fields={[
            { name: "guestId", type: "hidden", value: guestId },
            { name: "casinoId", label: "Casino", type: "select", required: true, options: casinos.map((c) => ({ value: c.id, label: `${c.name} (${c.currency})` })) },
            { name: "frontMoney", label: "Ön yatırım", type: "number" },
            { name: "creditLimit", label: "Kredi hattı", type: "number" },
            { name: "note", label: "Not" },
          ]} />
        </div>
      )}
    </Card>
  );
}

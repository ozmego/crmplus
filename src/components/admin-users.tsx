"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createUserAction, setRolesAction, setTeamAction, upsertTeamAction, userStatusAction } from "@/app/(app)/admin/actions";

const ERR: Record<string, string> = {
  EMAIL_EXISTS: "Bu e-posta ile kullanıcı zaten var.",
  UNKNOWN_ROLE: "Geçersiz rol.",
  SELF_ASSIGN: "Kendinize rol veremezsiniz.",
  SELF_DISABLE: "Kendi hesabınızı kapatamazsınız.",
  SELF_RESET: "Kendi hesabınız için bu işlemi yapamazsınız.",
  NOT_FOUND: "Kullanıcı bulunamadı.",
  INVALID_INPUT: "Alanları kontrol edin (gerekçe en az 5 karakter).",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
};
const msg = (e: string) => ERR[e] ?? e;

type Role = { key: string; name: string };
type Team = { id: string; name: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk?: (d: T) => void) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (r.ok) {
        onOk?.(r.data);
        router.refresh();
      } else setErr(msg(r.error));
    });
  return { pending, err, run };
}

export function TempPasswordNotice({ password, onClose }: { password: string; onClose: () => void }) {
  return (
    <div role="status" className="callout-warn flex flex-col gap-2">
      <p className="font-semibold">Geçici şifre — yalnız bir kez gösterilir</p>
      <p className="font-mono text-lg tracking-wider">{password}</p>
      <p className="text-xs">Kullanıcıya güvenli bir kanaldan iletin. İlk girişte şifresini değiştirip MFA kuracak.</p>
      <button type="button" className="btn-secondary min-h-9 self-start" onClick={onClose}>Kapat</button>
    </div>
  );
}

export function CreateUserForm({ roles, teams }: { roles: Role[]; teams: Team[] }) {
  const { pending, err, run } = useAct();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [pw, setPw] = useState<string | null>(null);
  if (pw) return <TempPasswordNotice password={pw} onClose={() => { setPw(null); setOpen(false); }} />;
  if (!open) return <button type="button" className="btn-primary self-start" onClick={() => setOpen(true)}>+ Yeni kullanıcı</button>;
  return (
    <form
      className="card flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createUserAction({ email, name, teamId: teamId || undefined, roleKeys: sel, reason }), (d) => setPw(d.tempPassword));
      }}
    >
      <h2 className="card-title">Yeni kullanıcı</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <div><label htmlFor="nu-email" className="label">E-posta</label><input id="nu-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" /></div>
        <div><label htmlFor="nu-name" className="label">Ad soyad</label><input id="nu-name" required value={name} onChange={(e) => setName(e.target.value)} className="input" /></div>
        <div>
          <label htmlFor="nu-team" className="label">Ekip</label>
          <select id="nu-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="input">
            <option value="">—</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="label">Roller</legend>
        <div className="flex flex-wrap gap-3">
          {roles.map((r) => (
            <label key={r.key} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={sel.includes(r.key)} onChange={(e) => setSel(e.target.checked ? [...sel, r.key] : sel.filter((k) => k !== r.key))} />
              {r.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div><label htmlFor="nu-reason" className="label">Gerekçe</label><input id="nu-reason" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="ör. Kasım işe alımı, çağrı ekibi" /></div>
      {err && <p role="alert" className="text-sm font-semibold text-critical">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending || sel.length === 0}>Oluştur</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Vazgeç</button>
      </div>
    </form>
  );
}

export function UserRowActions({
  userId, isSelf, status, roleKeys, teamId, roles, teams, canRoles, canTeam, canManage,
}: {
  userId: string; isSelf: boolean; status: string; roleKeys: string[]; teamId: string | null; roles: Role[]; teams: Team[];
  canRoles: boolean; canTeam: boolean; canManage: boolean;
}) {
  const { pending, err, run } = useAct();
  const [mode, setMode] = useState<null | "roles" | "team" | "disable" | "enable" | "reset_password" | "reset_mfa">(null);
  const [sel, setSel] = useState(roleKeys);
  const [team, setTeam] = useState(teamId ?? "");
  const [reason, setReason] = useState("");
  const [pw, setPw] = useState<string | null>(null);
  if (pw) return <TempPasswordNotice password={pw} onClose={() => { setPw(null); setMode(null); }} />;
  if (!mode) {
    return (
      <div className="flex flex-wrap gap-1">
        {canRoles && !isSelf && <button type="button" className="text-xs font-semibold text-teal-ink hover:underline" onClick={() => setMode("roles")}>Roller</button>}
        {canTeam && <button type="button" className="text-xs font-semibold text-teal-ink hover:underline" onClick={() => setMode("team")}>Ekip</button>}
        {canManage && !isSelf && status === "ACTIVE" && <button type="button" className="text-xs font-semibold text-critical hover:underline" onClick={() => setMode("disable")}>Pasifleştir</button>}
        {canManage && !isSelf && status !== "ACTIVE" && <button type="button" className="text-xs font-semibold text-teal-ink hover:underline" onClick={() => setMode("enable")}>Etkinleştir</button>}
        {canManage && !isSelf && <button type="button" className="text-xs font-semibold text-teal-ink hover:underline" onClick={() => setMode("reset_password")}>Şifre sıfırla</button>}
        {canManage && !isSelf && <button type="button" className="text-xs font-semibold text-teal-ink hover:underline" onClick={() => setMode("reset_mfa")}>MFA sıfırla</button>}
      </div>
    );
  }
  const label = { roles: "Rolleri kaydet", team: "Ekibi kaydet", disable: "Pasifleştir", enable: "Etkinleştir", reset_password: "Şifreyi sıfırla", reset_mfa: "MFA'yı sıfırla" }[mode];
  return (
    <form
      className="flex min-w-72 flex-col gap-2 rounded-md border border-line bg-white p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === "roles") run(() => setRolesAction(userId, sel, reason), () => setMode(null));
        else if (mode === "team") run(() => setTeamAction(userId, team || null, reason), () => setMode(null));
        else run(() => userStatusAction(userId, mode, reason), (d) => (typeof d === "string" ? setPw(d) : setMode(null)));
      }}
    >
      {mode === "roles" && (
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <label key={r.key} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={sel.includes(r.key)} onChange={(e) => setSel(e.target.checked ? [...sel, r.key] : sel.filter((k) => k !== r.key))} />
              {r.name}
            </label>
          ))}
        </div>
      )}
      {mode === "team" && (
        <select aria-label="Ekip" value={team} onChange={(e) => setTeam(e.target.value)} className="input min-h-9">
          <option value="">— Ekipsiz —</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {mode === "disable" && <p className="text-xs text-critical">Tüm oturumları anında kapanır; açık görev ve geri aramaları ekip liderine aktarılır.</p>}
      {mode === "roles" && <p className="text-xs text-muted">Kaydedince kullanıcının açık oturumları kapanır; yeni yetkilerle tekrar girer.</p>}
      <input aria-label="Gerekçe" placeholder="Gerekçe (kayıt altına alınır)" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} className="input min-h-9" />
      {err && <p role="alert" className="text-xs font-semibold text-critical">{err}</p>}
      <div className="flex gap-2">
        <button className={(mode === "disable" ? "btn-danger" : "btn-primary") + " min-h-9"} disabled={pending}>{label}</button>
        <button type="button" className="btn-secondary min-h-9" onClick={() => setMode(null)}>Vazgeç</button>
      </div>
    </form>
  );
}

export function TeamForm({ teams, leaders }: { teams: (Team & { leaderId: string | null })[]; leaders: { id: string; name: string }[] }) {
  const { pending, err, run } = useAct();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [leader, setLeader] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="card flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => upsertTeamAction({ id: id || undefined, name, leaderId: leader || null }, reason), () => { setId(""); setName(""); setLeader(""); setReason(""); });
      }}
    >
      <h2 className="card-title">Ekip oluştur / düzenle</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label htmlFor="tm-id" className="label">Ekip</label>
          <select
            id="tm-id"
            value={id}
            onChange={(e) => {
              const t = teams.find((x) => x.id === e.target.value);
              setId(e.target.value);
              setName(t?.name ?? "");
              setLeader(t?.leaderId ?? "");
            }}
            className="input"
          >
            <option value="">+ Yeni ekip</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="tm-name" className="label">Ad</label><input id="tm-name" required value={name} onChange={(e) => setName(e.target.value)} className="input" /></div>
        <div>
          <label htmlFor="tm-leader" className="label">Takım lideri</label>
          <select id="tm-leader" value={leader} onChange={(e) => setLeader(e.target.value)} className="input">
            <option value="">—</option>
            {leaders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div><label htmlFor="tm-reason" className="label">Gerekçe</label><input id="tm-reason" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} className="input" /></div>
      </div>
      {err && <p role="alert" className="text-sm font-semibold text-critical">{err}</p>}
      <button className="btn-primary self-start" disabled={pending}>Kaydet</button>
    </form>
  );
}

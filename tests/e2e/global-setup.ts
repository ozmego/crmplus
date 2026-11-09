import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/server/auth/password";
import { blindIndex, encrypt } from "../../src/server/crypto/field-encryption";
import { normalizePhone } from "../../src/lib/phone";

/**
 * Yalnız testlerin kullandığı hesaplar (geliştiricinin kendi hesaplarına dokunulmaz).
 * Kural: her test dosyası ilk girişi farklı bir hesapla yapar; aynı hesabı iki test kullanmaz.
 *   auth-queue → temsilci1 · import → veri · admin → e2e-admin + temsilci2 · reports → operasyon + e2e-temsilci · compare → e2e-veri · finance → e2e-finans1/2 + e2e-temsilci-f · speech → e2e-ayar + e2e-temsilci-s + lider · messages → e2e-ops1/2 + e2e-temsilci-m · hr → e2e-ik1/2 + e2e-lider-p + e2e-temsilci-p + e2e-saha
 */
const E2E_ONLY: [email: string, role: string, name: string][] = [
  ["e2e-admin@crmplus.local", "sys_admin", "E2E Yönetici"],
  ["e2e-temsilci@crmplus.local", "agent", "E2E Temsilci"],
  ["e2e-veri@crmplus.local", "data_loader", "E2E Veri Yükleyici"],
  ["e2e-finans1@crmplus.local", "finance", "E2E Finans Hazırlayan"],
  ["e2e-finans2@crmplus.local", "finance", "E2E Finans Onaylayan"],
  ["e2e-temsilci-f@crmplus.local", "agent", "E2E Temsilci (finans testi)"],
  ["e2e-ayar@crmplus.local", "sys_admin", "E2E Ayar Yöneticisi"],
  ["e2e-temsilci-s@crmplus.local", "agent", "E2E Temsilci (ses testi)"],
  ["e2e-ops1@crmplus.local", "ops_manager", "E2E Kampanya Hazırlayan"],
  ["e2e-ops2@crmplus.local", "ops_manager", "E2E Kampanya Onaylayan"],
  ["e2e-temsilci-m@crmplus.local", "agent", "E2E Temsilci (mesaj testi)"],
  ["e2e-ik1@crmplus.local", "hr", "E2E İK Bir"],
  ["e2e-ik2@crmplus.local", "hr", "E2E İK İki"],
  ["e2e-lider-p@crmplus.local", "team_lead", "E2E Lider Personel"],
  ["e2e-temsilci-p@crmplus.local", "agent", "E2E Temsilci Puantaj"],
  ["e2e-saha@crmplus.local", "field_staff", "E2E Saha Host"],
];
const DEMO_RESET = ["temsilci1@crmplus.local", "temsilci2@crmplus.local", "veri@crmplus.local", "operasyon@crmplus.local", "lider@crmplus.local"];

/** Testte kullanılan hesapları ilk giriş durumuna döndürür (şifre değişimi + MFA kurulumu gerekecek). */
export default async function globalSetup() {
  process.loadEnvFile?.(".env");
  const db = new PrismaClient();
  try {
    const passwordHash = await hashPassword(process.env.SEED_ADMIN_PASSWORD!);
    for (const [email, roleKey, name] of E2E_ONLY) {
      const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
      await db.user.upsert({
        where: { email },
        update: {},
        create: { email, name, passwordHash, roles: { create: { roleId: role.id, assignedBy: "e2e" } } },
      });
    }
    // Önceki çalıştırmalardan kalan test kullanıcıları
    await db.user.updateMany({ where: { email: { startsWith: "e2e-yeni-" } }, data: { status: "DISABLED" } });

    for (const email of [...DEMO_RESET, ...E2E_ONLY.map(([e]) => e)]) {
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await db.call.updateMany({ where: { agentId: user.id, closedAt: null }, data: { closedAt: new Date(), autoClosed: true } });
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: true, mfaSecretEnc: null, mfaEnabledAt: null, failedLogins: 0, lockedUntil: null, status: "ACTIVE" },
      });
    }

    // Ses testi: kapı her çalıştırmada kapalı başlar; ses temsilcisi Ekip 1'de (lider dinleyebilsin)
    await db.setting.deleteMany({ where: { key: "recording.gate" } });
    const team1 = await db.team.findUniqueOrThrow({ where: { name: "Ekip 1" } });
    await db.user.update({ where: { email: "e2e-temsilci-s@crmplus.local" }, data: { teamId: team1.id } });

    // Kuyruk ve ses testleri için her çalıştırmada taze, izinli görevler (demo verisi tükenmesin)
    const stamp = Date.now() % 1_000_000;
    for (const [k, email] of ["temsilci1@crmplus.local", "e2e-temsilci-s@crmplus.local"].entries()) {
    const agent = await db.user.findUniqueOrThrow({ where: { email } });
    for (let i = 0; i < 3; i++) {
      const n = normalizePhone(`053${3 + k}${String(stamp * 3 + i).padStart(7, "0").slice(-7)}`, "TR");
      if (!n.ok || !n.e164) continue;
      await db.guest.create({
        data: {
          firstName: "Kuyruk",
          lastName: `Testi${stamp}${i}`,
          ownerId: agent.id,
          phones: { create: { e164Enc: encrypt(n.e164), phoneHash: blindIndex(n.e164), masked: n.masked!, country: n.country, lineType: n.lineType, isPrimary: true } },
          consents: { create: { channel: "CALL", status: "GRANTED", source: "E2E", sourceSystem: "E2E", grantedAt: new Date() } },
          tasks: { create: { assigneeId: agent.id, reason: "E2E kuyruk görevi", priority: 1 } },
        },
      });
    }
    }
    // Personel testi: her çalıştırmada taze ekip (çizelge/puantaj dönemi ekip kapsamlıdır); önceki personel kayıtları
    // silinmez (düzeltme kayıtları değiştirilemez), yalnız CRM kullanıcısından ayrılır.
    const hrUsers = await db.user.findMany({ where: { email: { in: ["e2e-lider-p@crmplus.local", "e2e-temsilci-p@crmplus.local", "e2e-saha@crmplus.local", "e2e-ik1@crmplus.local", "e2e-ik2@crmplus.local"] } } });
    await db.employee.updateMany({ where: { userId: { in: hrUsers.map((u) => u.id) } }, data: { userId: null, status: "EXITED", exitDate: new Date() } });
    // Mesai durumu her çalıştırmada “mesai dışı” başlar
    await db.agentStatusLog.deleteMany({ where: { userId: { in: hrUsers.map((u) => u.id) }, at: { gte: new Date(Date.now() - 86_400_000) } } });
    const lead = hrUsers.find((u) => u.email.startsWith("e2e-lider-p"))!;
    await db.team.updateMany({ where: { leaderId: lead.id }, data: { leaderId: null } });
    const teamP = await db.team.create({ data: { name: `E2E Ekip P ${stamp}`, leaderId: lead.id } });
    await db.user.updateMany({ where: { id: { in: hrUsers.filter((u) => !u.email.startsWith("e2e-ik")).map((u) => u.id) } }, data: { teamId: teamP.id } });
  } finally {
    await db.$disconnect();
  }
}

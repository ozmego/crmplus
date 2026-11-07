import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/server/auth/password";
import { blindIndex, encrypt } from "../../src/server/crypto/field-encryption";
import { normalizePhone } from "../../src/lib/phone";

export const E2E_USERS = ["temsilci1@crmplus.local", "temsilci2@crmplus.local", "veri@crmplus.local", "operasyon@crmplus.local", "e2e-admin@crmplus.local", "e2e-temsilci@crmplus.local"];

/** Testte kullanılan demo hesapları ilk giriş durumuna döndürür (şifre değişimi + MFA kurulumu gerekecek). */
export default async function globalSetup() {
  process.loadEnvFile?.(".env");
  const db = new PrismaClient();
  try {
    const passwordHash = await hashPassword(process.env.SEED_ADMIN_PASSWORD!);
    // Test yöneticisi: geliştiricinin kendi yönetici hesabına dokunulmaz
    const sysAdmin = await db.role.findUniqueOrThrow({ where: { key: "sys_admin" } });
    await db.user.upsert({
      where: { email: "e2e-admin@crmplus.local" },
      update: {},
      create: { email: "e2e-admin@crmplus.local", name: "E2E Yönetici", passwordHash, roles: { create: { roleId: sysAdmin.id, assignedBy: "e2e" } } },
    });
    const agentRole = await db.role.findUniqueOrThrow({ where: { key: "agent" } });
    await db.user.upsert({
      where: { email: "e2e-temsilci@crmplus.local" },
      update: {},
      create: { email: "e2e-temsilci@crmplus.local", name: "E2E Temsilci", passwordHash, roles: { create: { roleId: agentRole.id, assignedBy: "e2e" } } },
    });
    // Önceki çalıştırmalardan kalan test kullanıcıları
    await db.user.updateMany({ where: { email: { startsWith: "e2e-yeni-" } }, data: { status: "DISABLED" } });
    for (const email of E2E_USERS) {
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await db.call.updateMany({ where: { agentId: user.id, closedAt: null }, data: { closedAt: new Date(), autoClosed: true } });
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: true, mfaSecretEnc: null, mfaEnabledAt: null, failedLogins: 0, lockedUntil: null, status: "ACTIVE" },
      });
    }

    // Kuyruk testi için her çalıştırmada taze, izinli görevler (demo verisi tükenmesin)
    const agent = await db.user.findUniqueOrThrow({ where: { email: "temsilci1@crmplus.local" } });
    const stamp = Date.now() % 1_000_000;
    for (let i = 0; i < 3; i++) {
      const n = normalizePhone(`0533${String(stamp * 3 + i).padStart(7, "0").slice(-7)}`, "TR");
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
  } finally {
    await db.$disconnect();
  }
}

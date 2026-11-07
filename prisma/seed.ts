/**
 * Seed: roller ve izinler (docs/01), sonuç kodları (docs/03), ilk yönetici.
 * SEED_DEMO=1 ise geliştirme için kurgusal örnek veri de eklenir (gerçek kişi verisi değildir).
 */
import { PrismaClient, type ConsentStatus } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { DEFAULT_ROLES, type Permission, type Scope } from "../src/server/auth/permissions";
import { blindIndex, encrypt } from "../src/server/crypto/field-encryption";
import { normalizePhone } from "../src/lib/phone";

const db = new PrismaClient();

const DISPOSITIONS = [
  { code: "REACHED", labelTr: "Ulaşıldı", labelEn: "Reached", category: "REACHED", countsAsReached: true, noteRequired: true },
  { code: "NO_ANSWER", labelTr: "Cevap yok", labelEn: "No answer", category: "UNREACHED", countsAsReached: false, noteRequired: false },
  { code: "BUSY", labelTr: "Meşgul", labelEn: "Busy", category: "UNREACHED", countsAsReached: false, noteRequired: false },
  { code: "INVALID_NUMBER", labelTr: "Numara hatalı / ulaşılamıyor", labelEn: "Invalid / unreachable number", category: "UNREACHED", countsAsReached: false, noteRequired: false },
  { code: "CALLBACK_REQUESTED", labelTr: "Geri arama istedi", labelEn: "Callback requested", category: "REACHED", countsAsReached: true, noteRequired: false },
  { code: "WRONG_PERSON", labelTr: "Yanlış kişi", labelEn: "Wrong person", category: "REACHED", countsAsReached: false, noteRequired: true },
  { code: "DO_NOT_CONTACT", labelTr: "İletişim istemiyor", labelEn: "Do not contact", category: "REACHED", countsAsReached: true, noteRequired: false },
  { code: "LANGUAGE_SUPPORT", labelTr: "Dil desteği gerekli", labelEn: "Language support needed", category: "REACHED", countsAsReached: true, noteRequired: false },
  { code: "ESCALATE", labelTr: "Yönetici incelemesi gerekli", labelEn: "Needs manager review", category: "REACHED", countsAsReached: true, noteRequired: true },
];

async function seedRoles() {
  for (const def of DEFAULT_ROLES) {
    const role = await db.role.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, system: true },
      create: { key: def.key, name: def.name, description: def.description, system: true },
    });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: def.grants.map((g) => {
        const [permission, scope] = Array.isArray(g) ? g : [g as Permission, def.defaultScope as Scope];
        return { roleId: role.id, permission, scope };
      }),
    });
  }
}

async function upsertUser(email: string, name: string, roleKeys: string[], password: string, teamId?: string) {
  const passwordHash = await hashPassword(password);
  const user = await db.user.upsert({
    where: { email },
    update: { name, teamId },
    create: { email, name, passwordHash, teamId, mustChangePassword: true },
  });
  for (const key of roleKeys) {
    const role = await db.role.findUniqueOrThrow({ where: { key } });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id, assignedBy: "seed" },
    });
  }
  return user;
}

async function seedDemo(password: string) {
  const team = await db.team.upsert({ where: { name: "Ekip 1" }, update: {}, create: { name: "Ekip 1" } });
  const lead = await upsertUser("lider@crmplus.local", "Demo Takım Lideri", ["team_lead"], password, team.id);
  await db.team.update({ where: { id: team.id }, data: { leaderId: lead.id } });
  const agentA = await upsertUser("temsilci1@crmplus.local", "Demo Temsilci 1", ["agent"], password, team.id);
  const agentB = await upsertUser("temsilci2@crmplus.local", "Demo Temsilci 2", ["agent"], password, team.id);
  await upsertUser("operasyon@crmplus.local", "Demo Operasyon Yöneticisi", ["ops_manager"], password);
  await upsertUser("veri@crmplus.local", "Demo Veri Yükleyici", ["data_loader"], password);
  await upsertUser("finans@crmplus.local", "Demo Finans", ["finance"], password);
  await upsertUser("denetci@crmplus.local", "Demo Denetçi", ["auditor"], password);

  if ((await db.guest.count()) > 0) return;

  // Kurgusal örnek misafirler. Numaralar geçerli biçimde rastgele üretilir.
  const first = ["Ahmet", "Mehmet", "Ayşe", "Elif", "Can", "Deniz", "Zeynep", "Burak", "Selin", "Emre", "Elena", "Sara", "Omar", "Lena", "Ivan"];
  const last = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Arslan", "Koç", "Aydın", "Öztürk", "Kurt", "Petrova", "Miller", "Haddad", "Weber", "Sokolov"];
  const langs = ["tr", "tr", "tr", "tr", "tr", "tr", "tr", "tr", "tr", "tr", "ru", "en", "ar", "de", "ru"];
  const tzs: Record<string, string> = { tr: "Europe/Istanbul", ru: "Europe/Moscow", en: "Europe/London", ar: "Asia/Dubai", de: "Europe/Berlin" };
  const consentCycle: ConsentStatus[] = ["GRANTED", "GRANTED", "GRANTED", "UNKNOWN", "DENIED"];

  for (let i = 0; i < 40; i++) {
    const fi = i % first.length;
    const lang = langs[fi];
    const mobile = `+90 5${30 + (i % 20)} ${String(100 + i).padStart(3, "0")} ${String(10 + (i * 7) % 90).padStart(2, "0")} ${String(10 + (i * 13) % 90).padStart(2, "0")}`;
    const n = normalizePhone(mobile, "TR");
    if (!n.ok || !n.e164) continue;
    const owner = i % 2 === 0 ? agentA : agentB;
    const consent = consentCycle[i % consentCycle.length];
    const guest = await db.guest.create({
      data: {
        firstName: first[fi],
        lastName: last[(i * 3) % last.length],
        language: lang,
        timezone: tzs[lang],
        country: lang === "tr" ? "TR" : undefined,
        vipLevel: ["STANDARD", "SILVER", "GOLD"][i % 3],
        ownerId: owner.id,
        phones: {
          create: {
            e164Enc: encrypt(n.e164),
            phoneHash: blindIndex(n.e164),
            masked: n.masked!,
            country: n.country,
            lineType: n.lineType,
            isPrimary: true,
          },
        },
        consents: {
          create: {
            channel: "CALL",
            status: consent,
            source: consent === "UNKNOWN" ? null : "Demo veri",
            sourceSystem: "SEED",
            grantedAt: consent === "GRANTED" ? new Date("2026-06-01") : null,
            deniedAt: consent === "DENIED" ? new Date("2026-06-01") : null,
          },
        },
      },
    });
    await db.task.create({
      data: { guestId: guest.id, assigneeId: owner.id, reason: i % 3 === 0 ? "Kampanya: Kış daveti" : "Takip araması", priority: (i % 3) + 1 },
    });
  }
}

async function main() {
  await seedRoles();
  for (const [i, d] of DISPOSITIONS.entries()) {
    await db.disposition.upsert({ where: { code: d.code }, update: { ...d, sortOrder: i + 1 }, create: { ...d, sortOrder: i + 1 } });
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@crmplus.local";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error("SEED_ADMIN_PASSWORD en az 12 karakter olmalı (.env)");
  await upsertUser(email, "Sistem Yöneticisi", ["sys_admin"], password);

  if (process.env.SEED_DEMO === "1") await seedDemo(password);
  console.log("Seed tamamlandı.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

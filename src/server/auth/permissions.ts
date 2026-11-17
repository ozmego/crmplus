/**
 * İzin anahtarları ve varsayılan roller — tek kaynak: docs/01-rol-izin-matrisi.md (plan v4).
 * Kodda rol adına göre karar verilmez; yalnız bu anahtarlar kontrol edilir.
 */

export const PERMISSIONS = {
  // Misafir
  "guest.view": "Misafir listesi ve kartı",
  "guest.create": "Misafir oluşturma",
  "guest.edit": "Misafir düzenleme",
  "guest.delete": "Misafir silme/anonimleştirme talebi",
  "guest.assign": "Misafiri temsilciye/ekibe atama",
  // Alan grupları
  "field.contact.full": "Maskesiz iletişim bilgisi (gerekçeli)",
  "field.notes": "Notları görme ve yazma",
  "field.identity": "Kimlik alanları",
  "field.financial": "Finansal alanlar",
  // İzin ve engelleme
  "consent.view": "İzin kayıtlarını görme",
  "consent.edit": "İzin kaydı düzenleme",
  "consent.exception.request": "İzin istisnası talep etme",
  "consent.exception.approve": "İzin istisnası onaylama",
  "block.create": "İletişim durdurma kaydı açma",
  "block.remove": "İletişim durdurma kaydını kaldırma",
  // Import / karşılaştırma / inceleme
  "import.create": "Dosya yükleme ve sihirbaz",
  "import.apply": "İçe aktarmayı uygulama",
  "import.rollback": "İçe aktarmayı geri alma",
  "import.view": "İçe aktarma geçmişi",
  "compare.run": "Karşılaştırma çalıştırma",
  "review.view": "İnceleme kuyruğunu görme",
  "review.resolve": "İnceleme kararı verme",
  "mapping.template.manage": "Eşleme şablonları",
  // Çağrı merkezi
  "queue.view": "Arama kuyruğu",
  "call.make": "Arama yapma ve sonuç girme",
  "call.view": "Çağrı geçmişi",
  "callback.manage": "Geri arama yönetimi",
  "task.view": "Görevleri görme",
  "task.create": "Görev oluşturma",
  "task.assign": "Görev atama",
  "campaign.view": "Kampanyaları görme",
  "campaign.manage": "Kampanya yönetimi",
  "segment.manage": "Segment yönetimi",
  // Ses
  "recording.listen": "Kayıt dinleme (gerekçeli, süreli)",
  "recording.download": "Kayıt indirme",
  "transcript.view": "Transkript görme",
  "transcript.edit": "Transkript düzeltme",
  "analysis.review": "Analiz önerisi inceleme/onay",
  "qa.review": "Kalite örneklemesi",
  "qa.respond": "Kendi kalite incelemesine açıklama/itiraz",
  "vocabulary.manage": "Türkçe kurum sözlüğü",
  // Mesajlaşma
  "message.send.single": "Tekil şablon mesaj",
  "message.campaign.prepare": "Mesaj kampanyası hazırlama",
  "message.campaign.approve": "Mesaj kampanyası onaylama",
  "message.template.manage": "Mesaj şablonları",
  "inbox.view": "WhatsApp gelen kutusu",
  "phone.check": "Telefon hat durumu sorgusu (dış servis)",
  "message.reply": "WhatsApp 24 saat penceresinde serbest yanıt",
  // Rapor ve dışa aktarma
  "report.view": "Raporlar",
  "report.product": "Ürün ve veri kalitesi metrikleri",
  "export.basic": "Kapsam içi sınırlı dışa aktarma",
  "export.bulk": "Toplu dışa aktarma",
  // Yönetim
  "user.view": "Kullanıcıları görme",
  "user.manage": "Kullanıcı yönetimi",
  "role.manage": "Rol tanımlama",
  "role.assign": "Rol verme",
  "team.manage": "Ekip yönetimi",
  "settings.manage": "Sistem ayarları",
  "integration.manage": "Entegrasyon anahtarları",
  "audit.view": "Denetim ve erişim kayıtları",
  "alert.view": "Erişim uyarıları",
  "alert.resolve": "Erişim uyarısı kapatma",
  "emergency.access": "Acil erişim",
  "retention.execute": "Saklama/silme işlemleri",
  // Finans
  "finance.view": "Finans modülü",
  "finance.contract.manage": "Sözleşme ve kural",
  "finance.result.edit": "Oyun sonucu girişi",
  "finance.calc.prepare": "Hesaplama hazırlama",
  "finance.calc.approve": "Hesaplama onayı",
  "finance.period.lock": "Dönem kapatma",
  "finance.adjust": "Düzeltme/iptal",
  "finance.export": "Finans dışa aktarımı",
  // Personel ve puantaj (Aşama 1B, docs/11)
  "hr.employee.view": "Personel kayıtlarını görme",
  "hr.employee.edit": "Personel kaydı düzenleme",
  "roster.view": "Vardiya çizelgesi görme",
  "roster.manage": "Vardiya çizelgesi düzenleme",
  "roster.publish": "Vardiya çizelgesi yayınlama",
  "route.manage": "Saha rotası planlama",
  "route.checkin": "Kendi rotasında vardım/ayrıldım",
  "attendance.view": "Puantaj görme",
  "attendance.adjust": "Puantaj düzeltme (gerekçeli)",
  "leave.request": "İzin talebi",
  "leave.preapprove": "İzin ön onayı",
  "leave.approve": "İzin son onayı",
  "timesheet.prepare": "Puantaj dönemini hazırlama",
  "timesheet.approve": "Puantaj dönemini onaylama",
  "timesheet.lock": "Puantaj dönemini kilitleme",
  "timesheet.export": "Puantaj Excel dışa aktarımı",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export type Scope = "own" | "team" | "all";

export const SCOPE_RANK: Record<Scope, number> = { own: 1, team: 2, all: 3 };

type Grant = Permission | [Permission, Scope];

export interface RoleDef {
  key: string;
  name: string;
  description: string;
  /** İzin verilen anahtarlar; kapsam belirtilmezse rolün varsayılan kapsamı kullanılır. */
  grants: Grant[];
  defaultScope: Scope;
}

export const DEFAULT_ROLES: RoleDef[] = [
  {
    key: "sys_admin",
    name: "Sistem yöneticisi",
    description: "Kullanıcı, rol, sistem ve entegrasyon yapılandırması; finans ayrıntısı kapalı.",
    defaultScope: "all",
    grants: [
      "user.view", "user.manage", "role.manage", "role.assign", "team.manage",
      "settings.manage", "integration.manage", "audit.view", "alert.view", "alert.resolve",
      "emergency.access", "block.create", "vocabulary.manage", ["roster.view", "own"], ["attendance.view", "own"], ["leave.request", "own"],
    ],
  },
  {
    key: "ops_manager",
    name: "Operasyon yöneticisi",
    description: "Ekip, liste, görev, kampanya ve toplulaştırılmış operasyon raporları.",
    defaultScope: "all",
    grants: [
      "guest.view", "guest.create", "guest.edit", "guest.assign", "field.contact.full", "field.notes", "field.identity",
      "consent.view", "consent.edit", "consent.exception.request", "block.create", "block.remove",
      "import.create", "import.apply", "import.rollback", "import.view", "compare.run", "review.view", "review.resolve",
      "mapping.template.manage", "call.view", "callback.manage", "task.view", "task.create", "task.assign",
      "campaign.view", "campaign.manage", "segment.manage", "transcript.view", "analysis.review",
      "message.campaign.prepare", "message.campaign.approve", "message.template.manage",
      "report.view", "report.product", "export.basic", "export.bulk", "team.manage", "alert.view", "user.view",
      "hr.employee.view", "roster.view", "roster.manage", "roster.publish", "route.manage", "attendance.view", ["leave.request", "own"],
      "vocabulary.manage", "inbox.view", "phone.check",
    ],
  },
  {
    key: "team_lead",
    name: "Takım lideri",
    description: "Kendi ekibinin çağrı kuyruğu, kalite örneklemesi ve performans raporu.",
    defaultScope: "team",
    grants: [
      "guest.view", "guest.edit", "guest.assign", "field.contact.full", "field.notes", "consent.view", "consent.edit",
      "consent.exception.request", "block.create", "queue.view", "call.make", "call.view", "callback.manage",
      "task.view", "task.create", "task.assign", "campaign.view", "recording.listen", "transcript.view",
      "transcript.edit", "analysis.review", "qa.review", "message.send.single", "report.view", "export.basic",
      "hr.employee.view", "roster.view", "roster.manage", "roster.publish", "route.manage", "attendance.view", "attendance.adjust",
      "leave.preapprove", "timesheet.prepare", ["leave.request", "own"], "inbox.view", "message.reply", "phone.check",
    ],
  },
  {
    key: "agent",
    name: "Çağrı merkezi personeli",
    description: "Kendisine atanmış kayıt, iletişim tercihi, çağrı geçmişi ve görev; finans yok.",
    defaultScope: "own",
    grants: [
      "guest.view", "guest.edit", "field.notes", "consent.view", "block.create", "queue.view", "call.make",
      "call.view", "callback.manage", "task.view", "transcript.view", "transcript.edit", "analysis.review",
      "message.send.single", "report.view", ["roster.view", "own"], ["attendance.view", "own"], ["leave.request", "own"],
      "qa.respond", "inbox.view", "message.reply",
    ],
  },
  {
    key: "data_loader",
    name: "Veri yükleyici",
    description: "Dosya, eşleme, hata raporu ve çakışma kuyruğu; çağrı notları/finans yok.",
    defaultScope: "all",
    grants: [
      "guest.view", "consent.view", "consent.edit", "block.create", "import.create", "import.apply", "import.rollback", "import.view",
      "compare.run", "review.view", "review.resolve", "mapping.template.manage", "export.basic",
      "phone.check", ["report.view", "own"], ["roster.view", "own"], ["attendance.view", "own"], ["leave.request", "own"],
    ],
  },
  {
    key: "finance",
    name: "Finans",
    description: "Sözleşme, oran, komisyon hesaplaması ve mutabakat; ses kayıtları yok.",
    defaultScope: "all",
    grants: [
      "field.financial", "finance.view", "finance.contract.manage", "finance.result.edit", "finance.calc.prepare",
      "finance.calc.approve", "finance.period.lock", "finance.adjust", "finance.export", "block.create", ["roster.view", "own"], ["attendance.view", "own"], ["leave.request", "own"],
    ],
  },
  {
    key: "auditor",
    name: "Denetçi",
    description: "Salt okunur işlem ve erişim geçmişi; değişiklik ve dışa aktarma yok.",
    defaultScope: "all",
    grants: ["audit.view", "alert.view", "user.view", ["roster.view", "own"], ["attendance.view", "own"], ["leave.request", "own"]],
  },
  {
    key: "hr",
    name: "İK",
    description: "Personel kayıtları, izin son onayı, puantaj onayı/kilidi/dışa aktarımı; misafir ve finans verisi yok.",
    defaultScope: "all",
    grants: [
      "hr.employee.view", "hr.employee.edit", "roster.view", "attendance.view", "attendance.adjust", "leave.approve",
      "timesheet.prepare", "timesheet.approve", "timesheet.lock", "timesheet.export", ["leave.request", "own"],
    ],
  },
  {
    key: "field_staff",
    name: "Saha personeli",
    description: "Kendi rotası ve check-in, kendi çizelgesi ve puantajı; rotadaki misafirin yalnız adı.",
    defaultScope: "own",
    grants: ["route.checkin", "roster.view", "attendance.view", "leave.request"],
  },
];

/** Gerekçe zorunlu işlemler (docs/01 §6). */
export const REASON_REQUIRED: ReadonlySet<string> = new Set([
  "role.assign", "field.contact.full", "export.basic", "export.bulk", "emergency.access",
  "block.remove", "recording.listen", "recording.download", "finance.adjust", "finance.export",
  "attendance.adjust", "timesheet.export",
]);

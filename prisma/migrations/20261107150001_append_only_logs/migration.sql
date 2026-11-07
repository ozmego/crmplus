-- Denetim ve erişim kayıtları değiştirilemez (docs/01 §8, docs/08).
-- Saklama süresi dolan kayıtların silinmesi yalnız `crmplus.retention` oturum ayarıyla yapılabilir.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.forbid_log_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('crmplus.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% tablosu değiştirilemez (append-only)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "public"."AuditLog"
  FOR EACH ROW EXECUTE FUNCTION public.forbid_log_mutation();

CREATE TRIGGER access_log_append_only
  BEFORE UPDATE OR DELETE ON "public"."AccessLog"
  FOR EACH ROW EXECUTE FUNCTION public.forbid_log_mutation();

-- İsim benzerliği (eşleştirme) için trigram indeksi
CREATE INDEX IF NOT EXISTS guest_name_trgm
  ON "public"."Guest" USING gin ((lower("firstName" || ' ' || "lastName")) gin_trgm_ops);

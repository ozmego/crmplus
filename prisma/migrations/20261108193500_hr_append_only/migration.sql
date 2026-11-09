-- Puantaj düzeltmeleri değiştirilemez (docs/11 §7).
CREATE TRIGGER attendance_adjustment_append_only
  BEFORE UPDATE OR DELETE ON "hr"."AttendanceAdjustment"
  FOR EACH ROW EXECUTE FUNCTION public.forbid_log_mutation();

import "server-only";

/**
 * Santral soyutlaması (plan v4 §Çağrı merkezi). Aşama 1 hedefi bulut santral (3CX/SIP);
 * santral yapılandırılmamışsa veya kesintideyse "manual" sağlayıcı yedek olarak kullanılır.
 */
export interface DialResult {
  provider: string;
  externalId?: string;
  /** Manuel modda temsilcinin softphone'unu açan bağlantı. Santral modunda yok. */
  dialUri?: string;
}

export interface TelephonyProvider {
  readonly name: string;
  /** Santral çağrıyı kendisi başlatır; numara tarayıcıya hiç gönderilmez. */
  dial(args: { e164: string; agentExtension?: string | null; callId: string }): Promise<DialResult>;
}

export const manualProvider: TelephonyProvider = {
  name: "manual",
  async dial({ e164 }) {
    return { provider: "manual", dialUri: `tel:${e164}` };
  },
};

export function getTelephonyProvider(): TelephonyProvider {
  // 3CX / SIP adaptörü yapılandırıldığında burada seçilecek (Setting "telephony.provider").
  return manualProvider;
}

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Yerelde üretim derlemesi geliştirme sunucusundan ayrı klasöre alınabilir (NEXT_DIST_DIR=.next-prod)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Docker imajı için yalnız gerekli dosyaları içeren bağımsız çıktı (.next/standalone).
  // Windows'ta bu kopyalama sembolik bağlantı izni yüzünden durur; yerel üretim modu (`next start`) buna ihtiyaç duymaz.
  output: process.platform === "win32" ? undefined : "standalone",
  serverExternalPackages: ["@node-rs/argon2", "exceljs", "bullmq", "ioredis"],
  // docs/02 §1: içe aktarma dosyaları en fazla 50 MB
  experimental: { serverActions: { bodySizeLimit: "52mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);

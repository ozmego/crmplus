import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
      <p className="eyebrow">ERİŞİM</p>
      <h1 className="page-title">Bu sayfa için yetkiniz yok</h1>
      <p className="callout-info">
        Rolünüz bu ekranı kapsamıyor. Deneme erişim kayıtlarına yazıldı. Bu ekrana ihtiyacınız varsa yöneticinizden rol talep edin.
      </p>
      <Link href="/" className="btn-primary self-start">Ana sayfaya dön</Link>
    </div>
  );
}

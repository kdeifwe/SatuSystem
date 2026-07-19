import Link from 'next/link';
import DotMapGraphic from '../components/dot-map-graphic';
import SiteNav from '../components/site-nav';

export default function HomePage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="container py-16 md:py-24">
        <section className="flex flex-col gap-8 py-10 md:py-16">
          <div className="inline-flex w-fit items-center rounded-full border border-[color:var(--color-graphite)] px-3 py-2 text-[13px] uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">
            AI agents for modern teams
          </div>
          <div className="space-y-6">
            <h1 className="max-w-4xl text-[clamp(2.8rem,6vw,4.2rem)] font-normal leading-[0.95] tracking-[-0.03em] text-[color:var(--color-chalk)]">
              Система для роста продаж, поддержки и доверия.
            </h1>
            <p className="max-w-2xl text-[18px] leading-[1.5] text-[color:var(--color-smoke)]">
              Платформа AI-агентов для WhatsApp и Telegram, где диалоги, сценарии и аналитика собраны в одном рабочем пространстве.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/login" className="hyper-primary-btn">
              Войти
            </Link>
            <Link href="/register" className="hyper-secondary-btn">
              Регистрация
            </Link>
            <Link href="/org/create" className="hyper-secondary-btn">
              Создать организацию
            </Link>
            <Link href="/dashboard" className="hyper-primary-btn">
              Дашборд
            </Link>
          </div>
        </section>

        <div className="relative left-1/2 mt-8 w-screen -translate-x-1/2 border-y border-[color:var(--color-graphite)] bg-[color:var(--color-obsidian)] py-4 md:py-6">
          <DotMapGraphic />
        </div>

        <hr className="section-divider" />

        <section className="grid gap-8 py-16 md:grid-cols-[1.15fr_0.85fr]">
          <div className="hyper-card flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--color-compass-gold)]" />
              <p className="text-[13px] uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">
                Подключение
              </p>
            </div>
            <h2 className="max-w-2xl text-[clamp(1.5rem,3vw,2rem)] leading-[1.1] tracking-[-0.02em] text-[color:var(--color-chalk)]">
              Собирайте контекст и запускайте сценарии в одном окне.
            </h2>
            <p className="max-w-2xl text-[16px] leading-[1.5] text-[color:var(--color-smoke)]">
              От входящих сообщений до аналитики маршрутизации — все действия на одной платформе, без хаоса и лишних переходов.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/dashboard" className="hyper-secondary-btn">
                Открыть дашборд
              </Link>
            </div>
          </div>

          <div className="hyper-card flex flex-col gap-4">
            <p className="text-[13px] uppercase tracking-[0.2em] text-[color:var(--color-smoke)]">
              Быстрый старт
            </p>
            <div className="space-y-3">
              <div className="rounded-[var(--radius-tags)] border border-[color:var(--color-graphite)] p-4">
                <p className="text-[14px] uppercase tracking-[0.12em] text-[color:var(--color-chalk)]">
                  Сценарии
                </p>
                <p className="mt-2 text-[16px] leading-[1.5] text-[color:var(--color-smoke)]">
                  Настройте правила обработки и переходов по воронке.
                </p>
              </div>
              <div className="rounded-[var(--radius-tags)] border border-[color:var(--color-graphite)] p-4">
                <p className="text-[14px] uppercase tracking-[0.12em] text-[color:var(--color-chalk)]">
                  Поддержка
                </p>
                <p className="mt-2 text-[16px] leading-[1.5] text-[color:var(--color-smoke)]">
                  Подключите агентов к WhatsApp и Telegram для ответов в реальном времени.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

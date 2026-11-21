import { motion } from "framer-motion";
import { Download, ListVideo, MonitorPlay, ShieldCheck } from "lucide-react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MessageKey } from "@/lib/i18n";
import { useLanguage } from "@/lib/language";

/**
 * Where the "Download" button sends people. Kept in an environment variable so a
 * mirror or a direct-installer link can be swapped in without touching the copy.
 */
const DOWNLOAD_URL = import.meta.env.VITE_DOWNLOAD_URL ?? "https://github.com/RybsonBybson/novatube/releases/latest";

const FEATURES: { icon: typeof MonitorPlay; title: MessageKey; description: MessageKey }[] = [
  { icon: MonitorPlay, title: "features.video.title", description: "features.video.desc" },
  { icon: ListVideo, title: "features.playlist.title", description: "features.playlist.desc" },
  { icon: ShieldCheck, title: "features.private.title", description: "features.private.desc" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export default function App() {
  const { t } = useLanguage();

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="aurora-blob one -left-40 -top-56 size-[620px]" />
        <span className="aurora-blob two -right-32 -top-40 size-[540px]" />
        <span className="aurora-blob three -left-24 bottom-[-18rem] size-[520px]" />
        <span className="aurora-blob four right-[-8rem] bottom-[-14rem] size-[460px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative grid size-9 place-items-center overflow-hidden rounded-xl ring-1 ring-white/15 shadow-[0_0_24px_-4px_rgba(66,133,244,0.9)]">
              <img src="/icon.png" alt="NovaTube" className="size-full object-cover" width={36} height={36} />
            </span>
            <span className="font-display text-base font-bold tracking-[-0.02em] text-foreground">NovaTube</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden sm:inline-flex">
              {t("meta.windows")}
            </Badge>
            <LanguageSwitch />
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center py-14 sm:py-20">
          <motion.div initial="hidden" animate="show" transition={{ staggerChildren: 0.08 }}>
            <motion.div variants={fadeUp} transition={{ duration: 0.5, ease: "easeOut" }}>
              <Badge variant="gradient" className="mb-6">
                {t("hero.badge")}
              </Badge>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="font-display text-5xl font-bold leading-[1.02] tracking-[-0.045em] text-foreground sm:text-6xl lg:text-7xl"
            >
              {t("hero.titleA")}
              <br />
              <span className="gemini-text">{t("hero.titleB")}</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
            >
              {t("hero.subtitle")}
            </motion.p>

            <motion.div
              variants={fadeUp}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <Button asChild size="lg" variant="gradient" className="tactile">
                <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">
                  <Download className="size-5" />
                  {t("cta.download")}
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#funkcje">{t("cta.features")}</a>
              </Button>
            </motion.div>

            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="mt-4 text-xs text-muted-foreground"
            >
              {t("cta.note")}
            </motion.p>
          </motion.div>

          <motion.section
            id="funkcje"
            initial="hidden"
            animate="show"
            transition={{ staggerChildren: 0.09, delayChildren: 0.25 }}
            className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {FEATURES.map((feature) => (
              <motion.div
                key={feature.title}
                variants={fadeUp}
                transition={{ duration: 0.5, ease: "easeOut" }}
                whileHover={{ y: -4 }}
              >
                <Card className="h-full transition-colors hover:bg-white/[0.04]">
                  <CardHeader>
                    <span className="grid size-10 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(66,133,244,0.22),rgba(155,114,203,0.22))] ring-1 ring-inset ring-white/10">
                      <feature.icon className="size-5 text-foreground/80" />
                    </span>
                    <CardTitle className="mt-3">{t(feature.title)}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <CardDescription>{t(feature.description)}</CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.section>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground">
          <span>NovaTube · {new Date().getFullYear()}</span>
          <span>{t("footer.note")}</span>
        </footer>
      </div>
    </div>
  );
}

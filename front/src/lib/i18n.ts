/**
 * Landing-page copy in every language NovaTube ships with.
 *
 * English is the source of truth: every other table is typed as
 * `Record<MessageKey, string>`, so a missing translation is a type error.
 * The order and flags mirror the desktop app's language switcher.
 */

export type LanguageCode =
  | "en"
  | "es"
  | "pt"
  | "ru"
  | "zh"
  | "ja"
  | "pl"
  | "de"
  | "fr"
  | "ar"
  | "hi"
  | "ko"
  | "it"
  | "tr";

export const en = {
  "meta.windows": "For Windows 10 & 11",
  "hero.badge": "Free · ad-free",
  "hero.titleA": "Paste the link.",
  "hero.titleB": "Keep the file.",
  "hero.subtitle":
    "NovaTube saves videos and music straight to your chosen folder. Fast, quiet and no questions asked — even when a whole playlist is waiting in the queue.",
  "cta.download": "Download",
  "cta.features": "What it does",
  "cta.note": "Windows installer · works offline · no account",
  "features.video.title": "Video & audio",
  "features.video.desc": "Pick the quality, format and audio track — or leave it to one click.",
  "features.playlist.title": "Whole playlists",
  "features.playlist.desc": "Paste a playlist link and grab everything at once, even thousands of items.",
  "features.private.title": "Stays with you",
  "features.private.desc": "Everything happens on your computer. No accounts, no uploads.",
  "footer.note": "Your files stay on your drive.",
  "lang.label": "Language",
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "meta.windows": "Para Windows 10 y 11",
  "hero.badge": "Gratis · sin anuncios",
  "hero.titleA": "Pega el enlace.",
  "hero.titleB": "Quédate el archivo.",
  "hero.subtitle":
    "NovaTube guarda vídeos y música directamente en tu carpeta. Rápido, discreto y sin preguntas, incluso con una lista de reproducción entera en cola.",
  "cta.download": "Descargar",
  "cta.features": "Qué hace",
  "cta.note": "Instalador para Windows · funciona sin conexión · sin cuenta",
  "features.video.title": "Vídeo y audio",
  "features.video.desc": "Elige la calidad, el formato y la pista de audio, o deja que un solo clic lo haga.",
  "features.playlist.title": "Listas completas",
  "features.playlist.desc":
    "Pega el enlace de una lista y descárgala entera de una vez, aunque tenga miles de elementos.",
  "features.private.title": "Se queda contigo",
  "features.private.desc": "Todo ocurre en tu ordenador. Sin cuentas ni subidas.",
  "footer.note": "Tus archivos se quedan en tu disco.",
  "lang.label": "Idioma",
};

const pt: Record<MessageKey, string> = {
  "meta.windows": "Para Windows 10 e 11",
  "hero.badge": "Grátis · sem anúncios",
  "hero.titleA": "Cole o link.",
  "hero.titleB": "Fique com o ficheiro.",
  "hero.subtitle":
    "O NovaTube guarda vídeos e música diretamente na pasta escolhida. Rápido, silencioso e sem perguntas — mesmo com uma playlist inteira na fila.",
  "cta.download": "Baixar",
  "cta.features": "O que faz",
  "cta.note": "Instalador para Windows · funciona offline · sem conta",
  "features.video.title": "Vídeo e áudio",
  "features.video.desc": "Escolha a qualidade, o formato e a faixa de áudio — ou deixe num clique.",
  "features.playlist.title": "Playlists inteiras",
  "features.playlist.desc": "Cole o link de uma playlist e baixe tudo de uma vez, mesmo milhares de itens.",
  "features.private.title": "Fica com você",
  "features.private.desc": "Tudo acontece no seu computador. Sem contas nem envios.",
  "footer.note": "Seus arquivos ficam no seu disco.",
  "lang.label": "Idioma",
};

const ru: Record<MessageKey, string> = {
  "meta.windows": "Для Windows 10 и 11",
  "hero.badge": "Бесплатно · без рекламы",
  "hero.titleA": "Вставьте ссылку.",
  "hero.titleB": "Сохраните файл.",
  "hero.subtitle":
    "NovaTube сохраняет видео и музыку прямо в выбранную папку. Быстро, тихо и без лишних вопросов — даже когда в очереди целый плейлист.",
  "cta.download": "Скачать",
  "cta.features": "Что умеет",
  "cta.note": "Установщик для Windows · работает офлайн · без аккаунта",
  "features.video.title": "Видео и аудио",
  "features.video.desc": "Выберите качество, формат и звуковую дорожку — или доверьтесь одному клику.",
  "features.playlist.title": "Целые плейлисты",
  "features.playlist.desc": "Вставьте ссылку на плейлист и скачайте всё сразу, даже тысячи элементов.",
  "features.private.title": "Остаётся у вас",
  "features.private.desc": "Всё происходит на вашем компьютере. Без аккаунтов и загрузок на сервер.",
  "footer.note": "Ваши файлы остаются на вашем диске.",
  "lang.label": "Язык",
};

const zh: Record<MessageKey, string> = {
  "meta.windows": "适用于 Windows 10 和 11",
  "hero.badge": "免费 · 无广告",
  "hero.titleA": "粘贴链接。",
  "hero.titleB": "保存文件。",
  "hero.subtitle":
    "NovaTube 将视频和音乐直接保存到你选择的文件夹。快速、安静、无需多问——即使队列里有整个播放列表。",
  "cta.download": "下载",
  "cta.features": "功能",
  "cta.note": "Windows 安装程序 · 离线可用 · 无需账号",
  "features.video.title": "视频和音频",
  "features.video.desc": "选择画质、格式和音轨——或一键搞定。",
  "features.playlist.title": "整个播放列表",
  "features.playlist.desc": "粘贴播放列表链接，一次性全部下载，即使有数千个条目。",
  "features.private.title": "留在你身边",
  "features.private.desc": "一切都在你的电脑上完成。无需账号，不上传。",
  "footer.note": "你的文件保留在你的磁盘上。",
  "lang.label": "语言",
};

const ja: Record<MessageKey, string> = {
  "meta.windows": "Windows 10 / 11 対応",
  "hero.badge": "無料 · 広告なし",
  "hero.titleA": "リンクを貼る。",
  "hero.titleB": "ファイルを残す。",
  "hero.subtitle":
    "NovaTube は動画と音楽を選んだフォルダに直接保存します。速く、静かに、余計な手間なし — プレイリスト全体が待っていても。",
  "cta.download": "ダウンロード",
  "cta.features": "できること",
  "cta.note": "Windows インストーラー · オフライン対応 · アカウント不要",
  "features.video.title": "動画と音声",
  "features.video.desc": "画質・形式・音声トラックを選ぶか、ワンクリックにお任せ。",
  "features.playlist.title": "プレイリスト丸ごと",
  "features.playlist.desc": "プレイリストのリンクを貼れば一度に全部、数千件でも。",
  "features.private.title": "手元に残る",
  "features.private.desc": "すべてあなたのパソコン上で完結。アカウントもアップロードも不要。",
  "footer.note": "ファイルはあなたのディスクに残ります。",
  "lang.label": "言語",
};

const pl: Record<MessageKey, string> = {
  "meta.windows": "Dla Windows 10 i 11",
  "hero.badge": "Darmowe · bez reklam",
  "hero.titleA": "Wklej link.",
  "hero.titleB": "Zachowaj plik.",
  "hero.subtitle":
    "NovaTube zapisuje filmy i muzykę prosto w wybranym folderze. Szybko, po cichu i bez zbędnych pytań — także wtedy, gdy w kolejce czeka cała playlista.",
  "cta.download": "Pobierz",
  "cta.features": "Co potrafi",
  "cta.note": "Instalator dla Windows · działa offline · bez konta",
  "features.video.title": "Wideo i audio",
  "features.video.desc": "Wybierz jakość, format i ścieżkę dźwiękową — albo zostaw jeden klik i gotowe.",
  "features.playlist.title": "Całe playlisty",
  "features.playlist.desc": "Wklej link do playlisty i pobierz wszystko naraz, nawet tysiące pozycji.",
  "features.private.title": "Zostaje u Ciebie",
  "features.private.desc": "Wszystko dzieje się na Twoim komputerze. Bez kont i wysyłania plików.",
  "footer.note": "Twoje pliki zostają na Twoim dysku.",
  "lang.label": "Język",
};

const de: Record<MessageKey, string> = {
  "meta.windows": "Für Windows 10 & 11",
  "hero.badge": "Kostenlos · werbefrei",
  "hero.titleA": "Link einfügen.",
  "hero.titleB": "Datei behalten.",
  "hero.subtitle":
    "NovaTube speichert Videos und Musik direkt in deinem gewählten Ordner. Schnell, leise und ohne Rückfragen — auch bei einer ganzen Playlist in der Warteschlange.",
  "cta.download": "Herunterladen",
  "cta.features": "Was es kann",
  "cta.note": "Windows-Installer · offline nutzbar · kein Konto",
  "features.video.title": "Video & Audio",
  "features.video.desc": "Qualität, Format und Tonspur wählen — oder alles per Klick.",
  "features.playlist.title": "Ganze Playlists",
  "features.playlist.desc": "Playlist-Link einfügen und alles auf einmal holen, selbst Tausende Einträge.",
  "features.private.title": "Bleibt bei dir",
  "features.private.desc": "Alles läuft auf deinem Computer. Keine Konten, keine Uploads.",
  "footer.note": "Deine Dateien bleiben auf deiner Festplatte.",
  "lang.label": "Sprache",
};

const fr: Record<MessageKey, string> = {
  "meta.windows": "Pour Windows 10 et 11",
  "hero.badge": "Gratuit · sans pub",
  "hero.titleA": "Collez le lien.",
  "hero.titleB": "Gardez le fichier.",
  "hero.subtitle":
    "NovaTube enregistre vidéos et musique directement dans votre dossier. Rapide, discret et sans questions — même avec une playlist entière en attente.",
  "cta.download": "Télécharger",
  "cta.features": "Ce qu'il fait",
  "cta.note": "Installateur Windows · fonctionne hors ligne · sans compte",
  "features.video.title": "Vidéo et audio",
  "features.video.desc": "Choisissez la qualité, le format et la piste audio — ou laissez un clic faire le reste.",
  "features.playlist.title": "Playlists entières",
  "features.playlist.desc": "Collez un lien de playlist et récupérez tout d'un coup, même des milliers d'éléments.",
  "features.private.title": "Reste chez vous",
  "features.private.desc": "Tout se passe sur votre ordinateur. Sans comptes ni envois.",
  "footer.note": "Vos fichiers restent sur votre disque.",
  "lang.label": "Langue",
};

const ar: Record<MessageKey, string> = {
  "meta.windows": "لنظامي Windows 10 و11",
  "hero.badge": "مجاني · بلا إعلانات",
  "hero.titleA": "الصق الرابط.",
  "hero.titleB": "احتفظ بالملف.",
  "hero.subtitle":
    "يحفظ NovaTube الفيديوهات والموسيقى مباشرة في المجلد الذي تختاره. سريع وهادئ وبلا أسئلة — حتى مع قائمة تشغيل كاملة في الانتظار.",
  "cta.download": "تنزيل",
  "cta.features": "ما الذي يفعله",
  "cta.note": "مثبّت لويندوز · يعمل دون اتصال · بلا حساب",
  "features.video.title": "فيديو وصوت",
  "features.video.desc": "اختر الجودة والصيغة والمسار الصوتي — أو اتركها بنقرة واحدة.",
  "features.playlist.title": "قوائم تشغيل كاملة",
  "features.playlist.desc": "الصق رابط قائمة التشغيل ونزّل كل شيء دفعة واحدة، حتى آلاف العناصر.",
  "features.private.title": "يبقى معك",
  "features.private.desc": "كل شيء يحدث على حاسوبك. بلا حسابات ولا رفع ملفات.",
  "footer.note": "تبقى ملفاتك على قرصك.",
  "lang.label": "اللغة",
};

const hi: Record<MessageKey, string> = {
  "meta.windows": "Windows 10 और 11 के लिए",
  "hero.badge": "मुफ़्त · विज्ञापन-मुक्त",
  "hero.titleA": "लिंक पेस्ट करें।",
  "hero.titleB": "फ़ाइल रख लें।",
  "hero.subtitle":
    "NovaTube वीडियो और संगीत सीधे आपके चुने हुए फ़ोल्डर में सहेजता है। तेज़, शांत और बिना सवाल — चाहे पूरी प्लेलिस्ट कतार में हो।",
  "cta.download": "डाउनलोड",
  "cta.features": "यह क्या करता है",
  "cta.note": "Windows इंस्टॉलर · ऑफ़लाइन चलता है · बिना खाता",
  "features.video.title": "वीडियो और ऑडियो",
  "features.video.desc": "क्वालिटी, फ़ॉर्मैट और ऑडियो ट्रैक चुनें — या एक क्लिक पर छोड़ दें।",
  "features.playlist.title": "पूरी प्लेलिस्ट",
  "features.playlist.desc": "प्लेलिस्ट का लिंक पेस्ट करें और सब कुछ एक साथ पाएँ, हज़ारों आइटम हों तो भी।",
  "features.private.title": "आपके पास ही रहता है",
  "features.private.desc": "सब कुछ आपके कंप्यूटर पर होता है। कोई खाता नहीं, कोई अपलोड नहीं।",
  "footer.note": "आपकी फ़ाइलें आपकी डिस्क पर रहती हैं।",
  "lang.label": "भाषा",
};

const ko: Record<MessageKey, string> = {
  "meta.windows": "Windows 10 및 11용",
  "hero.badge": "무료 · 광고 없음",
  "hero.titleA": "링크를 붙여넣으세요.",
  "hero.titleB": "파일은 그대로.",
  "hero.subtitle":
    "NovaTube는 동영상과 음악을 선택한 폴더에 바로 저장합니다. 빠르고 조용하며 묻지도 않습니다 — 재생목록 전체가 대기 중이어도.",
  "cta.download": "다운로드",
  "cta.features": "주요 기능",
  "cta.note": "Windows 설치 프로그램 · 오프라인 작동 · 계정 불필요",
  "features.video.title": "동영상과 오디오",
  "features.video.desc": "화질, 형식, 오디오 트랙을 고르거나 한 번의 클릭으로 맡기세요.",
  "features.playlist.title": "재생목록 전체",
  "features.playlist.desc": "재생목록 링크를 붙여넣으면 수천 개라도 한 번에 받습니다.",
  "features.private.title": "당신 곁에 남습니다",
  "features.private.desc": "모든 처리는 내 컴퓨터에서. 계정도 업로드도 없습니다.",
  "footer.note": "파일은 당신의 디스크에 남습니다.",
  "lang.label": "언어",
};

const it: Record<MessageKey, string> = {
  "meta.windows": "Per Windows 10 e 11",
  "hero.badge": "Gratis · senza pubblicità",
  "hero.titleA": "Incolla il link.",
  "hero.titleB": "Tieni il file.",
  "hero.subtitle":
    "NovaTube salva video e musica direttamente nella cartella scelta. Veloce, silenzioso e senza domande — anche con un'intera playlist in coda.",
  "cta.download": "Scarica",
  "cta.features": "Cosa fa",
  "cta.note": "Installer per Windows · funziona offline · senza account",
  "features.video.title": "Video e audio",
  "features.video.desc": "Scegli qualità, formato e traccia audio — o lascia fare a un clic.",
  "features.playlist.title": "Playlist intere",
  "features.playlist.desc": "Incolla il link di una playlist e scarica tutto insieme, anche migliaia di voci.",
  "features.private.title": "Resta con te",
  "features.private.desc": "Tutto avviene sul tuo computer. Niente account né caricamenti.",
  "footer.note": "I tuoi file restano sul tuo disco.",
  "lang.label": "Lingua",
};

const tr: Record<MessageKey, string> = {
  "meta.windows": "Windows 10 ve 11 için",
  "hero.badge": "Ücretsiz · reklamsız",
  "hero.titleA": "Bağlantıyı yapıştır.",
  "hero.titleB": "Dosya sende kalsın.",
  "hero.subtitle":
    "NovaTube videoları ve müziği doğrudan seçtiğin klasöre kaydeder. Hızlı, sessiz ve soru sormadan — kuyrukta koca bir çalma listesi olsa bile.",
  "cta.download": "İndir",
  "cta.features": "Neler yapar",
  "cta.note": "Windows yükleyicisi · çevrimdışı çalışır · hesap gerekmez",
  "features.video.title": "Video ve ses",
  "features.video.desc": "Kaliteyi, biçimi ve ses parçasını seç — ya da tek tıkla bırak.",
  "features.playlist.title": "Baştan sona listeler",
  "features.playlist.desc": "Çalma listesi bağlantısını yapıştır ve binlerce öğe olsa da hepsini birden al.",
  "features.private.title": "Sende kalır",
  "features.private.desc": "Her şey bilgisayarında olur. Hesap yok, yükleme yok.",
  "footer.note": "Dosyaların diskinde kalır.",
  "lang.label": "Dil",
};

export const DICTIONARIES: Record<LanguageCode, Record<MessageKey, string>> = {
  en,
  es,
  pt,
  ru,
  zh,
  ja,
  pl,
  de,
  fr,
  ar,
  hi,
  ko,
  it,
  tr,
};

export interface LanguageMeta {
  code: LanguageCode;
  /** Name written in the language itself. */
  native: string;
  /** English name, used in tooltips. */
  english: string;
  /** Country flag used for the badge. */
  flag: string;
  rtl?: boolean;
}

/** English first, then the languages people ask for most often. */
export const LANGUAGES: LanguageMeta[] = [
  { code: "en", native: "English", english: "English", flag: "US" },
  { code: "es", native: "Español", english: "Spanish", flag: "ES" },
  { code: "pt", native: "Português", english: "Portuguese", flag: "PT" },
  { code: "ru", native: "Русский", english: "Russian", flag: "RU" },
  { code: "zh", native: "中文", english: "Chinese", flag: "CN" },
  { code: "ja", native: "日本語", english: "Japanese", flag: "JP" },
  { code: "pl", native: "Polski", english: "Polish", flag: "PL" },
  { code: "de", native: "Deutsch", english: "German", flag: "DE" },
  { code: "fr", native: "Français", english: "French", flag: "FR" },
  { code: "ar", native: "العربية", english: "Arabic", flag: "SA", rtl: true },
  { code: "hi", native: "हिन्दी", english: "Hindi", flag: "IN" },
  { code: "ko", native: "한국어", english: "Korean", flag: "KR" },
  { code: "it", native: "Italiano", english: "Italian", flag: "IT" },
  { code: "tr", native: "Türkçe", english: "Turkish", flag: "TR" },
];

const CODES = new Set<string>(LANGUAGES.map((language) => language.code));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && CODES.has(value);
}

export function languageMeta(code: LanguageCode): LanguageMeta {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}

/** Replace `{name}` placeholders. Unknown keys stay untouched rather than throwing. */
export function translate(
  language: LanguageCode,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const table = DICTIONARIES[language] ?? en;
  const template = table[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

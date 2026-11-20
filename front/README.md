# NovaTube — strona landingowa

Statyczna strona (Vite + React + TypeScript + Tailwind CSS v4 + shadcn/ui) z przyciskiem **Pobierz**, w stylu aplikacji NovaTube: ciemny mesh `#0b0d13 → #131620`, gradienty `#4285f4` / `#9b72cb` / `#d96570` / `#24c1e0`, glassmorphism i delikatne animacje.

## Uruchomienie

```bash
cd front
npm install
npm run dev      # http://localhost:5173
npm run build    # wynik w front/dist
npm run preview
```

## Deploy na Vercel

W ustawieniach projektu na Vercel ustaw **Root Directory** na `front`. Reszta jest już w `vercel.json`:

| Ustawienie | Wartość |
| --- | --- |
| Framework | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

Z katalogu `front` można też użyć CLI: `npx vercel --prod`.

## Konfiguracja

| Zmienna | Opis |
| --- | --- |
| `VITE_DOWNLOAD_URL` | Adres, pod który prowadzi przycisk **Pobierz**. Domyślnie najnowsze wydanie z GitHub Releases. |

## Struktura

```
front/
├── index.html
├── vercel.json
├── components.json        # konfiguracja shadcn/ui
└── src/
    ├── App.tsx            # hero + sekcja funkcji + stopka
    ├── index.css          # tokeny shadcn + paleta NovaTube + glass/aurora
    ├── main.tsx
    ├── lib/utils.ts       # cn()
    └── components/ui/     # button, card, badge (shadcn)
```

Kolejne komponenty shadcn można dodać bez zmian w konfiguracji:

```bash
npx shadcn@latest add dialog
```

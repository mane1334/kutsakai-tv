# assets_gallery

Galeria de assets gerados (Google Flow) e onde estão ligados. Fonte em `apps/web/public/assets/`.

| Ficheiro | Tamanho | O que é | Onde é usado |
|---|---|---|---|
| `hero-bg.jpg` | 1376×768 | Arcos gold, centro escuro | Fallback do hero `/` com `prefers-reduced-motion` + imagem OG (`metadata.openGraph`) |
| `login-bg.jpg` | 1376×768 | Arcos simétricos, centro escuro | Fallback do `/login` com `prefers-reduced-motion` |
| `icon.jpg` | 1024×1024 | Monograma TV gold | Favicon + apple-touch-icon, marca na nav (`/`, `/catalog`, `/tv`, `/admin`), placeholder de canal sem logo |
| `og-banner.jpg` | 1376×768 | Arte com moldura (letterbox) | Painel media do card "Modo TV" na home (`object-fit: cover`, corta a moldura) |

## Notas
- `og-banner.jpg` tem bordas escuras embutidas — não usar como OG direto; para OG vai o `hero-bg.jpg` full-bleed.
- Comportamento normal: shader WebGL corre por defeito; a imagem só carrega quando o utilizador prefere movimento reduzido (poupa banda).
- Se gerares versões `.webm` dos loops, põe em `public/assets/` como `hero-loop.webm` / `login-loop.webm` e diz — ligo como 2ª opção de fallback (imagem → vídeo → shader).

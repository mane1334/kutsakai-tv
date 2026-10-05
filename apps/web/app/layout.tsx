import './dark-luxury.css';
import '../lib/polyfills';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://tv.kutsakai.dpdns.org'),
  title: 'Kutsakai TV — televisão que se descobre sozinha',
  description: 'Notícias, desporto, filmes e música de Moçambique ao mundo — com recomendações, EPG e monitor de qualidade.',
  icons: [{ rel: 'icon', url: '/assets/icon.jpg' }, { rel: 'apple-touch-icon', url: '/assets/icon.jpg' }],
  openGraph: {
    title: 'Kutsakai TV',
    description: '5000+ canais públicos com recomendações pessoais, EPG e monitor de qualidade.',
    images: [{ url: '/assets/hero-bg.jpg', width: 1376, height: 768 }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt"><body>{children}</body></html>;
}

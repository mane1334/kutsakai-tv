export interface RecInput {
  prefOverlap: number; // 0-1 categorias onboarding vs canal
  langOverlap: number;
  regionOverlap: number;
  catOverlap: number;
  behavior: number; // 0-1 soma weights 30d normalizada
  reliabilityScore: number; // 0-100
  popularity: number; // 0-1 log watch count
}

export function scoreChannel(i: RecInput): number {
  const quality = i.reliabilityScore / 100;
  return (
    i.prefOverlap * 0.3 +
    i.langOverlap * 0.2 +
    i.regionOverlap * 0.15 +
    i.catOverlap * 0.15 +
    i.behavior * 0.1 +
    quality * 0.05 +
    i.popularity * 0.05
  );
}

export function explainReason(i: RecInput, langs: string[], cats: string[]): string {
  if (i.behavior > 0.5) return `porque vês frequentemente ${cats.join(', ') || 'estes temas'}`;
  if (i.langOverlap > 0) return `porque vês canais em ${langs.join(', ')}`;
  if (i.catOverlap > 0) return `porque gostas de ${cats.join(', ')}`;
  return 'popular na tua região';
}

export const EVENT_WEIGHTS: Record<string, number> = {
  opened: 1,
  watched_30s: 2,
  watched_5min: 5,
  watched_30min: 10,
  favorite: 20,
  returned: 10,
  skipped: -5,
};

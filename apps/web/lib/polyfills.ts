// Polyfills mínimos para browsers antigos (Android TV / boxes baratas).
// Importar 1x no root layout, antes de tudo. Sem dependências.
"use client";

if (typeof Object.fromEntries !== "function") {
  (Object as any).fromEntries = (entries: Array<[string, any]>) => {
    const out: Record<string, any> = {};
    for (let i = 0; i < entries.length; i++) out[entries[i][0]] = entries[i][1];
    return out;
  };
}

if (typeof window !== "undefined" && (window as any).MediaQueryList) {
  const proto = (window as any).MediaQueryList.prototype;
  if (proto && typeof proto.addEventListener !== "function" && typeof proto.addListener === "function") {
    proto.addEventListener = function (type: string, fn: any) {
      if (type === "change") this.addListener(fn);
    };
    proto.removeEventListener = function (type: string, fn: any) {
      if (type === "change") this.removeListener(fn);
    };
  }
}

if (!(Array.prototype as any).at) {
  (Array.prototype as any).at = function (i: number) {
    const n = Math.trunc(i) || 0;
    const k = n < 0 ? this.length + n : n;
    return k >= 0 && k < this.length ? this[k] : undefined;
  };
}

if (!(String.prototype as any).replaceAll) {
  (String.prototype as any).replaceAll = function (search: any, replace: any) {
    return this.split(search).join(replace);
  };
}

export {};

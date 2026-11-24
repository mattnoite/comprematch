const SAO_PAULO_TZ = "America/Sao_Paulo";

/**
 * Retorna a data atual no fuso de São Paulo (America/Sao_Paulo) em formato YYYY-MM-DD.
 */
export function getSaoPauloTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Retorna a data de hoje + `offsetDays` no fuso de São Paulo em formato YYYY-MM-DD.
 */
export function getSaoPauloOffsetIso(offsetDays: number): string {
  const [y, m, d] = getSaoPauloTodayIso().split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const year = String(utcDate.getUTCFullYear());
  const month = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getSaoPauloCurrentYear(): number {
  return Number(getSaoPauloTodayIso().slice(0, 4));
}

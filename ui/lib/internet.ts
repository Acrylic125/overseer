/** Stable id for the public-internet hub service (matches scan). */
export const INTERNET_ID = "internet";

export function isInternetService(service: { id: string }): boolean {
  return service.id === INTERNET_ID;
}

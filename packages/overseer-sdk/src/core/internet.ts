import { scanEntries } from "./scan.js";
import type { ProviderResourceScanner, Resource } from "../types.js";

export const INTERNET_ID = "internet:public" as const;

export function isInternetResource(resource: { id: string }): boolean {
  return resource.id === INTERNET_ID;
}

export function internetResource(): Resource<"internet"> {
  return {
    id: INTERNET_ID,
    group: "internet",
    name: "Public Internet",
    url: "",
    service: "internet",
    fields: {},
    asset: "cloud",
    alerts: [],
    tags: { namespace: "internet" },
  };
}

export const internetScanner = {
  type: "Internet",
  scrape() {
    return [{}];
  },
  transform() {
    return internetResource();
  },
  connection() {
    return {
      claims: [],
      require: () => false,
    };
  },
} satisfies ProviderResourceScanner<Record<string, never>>;

export function newInternetProvider() {
  return {
    provider: "internet" as const,
    scan() {
      return scanEntries(internetScanner, internetScanner.scrape(), "internet");
    },
  };
}

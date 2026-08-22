import {
  FILTER_KEYS,
  hintAt,
  type SearchDocument,
  type SearchKey,
} from "@/lib/search-ql";

export type SearchSuggestion = {
  id: string;
  kind: "key" | "value" | "operator";
  label: string;
  insertText: string;
  replace: { start: number; end: number };
};

type SearchCatalog = {
  docs: SearchDocument[];
};

const MAX_ROWS = 12;
const NUMBER_KEYS = new Set<SearchKey>(["warnAlerts", "errorAlert"]);
const NUMBER_OPERATORS = [">", ">=", "<", "<=", "[", "("] as const;

function replaceSpan(cursor: number, partial: string) {
  return { start: cursor - partial.length, end: cursor };
}

function prefixMatch(candidate: string, partial: string) {
  if (partial.length === 0) {
    return true;
  }
  return candidate.toLowerCase().startsWith(partial.toLowerCase());
}

function needsQuotes(value: string) {
  return /[\s&|"()\\]/.test(value);
}

function quoteValue(value: string) {
  if (!needsQuotes(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function uniqueStrings(values: Iterable<string>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function valuesForKey(key: SearchKey, docs: SearchDocument[]) {
  if (key === "name") {
    return uniqueStrings(docs.map((doc) => doc.name));
  }
  if (key === "fieldName") {
    return uniqueStrings(docs.flatMap((doc) => doc.fieldNames));
  }
  if (key === "fieldValue") {
    return uniqueStrings(docs.flatMap((doc) => doc.fieldValues));
  }
  if (key === "warnAlerts") {
    return uniqueStrings(docs.map((doc) => String(doc.warnAlerts)));
  }
  return uniqueStrings(docs.map((doc) => String(doc.errorAlert)));
}

function keySuggestions(partial: string, replace: { start: number; end: number }) {
  const rows: SearchSuggestion[] = [];
  for (const key of FILTER_KEYS) {
    if (!prefixMatch(key, partial)) {
      continue;
    }
    rows.push({
      id: `key:${key}`,
      kind: "key",
      label: key,
      insertText: `${key}:`,
      replace,
    });
    if (rows.length >= MAX_ROWS) {
      break;
    }
  }
  return rows;
}

function valueSuggestions(args: {
  key: SearchKey;
  partial: string;
  replace: { start: number; end: number };
  docs: SearchDocument[];
}) {
  const rows: SearchSuggestion[] = [];
  for (const value of valuesForKey(args.key, args.docs)) {
    if (!prefixMatch(value, args.partial)) {
      continue;
    }
    const insertText = NUMBER_KEYS.has(args.key) ? value : quoteValue(value);
    rows.push({
      id: `value:${args.key}:${value}`,
      kind: "value",
      label: value,
      insertText,
      replace: args.replace,
    });
    if (rows.length >= MAX_ROWS) {
      break;
    }
  }
  return rows;
}

function operatorSuggestions(partial: string, replace: { start: number; end: number }) {
  const rows: SearchSuggestion[] = [];
  for (const op of NUMBER_OPERATORS) {
    if (!op.startsWith(partial)) {
      continue;
    }
    rows.push({
      id: `operator:${op}`,
      kind: "operator",
      label: op,
      insertText: op,
      replace,
    });
    if (rows.length >= MAX_ROWS) {
      break;
    }
  }
  return rows;
}

export function suggestSearch(args: {
  query: string;
  cursor: number;
  catalog: SearchCatalog;
}) {
  const cursor = Math.max(0, Math.min(args.cursor, args.query.length));
  const hint = hintAt(args.query, cursor);
  const replace = replaceSpan(cursor, hint.partial);

  if (hint.expect === "key") {
    return keySuggestions(hint.partial, replace);
  }
  if (hint.expect === "operator") {
    return operatorSuggestions(hint.partial, replace);
  }
  if (hint.expect === "value") {
    if (hint.activeKey == null) {
      return [];
    }
    return valueSuggestions({
      key: hint.activeKey,
      partial: hint.partial,
      replace,
      docs: args.catalog.docs,
    });
  }
  return [];
}

export function applySuggestion(query: string, suggestion: SearchSuggestion) {
  const nextQuery =
    query.slice(0, suggestion.replace.start) +
    suggestion.insertText +
    query.slice(suggestion.replace.end);
  const cursor = suggestion.replace.start + suggestion.insertText.length;
  return { query: nextQuery, cursor };
}

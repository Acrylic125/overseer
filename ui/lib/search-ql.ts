import {
  isFieldGroup,
  resolveFieldValue,
  type FieldNode,
  type ResolvedField,
  type ServiceFields,
} from "@/lib/infrastructure-schema";

export const FILTER_KEYS = [
  "name",
  "fieldName",
  "fieldValue",
  "warnAlerts",
  "errorAlert",
] as const;

export type SearchKey = (typeof FILTER_KEYS)[number];

type Span = { start: number; end: number };

type StringPred =
  | { kind: "contains"; text: string }
  | { kind: "exact"; text: string };

type NumberPred =
  | { kind: "eq"; n: number }
  | { kind: "gt"; n: number }
  | { kind: "gte"; n: number }
  | { kind: "lt"; n: number }
  | { kind: "lte"; n: number }
  | {
      kind: "range";
      lo: number;
      hi: number;
      loInclusive: boolean;
      hiInclusive: boolean;
    };

type FilterAtom =
  | { kind: "name"; pred: StringPred; span: Span }
  | { kind: "fieldName"; pred: StringPred; span: Span }
  | { kind: "fieldValue"; pred: StringPred; span: Span }
  | { kind: "warnAlerts"; pred: NumberPred; span: Span }
  | { kind: "errorAlert"; pred: NumberPred; span: Span }
  | { kind: "bare"; text: string; span: Span };

type QueryNode =
  | { kind: "atom"; atom: FilterAtom }
  | { kind: "not"; node: QueryNode; span: Span }
  | { kind: "and" | "or"; left: QueryNode; right: QueryNode; span: Span };

export type SearchDocument = {
  id: string;
  name: string;
  fieldNames: string[];
  fieldValues: string[];
  warnAlerts: number;
  errorAlert: number;
  allText: string;
};

type SearchCatalog = {
  docs: SearchDocument[];
  byId: Map<string, SearchDocument>;
};

type ParseSuccess = { ok: true; ast: QueryNode | null };
type ParseFailure = { ok: false; message: string; at: number };
type ParseResult = ParseSuccess | ParseFailure;

const STRING_KEYS = new Set<SearchKey>(["name", "fieldName", "fieldValue"]);
const NUMBER_KEYS = new Set<SearchKey>(["warnAlerts", "errorAlert"]);
const KEY_SET = new Set<string>(FILTER_KEYS);

const ESCAPABLE = new Set(["|", "&", '"', "(", ")", "\\"]);

function isSearchKey(text: string): text is SearchKey {
  return KEY_SET.has(text);
}

function isIdentStart(ch: string) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentCont(ch: string) {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function pushResolvedValues(resolved: ResolvedField, out: string[]) {
  if (resolved.type === "hidden") {
    return;
  }
  if (
    resolved.type === "string" ||
    resolved.type === "date" ||
    resolved.type === "secret"
  ) {
    out.push(resolved.value);
    return;
  }
  if (resolved.type === "bool") {
    out.push(String(resolved.value));
    return;
  }
  if (resolved.type === "graph") {
    for (const vertex of resolved.vertices) {
      out.push(vertex);
    }
    return;
  }
  if (resolved.type === "table") {
    for (const row of resolved.rows) {
      for (const cell of row) {
        out.push(cell);
      }
    }
  }
}

function walkFieldNode(
  key: string,
  node: FieldNode,
  names: string[],
  values: string[],
) {
  if (isFieldGroup(node)) {
    for (const [childKey, child] of Object.entries(node.fields)) {
      walkFieldNode(childKey, child, names, values);
    }
    return;
  }

  names.push(key);
  const resolved = resolveFieldValue(node);
  if (!resolved) {
    return;
  }
  if (Array.isArray(resolved)) {
    for (const item of resolved) {
      pushResolvedValues(item, values);
    }
    return;
  }
  pushResolvedValues(resolved, values);
}

function flattenFields(fields: ServiceFields) {
  const fieldNames: string[] = [];
  const fieldValues: string[] = [];
  for (const category of Object.values(fields)) {
    for (const [key, node] of Object.entries(category)) {
      walkFieldNode(key, node, fieldNames, fieldValues);
    }
  }
  return { fieldNames, fieldValues };
}

export function countsFromAlerts(
  alerts: { resourceId: string; type: "warning" | "error" }[],
) {
  const map = new Map<string, { warn: number; error: number }>();
  for (const alert of alerts) {
    let counts = map.get(alert.resourceId);
    if (!counts) {
      counts = { warn: 0, error: 0 };
      map.set(alert.resourceId, counts);
    }
    if (alert.type === "warning") {
      counts.warn += 1;
    } else {
      counts.error += 1;
    }
  }
  return map;
}

export function buildSearchCatalog(
  services: { id: string; name: string; fields: ServiceFields }[],
  alertCounts: Map<string, { warn: number; error: number }>,
) {
  const docs: SearchDocument[] = [];
  const byId = new Map<string, SearchDocument>();

  for (const service of services) {
    const { fieldNames, fieldValues } = flattenFields(service.fields);
    const counts = alertCounts.get(service.id);
    const warnAlerts = counts?.warn ?? 0;
    const errorAlert = counts?.error ?? 0;
    const allText = [service.name, ...fieldNames, ...fieldValues].join(" ");
    const doc: SearchDocument = {
      id: service.id,
      name: service.name,
      fieldNames,
      fieldValues,
      warnAlerts,
      errorAlert,
      allText,
    };
    docs.push(doc);
    byId.set(doc.id, doc);
  }

  return { docs, byId } satisfies SearchCatalog;
}

class ParseError extends Error {
  at: number;
  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

class Parser {
  input: string;
  i = 0;

  constructor(input: string) {
    this.input = input;
  }

  peek() {
    return this.input[this.i] ?? "";
  }

  atEnd() {
    return this.i >= this.input.length;
  }

  skipWs() {
    while (this.i < this.input.length) {
      const ch = this.input[this.i];
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
        break;
      }
      this.i += 1;
    }
  }

  fail(message: string, at = this.i): never {
    throw new ParseError(message, at);
  }

  expectChar(ch: string) {
    if (this.peek() !== ch) {
      this.fail(`Expected '${ch}'`);
    }
    this.i += 1;
  }

  readIdent() {
    const start = this.i;
    if (!isIdentStart(this.peek())) {
      return null;
    }
    this.i += 1;
    while (isIdentCont(this.peek())) {
      this.i += 1;
    }
    return this.input.slice(start, this.i);
  }

  readEscapedChar() {
    if (this.peek() !== "\\") {
      return null;
    }
    const escAt = this.i;
    this.i += 1;
    const next = this.peek();
    if (!next) {
      this.fail("Incomplete escape", escAt);
    }
    this.i += 1;
    if (ESCAPABLE.has(next)) {
      return next;
    }
    return next;
  }

  readQuoted() {
    const start = this.i;
    this.expectChar('"');
    let text = "";
    while (!this.atEnd()) {
      if (this.peek() === '"') {
        this.i += 1;
        return { text, span: { start, end: this.i } };
      }
      const escaped = this.readEscapedChar();
      if (escaped !== null) {
        text += escaped;
        continue;
      }
      text += this.peek();
      this.i += 1;
    }
    this.fail("Unterminated string", start);
  }

  readUnquotedValue() {
    const start = this.i;
    let text = "";
    while (!this.atEnd()) {
      const ch = this.peek();
      if (
        ch === " " ||
        ch === "\t" ||
        ch === "\n" ||
        ch === "\r" ||
        ch === "&" ||
        ch === "|" ||
        ch === ")" ||
        ch === "(" ||
        ch === "!"
      ) {
        break;
      }
      const escaped = this.readEscapedChar();
      if (escaped !== null) {
        text += escaped;
        continue;
      }
      text += ch;
      this.i += 1;
    }
    if (this.i === start) {
      this.fail("Expected value", start);
    }
    return { text, span: { start, end: this.i } };
  }

  readNumber() {
    const start = this.i;
    if (this.peek() === "+" || this.peek() === "-") {
      this.i += 1;
    }
    const intStart = this.i;
    while (this.peek() >= "0" && this.peek() <= "9") {
      this.i += 1;
    }
    if (this.i === intStart) {
      this.fail("Expected number", start);
    }
    if (this.peek() === ".") {
      this.i += 1;
      const fracStart = this.i;
      while (this.peek() >= "0" && this.peek() <= "9") {
        this.i += 1;
      }
      if (this.i === fracStart) {
        this.fail("Expected digits after decimal", start);
      }
    }
    const raw = this.input.slice(start, this.i);
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      this.fail("Invalid number", start);
    }
    return n;
  }

  parseStringPred() {
    this.skipWs();
    if (this.peek() === '"') {
      const quoted = this.readQuoted();
      return {
        pred: { kind: "exact" as const, text: quoted.text },
        end: quoted.span.end,
      };
    }
    const unquoted = this.readUnquotedValue();
    return {
      pred: { kind: "contains" as const, text: unquoted.text },
      end: unquoted.span.end,
    };
  }

  parseNumberPred() {
    this.skipWs();
    const start = this.i;
    const ch = this.peek();

    if (ch === "[" || ch === "(") {
      const loInclusive = ch === "[";
      this.i += 1;
      this.skipWs();
      const lo = this.readNumber();
      this.skipWs();
      this.expectChar(",");
      this.skipWs();
      const hi = this.readNumber();
      this.skipWs();
      const close = this.peek();
      if (close !== "]" && close !== ")") {
        this.fail("Expected ']' or ')' to close range", this.i);
      }
      const hiInclusive = close === "]";
      this.i += 1;
      return {
        pred: {
          kind: "range" as const,
          lo,
          hi,
          loInclusive,
          hiInclusive,
        },
        end: this.i,
      };
    }

    if (ch === ">") {
      this.i += 1;
      const gte = this.peek() === "=";
      if (gte) {
        this.i += 1;
      }
      this.skipWs();
      const n = this.readNumber();
      return {
        pred: { kind: gte ? ("gte" as const) : ("gt" as const), n },
        end: this.i,
      };
    }

    if (ch === "<") {
      this.i += 1;
      const lte = this.peek() === "=";
      if (lte) {
        this.i += 1;
      }
      this.skipWs();
      const n = this.readNumber();
      return {
        pred: { kind: lte ? ("lte" as const) : ("lt" as const), n },
        end: this.i,
      };
    }

    if ((ch >= "0" && ch <= "9") || ch === "+" || ch === "-") {
      const n = this.readNumber();
      return { pred: { kind: "eq" as const, n }, end: this.i };
    }

    this.fail("Expected number predicate", start);
  }

  parseKeyedAtom(key: SearchKey, keyStart: number) {
    if (STRING_KEYS.has(key)) {
      const { pred, end } = this.parseStringPred();
      const span = { start: keyStart, end };
      if (key === "name") {
        return {
          kind: "atom" as const,
          atom: { kind: "name" as const, pred, span },
        };
      }
      if (key === "fieldName") {
        return {
          kind: "atom" as const,
          atom: { kind: "fieldName" as const, pred, span },
        };
      }
      return {
        kind: "atom" as const,
        atom: { kind: "fieldValue" as const, pred, span },
      };
    }

    if (NUMBER_KEYS.has(key)) {
      const { pred, end } = this.parseNumberPred();
      const span = { start: keyStart, end };
      if (key === "warnAlerts") {
        return {
          kind: "atom" as const,
          atom: { kind: "warnAlerts" as const, pred, span },
        };
      }
      return {
        kind: "atom" as const,
        atom: { kind: "errorAlert" as const, pred, span },
      };
    }

    this.fail(`Unknown key '${key}'`, keyStart);
  }

  parseAtom(inheritedKey: SearchKey | null): QueryNode {
    this.skipWs();
    const start = this.i;
    if (
      this.atEnd() ||
      this.peek() === ")" ||
      this.peek() === "&" ||
      this.peek() === "|"
    ) {
      this.fail("Expected filter", start);
    }

    const ident = this.readIdent();
    if (ident !== null && this.peek() === ":") {
      if (!isSearchKey(ident)) {
        this.fail(`Unknown key '${ident}'`, start);
      }
      this.i += 1;
      return this.parseKeyedAtom(ident, start);
    }

    this.i = start;
    if (inheritedKey) {
      return this.parseKeyedAtom(inheritedKey, start);
    }

    if (this.peek() === '"') {
      const quoted = this.readQuoted();
      return {
        kind: "atom",
        atom: {
          kind: "bare",
          text: quoted.text,
          span: { start, end: quoted.span.end },
        },
      };
    }

    const unquoted = this.readUnquotedValue();
    return {
      kind: "atom",
      atom: {
        kind: "bare",
        text: unquoted.text,
        span: { start, end: unquoted.span.end },
      },
    };
  }

  parseTerm(inheritedKey: SearchKey | null): QueryNode {
    this.skipWs();
    const start = this.i;

    if (this.peek() === "!") {
      this.i += 1;
      const node = this.parseTerm(inheritedKey);
      return { kind: "not", node, span: { start, end: nodeSpanEnd(node) } };
    }

    if (this.peek() === "(") {
      this.i += 1;
      const node = this.parseExpr(inheritedKey);
      this.skipWs();
      this.expectChar(")");
      return node;
    }

    return this.parseAtom(inheritedKey);
  }

  explicitKey(node: QueryNode): SearchKey | null {
    if (node.kind === "atom") {
      const { atom } = node;
      if (atom.kind === "bare") {
        return null;
      }
      return atom.kind;
    }
    if (node.kind === "not") {
      return this.explicitKey(node.node);
    }
    return this.explicitKey(node.right);
  }

  parseExpr(inheritedKey: SearchKey | null = null): QueryNode {
    let left = this.parseTerm(inheritedKey);
    let lastKey = this.explicitKey(left) ?? inheritedKey;

    while (true) {
      this.skipWs();
      const op = this.peek();
      if (op !== "&" && op !== "|") {
        break;
      }
      this.i += 1;
      const right = this.parseTerm(lastKey);
      const span = { start: nodeSpanStart(left), end: nodeSpanEnd(right) };
      if (op === "&") {
        left = { kind: "and", left, right, span };
      } else {
        left = { kind: "or", left, right, span };
      }
      lastKey = this.explicitKey(right) ?? lastKey;
    }

    return left;
  }

  parse(): ParseResult {
    this.skipWs();
    if (this.atEnd()) {
      return { ok: true, ast: null };
    }
    try {
      const ast = this.parseExpr(null);
      this.skipWs();
      if (!this.atEnd()) {
        this.fail("Unexpected input");
      }
      return { ok: true, ast };
    } catch (error) {
      if (error instanceof ParseError) {
        return { ok: false, message: error.message, at: error.at };
      }
      throw error;
    }
  }
}

function nodeSpanStart(node: QueryNode) {
  if (node.kind === "atom") {
    return node.atom.span.start;
  }
  return node.span.start;
}

function nodeSpanEnd(node: QueryNode) {
  if (node.kind === "atom") {
    return node.atom.span.end;
  }
  return node.span.end;
}

export function parseQuery(input: string): ParseResult {
  return new Parser(input).parse();
}

function matchStringPred(values: string[], pred: StringPred) {
  if (pred.kind === "exact") {
    const target = pred.text.toLowerCase();
    for (const value of values) {
      if (value.toLowerCase() === target) {
        return true;
      }
    }
    return false;
  }
  const needle = pred.text.toLowerCase();
  for (const value of values) {
    if (value.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function matchNumberPred(n: number, pred: NumberPred) {
  if (pred.kind === "range") {
    const loOk = pred.loInclusive ? n >= pred.lo : n > pred.lo;
    if (!loOk) {
      return false;
    }
    if (pred.hiInclusive) {
      return n <= pred.hi;
    }
    return n < pred.hi;
  }
  if (pred.kind === "eq") {
    return n === pred.n;
  }
  if (pred.kind === "gt") {
    return n > pred.n;
  }
  if (pred.kind === "gte") {
    return n >= pred.n;
  }
  if (pred.kind === "lt") {
    return n < pred.n;
  }
  return n <= pred.n;
}

function matchAtom(doc: SearchDocument, atom: FilterAtom) {
  if (atom.kind === "name") {
    return matchStringPred([doc.name], atom.pred);
  }
  if (atom.kind === "fieldName") {
    return matchStringPred(doc.fieldNames, atom.pred);
  }
  if (atom.kind === "fieldValue") {
    return matchStringPred(doc.fieldValues, atom.pred);
  }
  if (atom.kind === "warnAlerts") {
    return matchNumberPred(doc.warnAlerts, atom.pred);
  }
  if (atom.kind === "errorAlert") {
    return matchNumberPred(doc.errorAlert, atom.pred);
  }
  return doc.allText.toLowerCase().includes(atom.text.toLowerCase());
}

function matchDocument(doc: SearchDocument, node: QueryNode): boolean {
  if (node.kind === "atom") {
    return matchAtom(doc, node.atom);
  }
  if (node.kind === "not") {
    return !matchDocument(doc, node.node);
  }
  if (node.kind === "and") {
    return matchDocument(doc, node.left) && matchDocument(doc, node.right);
  }
  return matchDocument(doc, node.left) || matchDocument(doc, node.right);
}

export function evaluateSearch(
  query: string,
  catalog: { docs: SearchDocument[] },
) {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: true as const, matchIds: null };
  }

  const parsed = parseQuery(trimmed);
  if (!parsed.ok || parsed.ast === null) {
    return { ok: true as const, matchIds: null };
  }

  const matchIds = new Set<string>();
  for (const doc of catalog.docs) {
    if (matchDocument(doc, parsed.ast)) {
      matchIds.add(doc.id);
    }
  }
  return { ok: true as const, matchIds };
}

export function composeFocusIds(args: {
  searchMatchIds: Set<string> | null;
  selectionIds: Set<string> | null;
}) {
  const { searchMatchIds, selectionIds } = args;
  if (searchMatchIds == null && selectionIds == null) {
    return null;
  }
  if (searchMatchIds == null) {
    return selectionIds;
  }
  if (selectionIds == null) {
    return searchMatchIds;
  }
  const intersection = new Set<string>();
  for (const id of searchMatchIds) {
    if (selectionIds.has(id)) {
      intersection.add(id);
    }
  }
  return intersection;
}

export function hintAt(query: string, cursor: number) {
  const safeCursor = Math.max(0, Math.min(cursor, query.length));
  const before = query.slice(0, safeCursor);
  const partialMatch = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  let partial = partialMatch?.[1] ?? "";

  const parsed = parseQuery(query.trim());
  let parseError: { message: string; at: number } | null = null;
  if (!parsed.ok) {
    parseError = { message: parsed.message, at: parsed.at };
  }

  let expect: "key" | "value" | "operator" | "done" = "done";
  let activeKey: SearchKey | null = null;

  if (partial.length > 0 && before.endsWith(partial)) {
    const withoutPartial = before.slice(0, before.length - partial.length);
    if (/:\s*$/.test(withoutPartial)) {
      expect = "value";
    } else {
      expect = "key";
    }
  } else if (/:\s*$/.test(before)) {
    expect = "value";
  } else if (/[&|]\s*$/.test(before)) {
    expect = "key";
  }

  const keyMatch =
    /(?:^|[&|(!\s])(name|fieldName|fieldValue|warnAlerts|errorAlert)\s*:\s*([^:&|()!]*)$/.exec(
      before,
    );
  if (keyMatch?.[1] && isSearchKey(keyMatch[1])) {
    activeKey = keyMatch[1];
  }

  if (
    activeKey != null &&
    NUMBER_KEYS.has(activeKey) &&
    (expect === "value" || expect === "done")
  ) {
    const valueText = keyMatch?.[2] ?? "";
    if (
      valueText === "" ||
      valueText === "[" ||
      valueText === "(" ||
      /^[<>]=?$/.test(valueText)
    ) {
      expect = "operator";
      partial = valueText;
    } else {
      expect = "value";
    }
  }

  return {
    expect,
    keys: [...FILTER_KEYS],
    activeKey,
    partial,
    parseError,
  };
}

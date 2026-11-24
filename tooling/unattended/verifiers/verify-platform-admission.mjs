// This verifier is controller-owned and deliberately outside the implementation task's writable paths.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const sourcePath = "packages/platform-core/src/admission.ts";
const testPath = "packages/platform-core/src/admission.test.ts";
const indexPath = "packages/platform-core/src/index.ts";
const reportPath = process.argv[2];

const requiredTests = new Map([
  ["serializes interleaved admissions at the concurrency limit", 8],
  ["replays only matching admitted decisions within the full scope", 8],
  ["uses half-open fixed windows and expires leases at the boundary", 8],
  ["honors inclusive request and size limits", 8],
  ["rejects policy drift while live state is retained", 6],
  ["isolates monotonic clocks and lease identifiers by full scope", 6],
  ["calls the lease-id factory only for otherwise eligible admissions", 6],
  ["bounds retention without evicting live state", 8],
  ["returns typed no-ops for malformed and foreign release requests", 8],
  ["rejects malformed inputs without mutation", 6],
  ["keeps denied idempotency keys out of retention", 6],
  ["cleans empty scope tails with compare-and-delete", 6],
  ["mutation proof fails without serialization and fingerprint guards", 8],
  ["deep-freezes returned decisions and snapshots", 8],
]);

const requiredExports = [
  "AdmissionScope",
  "AdmissionRequest",
  "AdmissionPolicy",
  "AdmissionDenialCode",
  "AdmissionDecision",
  "AdmissionLease",
  "AdmissionReleaseRequest",
  "AdmissionReleaseResult",
  "AdmissionClock",
  "AdmissionLeaseIdFactory",
  "AdmissionAdapter",
  "InMemoryAdmissionAdapterOptions",
  "AdmissionSnapshot",
  "InMemoryAdmissionAdapter",
  "createInMemoryAdmissionAdapter",
];

const exactMemberShapes = new Map([
  ["AdmissionScope", ["tenantId", "principalId", "operation"]],
  ["AdmissionRequest", ["scope", "idempotencyKey", "fingerprint", "sizeBytes"]],
  [
    "AdmissionPolicy",
    [
      "maxRequests",
      "windowMs",
      "maxConcurrent",
      "leaseMs",
      "idempotencyTtlMs",
      "maxIdempotencyEntriesPerScope",
      "maxSizeBytes",
    ],
  ],
  ["AdmissionLease", ["leaseId", "scope", "admittedAtMs", "expiresAtMs", "policy"]],
  ["AdmissionReleaseRequest", ["scope", "leaseId"]],
  ["AdmissionReleaseResult", ["status"]],
  ["AdmissionClock", ["nowMs"]],
  ["AdmissionLeaseIdFactory", ["nextLeaseId"]],
  ["AdmissionAdapter", ["admit", "release"]],
  ["InMemoryAdmissionAdapterOptions", ["clock", "leaseIdFactory", "beforeCommit"]],
  [
    "AdmissionSnapshot",
    [
      "scope",
      "policy",
      "windowStartMs",
      "windowCount",
      "activeLeaseCount",
      "retainedIdempotencyCount",
      "retainedLeaseCount",
    ],
  ],
  ["InMemoryAdmissionAdapter", ["snapshot"]],
]);

function readRequired(path) {
  assert.equal(fs.existsSync(path), true, `required artifact missing: ${path}`);
  return fs.readFileSync(path, "utf8");
}

function occurrences(source, token) {
  return source.split(token).length - 1;
}

function declarationName(node) {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function memberNames(node) {
  const members = ts.isInterfaceDeclaration(node)
    ? node.members
    : ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)
      ? node.type.members
      : undefined;
  assert.ok(members, `${declarationName(node)} must be an interface or object type alias`);
  return members.map((member) => {
    assert.ok(member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)));
    return member.name.text;
  });
}

function collectStringLiterals(node) {
  const values = [];
  const visit = (child) => {
    if (ts.isLiteralTypeNode(child) && ts.isStringLiteral(child.literal)) {
      values.push(child.literal.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return values;
}

function verifyStaticContract(source, tests, index, report) {
  assert.ok(index.includes('export * from "./admission";'), "admission barrel export missing");

  const sourceAst = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map();
  for (const statement of sourceAst.statements) {
    const name = declarationName(statement);
    if (name && hasExportModifier(statement)) {
      declarations.set(name, statement);
    }
  }

  for (const name of requiredExports) {
    assert.ok(declarations.has(name), `required direct export missing: ${name}`);
  }
  assert.ok(
    ts.isFunctionDeclaration(declarations.get("createInMemoryAdmissionAdapter")),
    "createInMemoryAdmissionAdapter must be an exported function declaration",
  );

  for (const [name, expected] of exactMemberShapes) {
    const actual = memberNames(declarations.get(name));
    assert.deepEqual([...actual].sort(), [...expected].sort(), `${name} has the wrong closed shape`);
  }

  const denialCodes = collectStringLiterals(declarations.get("AdmissionDenialCode"));
  assert.deepEqual(
    [...denialCodes].sort(),
    [
      "invalid_request",
      "idempotency_conflict",
      "idempotency_capacity",
      "size_exceeded",
      "rate_limited",
      "concurrency_limited",
    ].sort(),
    "AdmissionDenialCode has the wrong values",
  );

  assert.deepEqual(
    [...collectStringLiterals(declarations.get("AdmissionReleaseResult"))].sort(),
    ["released", "already_released", "expired", "not_found", "invalid_request"].sort(),
    "AdmissionReleaseResult has the wrong status values",
  );

  const serializationToken = "return enqueueScopeOperation(scopeKey, operation);";
  const fingerprintToken = "existing.fingerprint === request.fingerprint";
  assert.equal(occurrences(source, serializationToken), 1, "serialization mutation token must occur once");
  assert.equal(occurrences(source, fingerprintToken), 1, "fingerprint mutation token must occur once");

  const productionBan =
    /(?:\bimport\s*\(|Date\.now|new Date\s*\(|performance\.now|Date\s*\[|process\.hrtime|process\.nextTick|process\.env|process\s*\[|setTimeout|setInterval|setImmediate|globalThis\s*\[|Math\.random|\bcrypto\s*\.|\bfetch\s*\(|@opentenant\/database|(?:from\s+|require\s*\(\s*)["'](?:(?:node:)?(?:fs|crypto|timers)(?:\/promises)?|pg|postgres)(?:["'/]))/;
  assert.equal(productionBan.test(source), false, "forbidden admission production surface");
  assert.equal(productionBan.test(index), false, "forbidden index production surface");

  const testWriteBan =
    /(?:writeFile|appendFile|mkdtemp|createWriteStream|copyFile|rename|openSync|writeSync|\.open\s*\(|fs\.promises)/;
  assert.equal(testWriteBan.test(tests), false, "mutation proof must not write files");
  assert.equal(
    /\b(?:it|test|describe)\.(?:skip|only|todo)\b/.test(tests),
    false,
    "focused, skipped or todo test forbidden",
  );
  assert.equal(
    /(?:setTimeout|setInterval|setImmediate|\bsleep\s*\()/.test(tests),
    false,
    "timer-based test waiting is forbidden",
  );
  assert.ok(
    tests.includes('from "./admission"') || tests.includes("from './admission'"),
    "tests must import the production adapter",
  );
  assert.equal(
    /\b(?:class|function|const|let|var)\s+createInMemoryAdmissionAdapter\b/.test(tests),
    false,
    "tests must not redeclare the production adapter",
  );
  assert.ok(
    tests.includes("node:vm") || tests.includes("data:text/javascript"),
    "mutation test must positively use an in-memory evaluation surface",
  );

  for (const literal of [
    "idempotency_capacity",
    "size_exceeded",
    "rate_limited",
    "concurrency_limited",
    "already_released",
    "not_found",
    "expired",
  ]) {
    assert.ok(tests.includes(literal), `test suite is missing semantic literal ${literal}`);
  }

  const testAst = ts.createSourceFile(testPath, tests, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const discovered = new Map();
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "it" || node.expression.text === "test") &&
      node.arguments.length >= 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      requiredTests.has(node.arguments[0].text)
    ) {
      const name = node.arguments[0].text;
      assert.equal(discovered.has(name), false, `duplicate required test: ${name}`);
      const body = node.arguments[1];
      assert.ok(ts.isArrowFunction(body) || ts.isFunctionExpression(body), `invalid required test body: ${name}`);
      let expectCalls = 0;
      const countExpect = (child) => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "expect") {
          expectCalls += 1;
        }
        ts.forEachChild(child, countExpect);
      };
      countExpect(body.body);
      assert.ok(expectCalls >= requiredTests.get(name), `required test has too few assertions: ${name}`);
      discovered.set(name, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(testAst);

  for (const name of requiredTests.keys()) {
    assert.ok(discovered.has(name), `required test definition missing: ${name}`);
  }

  if (report) {
    assert.equal(report.success, true, "Vitest JSON report is not successful");
    assert.equal(report.numFailedTests, 0, "Vitest JSON report contains failed tests");
    assert.ok(
      (report.testResults ?? []).some((result) =>
        String(result.name).endsWith("packages/platform-core/src/admission.test.ts"),
      ),
      "Vitest JSON report does not originate from admission.test.ts",
    );
    const assertions = (report.testResults ?? []).flatMap((result) => result.assertionResults ?? []);
    for (const name of requiredTests.keys()) {
      const matches = assertions.filter(
        (result) =>
          result.title === name || result.fullName === name || result.fullName?.endsWith(` ${name}`),
      );
      assert.equal(matches.length, 1, `required test not uniquely reported: ${name}`);
      assert.equal(matches[0].status, "passed", `required test did not pass: ${name}`);
    }
    assert.equal(
      assertions.some((result) => result.status !== "passed"),
      false,
      "admission suite contains a non-passing assertion",
    );
  }
}

async function withTimeout(promise, label, timeoutMs = 5_000) {
  let timeout;
  const guard = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timeout);
  }
}

function loadAdmissionModule(source, label) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: `${label}.ts`,
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(errors.length, 0, `${label} failed to transpile`);

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(specifier) {
      throw new Error(`unexpected runtime import in ${label}: ${specifier}`);
    },
    console,
    queueMicrotask,
    structuredClone,
  });
  vm.runInContext(transpiled.outputText, context, { filename: `${label}.cjs` });
  return module.exports;
}

function hexId(number) {
  return number.toString(16).padStart(32, "0").slice(-32);
}

function scope(suffix = "a") {
  return {
    tenantId: `tenant-${suffix}`,
    principalId: `principal-${suffix}`,
    operation: "widgets.create",
  };
}

function policy(overrides = {}) {
  return {
    maxRequests: 10,
    windowMs: 100,
    maxConcurrent: 4,
    leaseMs: 20,
    idempotencyTtlMs: 200,
    maxIdempotencyEntriesPerScope: 10,
    maxSizeBytes: 100,
    ...overrides,
  };
}

function request(requestScope, key, overrides = {}) {
  return {
    scope: requestScope,
    idempotencyKey: key,
    fingerprint: `fingerprint-${key}`,
    sizeBytes: 1,
    ...overrides,
  };
}

function createHarness(admissionModule, options = {}) {
  let nowMs = options.nowMs ?? 0;
  let clockCalls = 0;
  let idCalls = 0;
  let beforeCommitCalls = 0;
  const queuedIds = [...(options.ids ?? [])];
  const clock = options.clock ?? {
    nowMs: options.asyncClock
      ? async () => {
          clockCalls += 1;
          return nowMs;
        }
      : () => {
          clockCalls += 1;
          return nowMs;
        },
  };
  const leaseIdFactory = {
    async nextLeaseId() {
      idCalls += 1;
      return queuedIds.shift() ?? hexId(idCalls);
    },
  };
  const beforeCommit = async (admissionRequest) => {
    beforeCommitCalls += 1;
    assertDeepFrozen(admissionRequest);
    if (options.beforeCommit) {
      await options.beforeCommit(admissionRequest);
    }
  };
  const adapter = admissionModule.createInMemoryAdmissionAdapter({
    clock,
    leaseIdFactory,
    beforeCommit,
  });
  return {
    adapter,
    setNow(value) {
      nowMs = value;
    },
    idCalls: () => idCalls,
    clockCalls: () => clockCalls,
    beforeCommitCalls: () => beforeCommitCalls,
  };
}

function expectDenied(decision, code) {
  assert.equal(decision.admitted, false);
  assert.equal(decision.code, code);
  assert.deepEqual(Object.keys(decision).sort(), ["admitted", "code"]);
}

function expectAdmitted(decision, replayed = false) {
  assert.equal(decision.admitted, true);
  assert.equal(decision.replayed, replayed);
  assert.ok(decision.lease);
  assert.match(decision.lease.leaseId, /^[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(decision).sort(), ["admitted", "lease", "replayed"]);
}

function expectSnapshot(snapshot, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(snapshot[key], value, `snapshot ${key}`);
  }
  assert.deepEqual(Object.keys(snapshot).sort(), [...exactMemberShapes.get("AdmissionSnapshot")].sort());
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, "returned value is not deeply frozen");
  for (const nested of Object.values(value)) {
    assertDeepFrozen(nested, seen);
  }
}

async function verifyMalformedAndSizes(admissionModule) {
  const baseScope = scope("malformed");
  const malformedCases = [
    {
      label: "undefined request",
      admissionRequest: undefined,
      admissionPolicy: policy(),
    },
    {
      label: "null request",
      admissionRequest: null,
      admissionPolicy: policy(),
    },
    {
      label: "undefined policy",
      admissionRequest: request(baseScope, "undefined-policy"),
      admissionPolicy: undefined,
    },
    {
      label: "null policy",
      admissionRequest: request(baseScope, "null-policy"),
      admissionPolicy: null,
    },
    {
      label: "missing scope",
      admissionRequest: {
        idempotencyKey: "missing-scope",
        fingerprint: "fingerprint-missing-scope",
        sizeBytes: 1,
      },
      admissionPolicy: policy(),
    },
    {
      label: "missing size",
      admissionRequest: {
        scope: baseScope,
        idempotencyKey: "missing-size",
        fingerprint: "fingerprint-missing-size",
      },
      admissionPolicy: policy(),
    },
    {
      label: "non-string idempotency key",
      admissionRequest: request(baseScope, 42),
      admissionPolicy: policy(),
    },
    {
      label: "leading scope whitespace",
      admissionRequest: request({ ...baseScope, tenantId: " tenant-malformed" }, "bad-scope"),
      admissionPolicy: policy(),
    },
    {
      label: "empty scope field",
      admissionRequest: request({ ...baseScope, principalId: "" }, "empty-scope"),
      admissionPolicy: policy(),
    },
    {
      label: "oversized scope field",
      admissionRequest: request({ ...baseScope, operation: "x".repeat(129) }, "long-scope"),
      admissionPolicy: policy(),
    },
    {
      label: "non-ASCII scope field",
      admissionRequest: request({ ...baseScope, tenantId: "tenant-é" }, "non-ascii-scope"),
      admissionPolicy: policy(),
    },
    {
      label: "empty idempotency key",
      admissionRequest: request(baseScope, ""),
      admissionPolicy: policy(),
    },
    {
      label: "trailing idempotency whitespace",
      admissionRequest: request(baseScope, "bad-key "),
      admissionPolicy: policy(),
    },
    {
      label: "control character fingerprint",
      admissionRequest: request(baseScope, "bad-fingerprint", { fingerprint: "bad\tfingerprint" }),
      admissionPolicy: policy(),
    },
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY].map(
      (sizeBytes) => ({
        label: `invalid size ${String(sizeBytes)}`,
        admissionRequest: request(baseScope, `bad-size-${String(sizeBytes)}`, { sizeBytes }),
        admissionPolicy: policy(),
      }),
    ),
    ...[
      ["maxRequests", 0],
      ["windowMs", 1.5],
      ["maxConcurrent", Number.MAX_SAFE_INTEGER + 1],
      ["leaseMs", 0],
      ["idempotencyTtlMs", 0],
      ["maxIdempotencyEntriesPerScope", -1],
      ["maxIdempotencyEntriesPerScope", 0],
      ["maxSizeBytes", -1],
    ].map(([field, value]) => ({
      label: `invalid policy ${field}`,
      admissionRequest: request(baseScope, `bad-policy-${field}`),
      admissionPolicy: policy({ [field]: value }),
    })),
    {
      label: "idempotency TTL shorter than lease",
      admissionRequest: request(baseScope, "short-ttl"),
      admissionPolicy: policy({ leaseMs: 21, idempotencyTtlMs: 20 }),
    },
  ];

  for (const malformed of malformedCases) {
    const harness = createHarness(admissionModule, { nowMs: 100 });
    const decision = await harness.adapter.admit(malformed.admissionRequest, malformed.admissionPolicy);
    expectDenied(decision, "invalid_request");
    assert.equal(harness.idCalls(), 0, malformed.label);
    expectSnapshot(harness.adapter.snapshot(baseScope), {
      policy: null,
      windowStartMs: null,
      windowCount: 0,
      activeLeaseCount: 0,
      retainedIdempotencyCount: 0,
      retainedLeaseCount: 0,
    });
  }

  const harness = createHarness(admissionModule, { nowMs: 100 });
  const zeroPolicy = policy({ maxSizeBytes: 0 });
  expectAdmitted(
    await harness.adapter.admit(request(scope("zero"), "zero", { sizeBytes: 0 }), zeroPolicy),
  );
  expectDenied(
    await harness.adapter.admit(request(scope("zero"), "too-large", { sizeBytes: 1 }), zeroPolicy),
    "size_exceeded",
  );
}

async function verifyFixedWindow(admissionModule) {
  const harness = createHarness(admissionModule, { nowMs: 100 });
  const requestScope = scope("window");
  const requestPolicy = policy({ maxRequests: 2, maxConcurrent: 4 });
  expectAdmitted(await harness.adapter.admit(request(requestScope, "one"), requestPolicy));
  expectAdmitted(await harness.adapter.admit(request(requestScope, "two"), requestPolicy));
  expectDenied(await harness.adapter.admit(request(requestScope, "three"), requestPolicy), "rate_limited");
  harness.setNow(199);
  expectDenied(await harness.adapter.admit(request(requestScope, "four"), requestPolicy), "rate_limited");
  expectSnapshot(harness.adapter.snapshot(requestScope), { windowStartMs: 100, windowCount: 2 });
  harness.setNow(200);
  expectAdmitted(await harness.adapter.admit(request(requestScope, "five"), requestPolicy));
  expectSnapshot(harness.adapter.snapshot(requestScope), { windowStartMs: 200, windowCount: 1 });
}

async function verifyReplayAndScope(admissionModule) {
  const harness = createHarness(admissionModule, { nowMs: 100 });
  const firstScope = scope("replay-a");
  const first = await harness.adapter.admit(request(firstScope, "same"), policy({ maxConcurrent: 1 }));
  expectAdmitted(first);
  const replay = await harness.adapter.admit(request(firstScope, "same"), policy({ maxConcurrent: 1 }));
  expectAdmitted(replay, true);
  assert.equal(replay.lease.leaseId, first.lease.leaseId);
  expectSnapshot(harness.adapter.snapshot(firstScope), {
    windowCount: 1,
    activeLeaseCount: 1,
    retainedIdempotencyCount: 1,
    retainedLeaseCount: 1,
  });
  expectDenied(
    await harness.adapter.admit(
      request(firstScope, "same", { fingerprint: "different-fingerprint" }),
      policy({ maxConcurrent: 1 }),
    ),
    "idempotency_conflict",
  );
  expectSnapshot(harness.adapter.snapshot(firstScope), {
    windowCount: 1,
    activeLeaseCount: 1,
    retainedIdempotencyCount: 1,
    retainedLeaseCount: 1,
  });
  const second = await harness.adapter.admit(request(scope("replay-b"), "same"), policy({ maxConcurrent: 1 }));
  expectAdmitted(second);
  assert.notEqual(second.lease.leaseId, first.lease.leaseId);
}

async function verifyPolicyAndClock(admissionModule) {
  const harness = createHarness(admissionModule, { nowMs: 100 });
  const requestScope = scope("policy");
  const policyA = policy({ maxRequests: 2 });
  const policyB = policy({ maxRequests: 3 });
  expectAdmitted(await harness.adapter.admit(request(requestScope, "a"), policyA));
  expectDenied(await harness.adapter.admit(request(requestScope, "a"), policyB), "invalid_request");
  expectSnapshot(harness.adapter.snapshot(requestScope), {
    windowCount: 1,
    retainedIdempotencyCount: 1,
    retainedLeaseCount: 1,
  });
  harness.setNow(301);
  expectAdmitted(await harness.adapter.admit(request(requestScope, "b"), policyB));

  const clockHarness = createHarness(admissionModule, { nowMs: 500 });
  const scopeA = scope("clock-a");
  const scopeB = scope("clock-b");
  const decisionA = await clockHarness.adapter.admit(request(scopeA, "a"), policy());
  expectAdmitted(decisionA);
  clockHarness.setNow(400);
  expectDenied(await clockHarness.adapter.admit(request(scopeA, "b"), policy()), "invalid_request");
  expectAdmitted(await clockHarness.adapter.admit(request(scopeB, "a"), policy()));
  assert.equal(
    (await clockHarness.adapter.release({ scope: scopeA, leaseId: decisionA.lease.leaseId })).status,
    "invalid_request",
  );
  clockHarness.setNow(450);
  expectDenied(await clockHarness.adapter.admit(request(scopeA, "c"), policy()), "invalid_request");
  assert.equal(
    (await clockHarness.adapter.release({ scope: scopeA, leaseId: decisionA.lease.leaseId })).status,
    "invalid_request",
  );
  clockHarness.setNow(500);
  assert.equal(
    (await clockHarness.adapter.release({ scope: scopeA, leaseId: decisionA.lease.leaseId })).status,
    "released",
  );
}

async function verifyFactoryAndCapacity(admissionModule) {
  const collisionId = "a".repeat(32);
  const harness = createHarness(admissionModule, { nowMs: 0, ids: [collisionId, collisionId] });
  const requestScope = scope("factory");
  const requestPolicy = policy({ maxSizeBytes: 0 });
  expectDenied(
    await harness.adapter.admit(request(requestScope, "large", { sizeBytes: 1 }), requestPolicy),
    "size_exceeded",
  );
  assert.equal(harness.idCalls(), 0);
  const first = await harness.adapter.admit(request(requestScope, "first", { sizeBytes: 0 }), requestPolicy);
  expectAdmitted(first);
  assert.equal(harness.beforeCommitCalls(), 1);
  assert.equal(
    (await harness.adapter.release({ scope: requestScope, leaseId: first.lease.leaseId })).status,
    "released",
  );
  expectDenied(
    await harness.adapter.admit(request(requestScope, "second", { sizeBytes: 0 }), requestPolicy),
    "invalid_request",
  );
  assert.equal(harness.idCalls(), 2);
  assert.equal(harness.beforeCommitCalls(), 1);
  expectSnapshot(harness.adapter.snapshot(requestScope), {
    windowCount: 1,
    activeLeaseCount: 0,
    retainedIdempotencyCount: 1,
    retainedLeaseCount: 1,
  });

  const invalidIdHarness = createHarness(admissionModule, { nowMs: 0, ids: ["NOT-A-HEX-ID"] });
  const invalidIdScope = scope("invalid-id");
  expectDenied(
    await invalidIdHarness.adapter.admit(request(invalidIdScope, "invalid-id"), policy()),
    "invalid_request",
  );
  assert.equal(invalidIdHarness.beforeCommitCalls(), 0);
  expectSnapshot(invalidIdHarness.adapter.snapshot(invalidIdScope), {
    policy: null,
    windowStartMs: null,
    windowCount: 0,
    activeLeaseCount: 0,
    retainedIdempotencyCount: 0,
    retainedLeaseCount: 0,
  });

  let rejectedBeforeCommitCalls = 0;
  const rejectedFactoryAdapter = admissionModule.createInMemoryAdmissionAdapter({
    clock: { nowMs: () => 0 },
    leaseIdFactory: {
      async nextLeaseId() {
        throw new Error("synthetic factory rejection");
      },
    },
    beforeCommit: async () => {
      rejectedBeforeCommitCalls += 1;
    },
  });
  expectDenied(
    await rejectedFactoryAdapter.admit(request(scope("rejected-id"), "rejected-id"), policy()),
    "invalid_request",
  );
  assert.equal(rejectedBeforeCommitCalls, 0);

  const defaultHookAdapter = admissionModule.createInMemoryAdmissionAdapter({
    clock: { nowMs: () => 0 },
    leaseIdFactory: { nextLeaseId: () => "b".repeat(32) },
  });
  expectAdmitted(await defaultHookAdapter.admit(request(scope("default-hook"), "default-hook"), policy()));

  const capacityHarness = createHarness(admissionModule, { nowMs: 0 });
  const capacityScope = scope("capacity");
  const capacityPolicy = policy({
    maxConcurrent: 3,
    maxIdempotencyEntriesPerScope: 2,
    leaseMs: 10,
    idempotencyTtlMs: 100,
  });
  expectAdmitted(await capacityHarness.adapter.admit(request(capacityScope, "one"), capacityPolicy));
  expectAdmitted(await capacityHarness.adapter.admit(request(capacityScope, "two"), capacityPolicy));
  expectDenied(
    await capacityHarness.adapter.admit(request(capacityScope, "denied"), capacityPolicy),
    "idempotency_capacity",
  );
  assert.equal(capacityHarness.idCalls(), 2);
  expectSnapshot(capacityHarness.adapter.snapshot(capacityScope), {
    retainedIdempotencyCount: 2,
    retainedLeaseCount: 2,
    windowCount: 2,
  });
  capacityHarness.setNow(100);
  expectAdmitted(await capacityHarness.adapter.admit(request(capacityScope, "denied"), capacityPolicy));
  expectSnapshot(capacityHarness.adapter.snapshot(capacityScope), {
    retainedIdempotencyCount: 1,
    retainedLeaseCount: 1,
    windowCount: 1,
  });
}

async function verifyRelease(admissionModule) {
  const harness = createHarness(admissionModule, { nowMs: 100 });
  const releasedScope = scope("released");
  const releasePolicy = policy({ leaseMs: 50, idempotencyTtlMs: 200 });
  const released = await harness.adapter.admit(request(releasedScope, "released"), releasePolicy);
  expectAdmitted(released);
  assert.equal(
    (await harness.adapter.release({ scope: scope("foreign"), leaseId: released.lease.leaseId })).status,
    "not_found",
  );
  expectSnapshot(harness.adapter.snapshot(scope("foreign")), {
    policy: null,
    windowStartMs: null,
    windowCount: 0,
    activeLeaseCount: 0,
    retainedIdempotencyCount: 0,
    retainedLeaseCount: 0,
  });
  harness.setNow(50);
  expectAdmitted(await harness.adapter.admit(request(scope("foreign"), "lower-clock"), releasePolicy));
  harness.setNow(100);
  expectSnapshot(harness.adapter.snapshot(releasedScope), { activeLeaseCount: 1 });
  assert.equal(
    (await harness.adapter.release({ scope: releasedScope, leaseId: released.lease.leaseId })).status,
    "released",
  );
  assert.equal(
    (await harness.adapter.release({ scope: releasedScope, leaseId: released.lease.leaseId })).status,
    "already_released",
  );
  harness.setNow(151);
  assert.equal(
    (await harness.adapter.release({ scope: releasedScope, leaseId: released.lease.leaseId })).status,
    "already_released",
  );

  const expiredScope = scope("expired");
  harness.setNow(100);
  const expired = await harness.adapter.admit(request(expiredScope, "expired"), releasePolicy);
  harness.setNow(150);
  assert.equal(
    (await harness.adapter.release({ scope: expiredScope, leaseId: expired.lease.leaseId })).status,
    "expired",
  );
  expectSnapshot(harness.adapter.snapshot(expiredScope), { activeLeaseCount: 0 });
  harness.setNow(300);
  assert.equal(
    (await harness.adapter.release({ scope: expiredScope, leaseId: expired.lease.leaseId })).status,
    "not_found",
  );
  assert.equal(
    (await harness.adapter.release({ scope: expiredScope, leaseId: "INVALID" })).status,
    "invalid_request",
  );
}

async function verifyFreeze(admissionModule) {
  const harness = createHarness(admissionModule, { nowMs: 0 });
  const originalScope = scope("freeze");
  const originalRequest = request(originalScope, "freeze");
  const originalPolicy = policy();
  const decision = await harness.adapter.admit(originalRequest, originalPolicy);
  expectAdmitted(decision);
  assert.equal(Object.isFrozen(originalRequest), false);
  assert.equal(Object.isFrozen(originalScope), false);
  assert.equal(Object.isFrozen(originalPolicy), false);
  originalScope.tenantId = "mutated-tenant";
  originalRequest.fingerprint = "mutated-fingerprint";
  originalPolicy.maxRequests = 1;
  assert.equal(decision.lease.scope.tenantId, "tenant-freeze");
  assert.equal(decision.lease.policy.maxRequests, 10);
  assertDeepFrozen(decision);
  const snapshot = harness.adapter.snapshot(scope("freeze"));
  assertDeepFrozen(snapshot);
  assert.equal(snapshot.policy.maxRequests, 10);
}

async function runBarrierRace(admissionModule, suffix, maxConcurrent, policyOverrides = {}) {
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let arrivals = 0;
  const harness = createHarness(admissionModule, {
    nowMs: 0,
    beforeCommit: async () => {
      arrivals += 1;
      await gate;
    },
  });
  const raceScope = scope(suffix);
  const racePolicy = policy({ maxConcurrent, maxRequests: 20, ...policyOverrides });
  const promises = Array.from({ length: maxConcurrent + 2 }, (_, index) =>
    harness.adapter.admit(request(raceScope, `race-${index}`), racePolicy),
  );
  for (let index = 0; index < 200; index += 1) {
    await Promise.resolve();
  }
  const arrivalsBeforeRelease = arrivals;
  releaseGate();
  const decisions = await withTimeout(Promise.all(promises), `${suffix} barrier race`);
  return {
    admitted: decisions.filter((decision) => decision.admitted).length,
    arrivalsBeforeRelease,
  };
}

async function verifySerialization(admissionModule) {
  const race = await runBarrierRace(admissionModule, "race", 2);
  assert.equal(race.arrivalsBeforeRelease, 1);
  assert.equal(race.admitted, 2);
  const rateRace = await runBarrierRace(admissionModule, "rate-race", 10, { maxRequests: 2 });
  assert.equal(rateRace.arrivalsBeforeRelease, 1);
  assert.equal(rateRace.admitted, 2);

  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let arrivals = 0;
  let gateEnabled = false;
  let nowMs = 0;
  let clockReads = 0;
  let blockNextClock = false;
  let releaseClock;
  const clockGate = new Promise((resolve) => {
    releaseClock = resolve;
  });
  const harness = createHarness(admissionModule, {
    clock: {
      async nowMs() {
        clockReads += 1;
        if (blockNextClock) {
          blockNextClock = false;
          await clockGate;
        }
        return nowMs;
      },
    },
    beforeCommit: async () => {
      if (!gateEnabled) {
        return;
      }
      arrivals += 1;
      await gate;
    },
  });
  const raceScope = scope("tail");
  const racePolicy = policy({
    maxConcurrent: 1,
    maxRequests: 10,
    windowMs: 10,
    leaseMs: 5,
    idempotencyTtlMs: 10,
  });
  const seed = await harness.adapter.admit(request(raceScope, "seed"), racePolicy);
  expectAdmitted(seed);
  assert.equal(
    (await harness.adapter.release({ scope: raceScope, leaseId: seed.lease.leaseId })).status,
    "released",
  );
  nowMs = 10;
  gateEnabled = true;
  blockNextClock = true;
  const clockCallsBeforeCleanup = clockReads;
  const first = harness.adapter.release({ scope: raceScope, leaseId: seed.lease.leaseId });
  let firstSettled = false;
  void first.then(() => {
    firstSettled = true;
  });
  const second = harness.adapter.admit(request(raceScope, "second"), racePolicy);
  for (let index = 0; index < 200; index += 1) {
    await Promise.resolve();
  }
  assert.equal(firstSettled, false, "empty-scope cleanup release bypassed its blocked clock read");
  assert.equal(
    clockReads,
    clockCallsBeforeCleanup + 1,
    "empty-scope cleanup release bypassed the serialized clock read",
  );
  releaseClock();
  assert.equal((await first).status, "not_found");
  const third = harness.adapter.admit(request(raceScope, "third"), racePolicy);
  for (let index = 0; index < 200; index += 1) {
    await Promise.resolve();
  }
  assert.notEqual(arrivals, 0, "empty-scope successor never reached beforeCommit");
  assert.equal(arrivals, 1, "empty-scope tail deletion allowed concurrent successors");
  releaseGate();
  const decisions = await withTimeout(Promise.all([second, third]), "empty-scope tail race");
  assert.equal(decisions.filter((decision) => decision.admitted).length, 1);
}

async function verifyMutants(source) {
  const serializationToken = "return enqueueScopeOperation(scopeKey, operation);";
  const serializationMutant = source.replace(serializationToken, "return operation();");
  const serializedModule = loadAdmissionModule(serializationMutant, "admission-serialization-mutant");
  const race = await runBarrierRace(serializedModule, "mutant-race", 2);
  assert.ok(race.arrivalsBeforeRelease > 1, "serialization mutant did not expose concurrent stale reads");
  assert.ok(race.admitted > 2, "serialization mutant did not oversubscribe");

  const fingerprintToken = "existing.fingerprint === request.fingerprint";
  const fingerprintMutant = source.replace(
    fingerprintToken,
    "existing.fingerprint !== request.fingerprint",
  );
  const fingerprintModule = loadAdmissionModule(fingerprintMutant, "admission-fingerprint-mutant");
  const harness = createHarness(fingerprintModule, { nowMs: 0 });
  const requestScope = scope("fingerprint-mutant");
  expectAdmitted(await harness.adapter.admit(request(requestScope, "same"), policy()));
  const conflict = await harness.adapter.admit(
    request(requestScope, "same", { fingerprint: "different" }),
    policy(),
  );
  assert.equal(conflict.admitted, true, "fingerprint mutant did not admit the mismatched fingerprint");
}

async function verifyBehavior(source) {
  const admissionModule = loadAdmissionModule(source, "admission");
  assert.equal(typeof admissionModule.createInMemoryAdmissionAdapter, "function");
  await withTimeout(verifyMalformedAndSizes(admissionModule), "malformed and size verification");
  await withTimeout(verifyFixedWindow(admissionModule), "fixed-window verification");
  await withTimeout(verifyReplayAndScope(admissionModule), "replay and scope verification");
  await withTimeout(verifyPolicyAndClock(admissionModule), "policy and clock verification");
  await withTimeout(verifyFactoryAndCapacity(admissionModule), "factory and capacity verification");
  await withTimeout(verifyRelease(admissionModule), "release verification");
  await withTimeout(verifyFreeze(admissionModule), "freeze verification");
  await withTimeout(verifySerialization(admissionModule), "serialization verification");
  await withTimeout(verifyMutants(source), "mutation verification");
}

const source = readRequired(sourcePath);
const tests = readRequired(testPath);
const index = readRequired(indexPath);
const report = reportPath ? JSON.parse(readRequired(reportPath)) : undefined;

verifyStaticContract(source, tests, index, report);
await verifyBehavior(source);

console.log("platform admission contract and independent behavioral oracle verified");

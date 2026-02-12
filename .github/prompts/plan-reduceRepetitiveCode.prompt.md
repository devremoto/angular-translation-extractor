## Plan: Reduce Repetition in JS/TS Extractor

This draft targets a safe, compatibility-first refactor only in [src/extractJsTs.ts](src/extractJsTs.ts), as requested. The goal is to remove duplicated decision logic (especially between `StringLiteral` and `TemplateLiteral` visitors) without changing extraction behavior, key generation inputs, aggressive mode semantics, or restricted-report output consumed by [src/extension.ts](src/extension.ts). I’ll keep all public function signatures stable for current callers in [src/scan.ts](src/scan.ts) and [src/extension.ts](src/extension.ts), and avoid broad cross-file moves in this pass.

**Steps**

1. Baseline current behavior contracts in [src/extractJsTs.ts](src/extractJsTs.ts): preserve gating order (ignored context → control flow → aggressive mode/regex override → restricted callback → add).
2. Extract shared literal-processing helper used by both StringLiteral and TemplateLiteral visitors, parameterized by literal kind and text resolver.
3. Consolidate duplicated restricted-item construction into one helper to keep `reason/context/loc` mapping consistent.
4. Consolidate aggressive-mode + regex-override decision invocation in one place to prevent drift between string/template paths.
5. Keep `add(...)` rawText/line/column capture unchanged; only route calls through the new helper.
6. Do a local readability cleanup (small helpers near usage, remove any new dead locals) while preserving existing exports and call signatures.
7. Run regression checks focused on extractor behavior and compile safety.

**Verification**

- Run `npm run check-types`.
- Run behavior scripts:
  - [src/test/test-aggressive-mode.ts](src/test/test-aggressive-mode.ts)
  - [src/test/test-extraction.ts](src/test/test-extraction.ts)
  - [src/test/test-confirm.ts](src/test/test-confirm.ts)
  - [src/test/test-non-component.ts](src/test/test-non-component.ts)

**Decisions**

- Scope fixed to focused refactor in [src/extractJsTs.ts](src/extractJsTs.ts) only.
- No cross-file utility extraction in this phase to minimize risk.
- Compatibility priority over structural ambition (same inputs/outputs, same report semantics).

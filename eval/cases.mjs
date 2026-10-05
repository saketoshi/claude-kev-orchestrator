export const developmentCases = [
  { id: "h01", expectedModel: "haiku", description: "Add a null check to one mapper and add the matching unit test." },
  { id: "h02", expectedModel: "haiku", description: "Rename UserStatus.ACTIVE to ENABLED in one enum and its direct tests." },
  { id: "h03", expectedModel: "haiku", description: "Implement one email-format validator from explicit acceptance examples." },
  { id: "h04", expectedModel: "haiku", description: "Add one serialization field to an existing DTO using the established pattern." },
  { id: "h05", expectedModel: "haiku", description: "Fix one off-by-one error in pagination with a regression test." },
  { id: "h06", expectedModel: "haiku", description: "Update seven call sites to the already-decided method name; no behavior change." },
  { id: "h07", expectedModel: "haiku", description: "Add one simple migration that creates an index exactly as specified." },
  { id: "h08", expectedModel: "haiku", description: "Add one value to an enum and update exhaustive switch handling." },
  { id: "h09", expectedModel: "haiku", description: "長い仕様書どおりに既存の1つのバリデータへ条件を1つ追加し、テストを追加する。設計変更はない。" },
  { id: "h10", expectedModel: "haiku", description: "Replace one deprecated helper with its documented drop-in replacement in a local module." },

  { id: "s01", expectedModel: "sonnet", description: "Implement an already-designed user-profile feature across controller, service, repository and tests." },
  { id: "s02", expectedModel: "sonnet", description: "Wire an existing domain service into three API endpoints following the current project pattern." },
  { id: "s03", expectedModel: "sonnet", description: "Add a decided cache key scheme across service, adapter and integration tests." },
  { id: "s04", expectedModel: "sonnet", description: "Implement a specified CSV export across query, formatter and endpoint; schema is fixed." },
  { id: "s05", expectedModel: "sonnet", description: "Apply an already-approved validation rule across request types and update tests in several files." },
  { id: "s06", expectedModel: "sonnet", description: "Add an existing authorization check to five handlers using the established helper and policy." },
  { id: "s07", expectedModel: "sonnet", description: "Refactor duplicate persistence mapping into a shared helper without changing public contracts." },
  { id: "s08", expectedModel: "sonnet", description: "Implement an agreed retry policy in the client, service and tests; algorithm and limits are specified." },
  { id: "s09", expectedModel: "sonnet", description: "設計済みの通知設定機能をAPI・サービス・永続化・テストの複数ファイルに実装する。" },
  { id: "s10", expectedModel: "sonnet", description: "Move an existing feature flag check to the shared adapter and update all dependent tests." },

  { id: "o01", expectedModel: "opus", description: "Investigate a double-charge that happens roughly once every 5000 requests; root cause is unknown." },
  { id: "o02", expectedModel: "opus", description: "Diagnose and fix a race condition in cache invalidation under concurrent writes." },
  { id: "o03", expectedModel: "opus", description: "Investigate a performance regression after an ORM upgrade; the bottleneck is not known." },
  { id: "o04", expectedModel: "opus", description: "Perform threat modelling for the file-upload path and design required mitigations." },
  { id: "o05", expectedModel: "opus", description: "Choose an architecture for tenant isolation across API, storage and background jobs." },
  { id: "o06", expectedModel: "opus", description: "Design a backward-compatible migration for a high-volume table with zero-downtime constraints." },
  { id: "o07", expectedModel: "opus", description: "Find the cause of intermittent stale reads spanning transaction boundaries and replicas." },
  { id: "o08", expectedModel: "opus", description: "Design a cross-cutting idempotency strategy for commands, retries and external callbacks." },
  { id: "o09", expectedModel: "opus", description: "原因不明で稀に認可が抜ける問題を調査し、再現条件・根本原因・安全な修正方針を決める。" },
  { id: "o10", expectedModel: "opus", description: "Rework a public event schema while preserving compatibility across producers and consumers." },

  { id: "x01", expectedModel: "opus", expectedSplit: true, description: "Rebuild the reporting feature: redesign data model, migrate old reports, replace UI API, optimize slow queries and add tests." },
  { id: "x02", expectedModel: "opus", expectedSplit: true, description: "Modernize authentication: choose token strategy, migrate sessions, update every client, add audit events and revise deployment." },
]

export const holdoutCases = [
  { id: "hh01", expectedModel: "haiku", description: "Add one explicit HTTP status mapping and one unit test to an existing error mapper." },
  { id: "hh02", expectedModel: "haiku", description: "Rename a configuration key in the seven known references; compatibility alias already exists." },
  { id: "hh03", expectedModel: "haiku", description: "Add one documented enum member and its display label." },
  { id: "hh04", expectedModel: "haiku", description: "既存パターンどおりに単一DTOへフィールドを追加してシリアライズテストを更新する。" },

  { id: "hs01", expectedModel: "sonnet", description: "Implement a fixed audit-log requirement across service, repository, endpoint and integration tests." },
  { id: "hs02", expectedModel: "sonnet", description: "Apply an approved pagination contract across three list endpoints and shared client types." },
  { id: "hs03", expectedModel: "sonnet", description: "Integrate an existing formatter into several export paths; design and output schema are settled." },
  { id: "hs04", expectedModel: "sonnet", description: "設計済みの権限チェックを複数APIとテストへ横展開する。新しい認可設計は不要。" },

  { id: "ho01", expectedModel: "opus", description: "Investigate a memory leak in a long-running worker where the retaining object is unknown." },
  { id: "ho02", expectedModel: "opus", description: "Explain and fix rare duplicate event delivery despite existing idempotency checks." },
  { id: "ho03", expectedModel: "opus", description: "Design a safe multi-stage migration from synchronous jobs to an event-driven pipeline." },
  { id: "ho04", expectedModel: "opus", description: "Threat-model a new OAuth callback flow and determine the required state, nonce and redirect protections." },
]

export const casesFor = (name) =>
  name === "holdout" ? holdoutCases : developmentCases

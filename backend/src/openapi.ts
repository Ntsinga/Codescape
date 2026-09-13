/**
 * Hand-authored OpenAPI 3 spec for the Codescape API, served interactively at
 * /api/docs (Swagger UI) and as raw JSON at /api/openapi.json.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Codescape API",
    version: "0.1.0",
    description:
      "Codescape turns a codebase into a navigable system model. Upload a repo (or import from GitHub), " +
      "then explore its graph, conceptual map, and source. All durable state lives in Postgres.",
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "Repositories", description: "Upload, list, and inspect repositories" },
    { name: "Graph", description: "The parsed node/edge graph" },
    { name: "Semantic", description: "The conceptual map and tech stack" },
    { name: "AI", description: "Provider/model selection and AI explanations" },
    { name: "GitHub", description: "OAuth connect and repository import" },
    { name: "System", description: "Health and service info" },
  ],
  paths: {
    "/api/health": {
      get: { tags: ["System"], summary: "Health check", responses: { "200": { description: "Service is up", content: jsonExample({ ok: true }) } } },
    },
    "/api/repos": {
      get: {
        tags: ["Repositories"],
        summary: "List all analyzed repositories",
        responses: { "200": { description: "Array of repositories", content: refArray("Repo") } },
      },
      post: {
        tags: ["Repositories"],
        summary: "Upload a repository ZIP for analysis",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { archive: { type: "string", format: "binary", description: ".zip archive" }, name: { type: "string" } },
                required: ["archive"],
              },
            },
          },
        },
        responses: { "201": { description: "Processed", content: jsonExample({ repoId: "abc123", fileCount: 42, symbolCount: 310 }) }, "422": errRef() },
      },
    },
    "/api/repos/{id}": {
      get: {
        tags: ["Repositories"],
        summary: "Get a single repository",
        parameters: [pathId()],
        responses: { "200": { description: "Repository", content: ref("Repo") }, "404": errRef() },
      },
    },
    "/api/repos/{id}/graph": {
      get: {
        tags: ["Graph"],
        summary: "Full node/edge graph for a repository",
        parameters: [pathId()],
        responses: { "200": { description: "Graph", content: jsonExample({ nodes: [], edges: [] }) }, "409": errRef() },
      },
    },
    "/api/repos/{id}/search": {
      get: {
        tags: ["Graph"],
        summary: "Search nodes by name",
        parameters: [pathId(), { name: "q", in: "query", schema: { type: "string" }, description: "Search term" }],
        responses: { "200": { description: "Matching nodes", content: refArray("Node") } },
      },
    },
    "/api/repos/{id}/nodes/{nodeId}/impact": {
      get: {
        tags: ["Graph"],
        summary: "Downstream dependents of a node (impact analysis)",
        parameters: [pathId(), { name: "nodeId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Impacted nodes with depth", content: jsonExample({ node: {}, impacted: [] }) } },
      },
    },
    "/api/repos/{id}/semantic": {
      get: {
        tags: ["Semantic"],
        summary: "Conceptual map (System → Concept → Group → File → Function)",
        parameters: [pathId()],
        responses: { "200": { description: "Semantic tree", content: jsonExample({ nodes: [], aiEnriched: false }) } },
      },
    },
    "/api/repos/{id}/decompose": {
      post: {
        tags: ["Semantic"],
        summary: "Rebuild the conceptual map (optionally AI-enriched)",
        parameters: [pathId(), { name: "enrich", in: "query", schema: { type: "boolean", default: true }, description: "Run the AI naming pass" }],
        responses: { "200": { description: "Rebuilt tree", content: jsonExample({ nodes: [], aiEnriched: true }) } },
      },
    },
    "/api/repos/{id}/stack": {
      get: {
        tags: ["Semantic"],
        summary: "Detected languages and frameworks",
        parameters: [pathId()],
        responses: { "200": { description: "Tech stack", content: jsonExample({ languages: [{ name: "TypeScript", files: 20 }], frameworks: [{ name: "React", source: "package.json" }] }) } },
      },
    },
    "/api/repos/{id}/source": {
      get: {
        tags: ["Repositories"],
        summary: "Fetch a source file's contents",
        parameters: [pathId(), { name: "path", in: "query", required: true, schema: { type: "string" }, description: "Repo-relative file path" }],
        responses: { "200": { description: "File content", content: jsonExample({ path: "src/app.ts", content: "…" }) }, "403": errRef(), "404": errRef() },
      },
    },
    "/api/repos/{id}/nodes/{nodeId}/explain": {
      post: {
        tags: ["AI"],
        summary: "AI explanation of a class/function, with source evidence",
        parameters: [pathId(), { name: "nodeId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Explanation", content: jsonExample({ explanation: "…", evidence: [] }) }, "502": errRef() },
      },
    },
    "/api/ai/models": {
      get: {
        tags: ["AI"],
        summary: "List available providers and their models",
        responses: { "200": { description: "Models", content: jsonExample({ providers: ["openai", "gemini", "deepseek"], models: {}, current: { provider: "gemini", model: "gemini-3.6-flash" } }) } },
      },
    },
    "/api/ai/select": {
      post: {
        tags: ["AI"],
        summary: "Set the active AI provider + model",
        requestBody: { required: true, content: jsonExample({ provider: "gemini", model: "gemini-3.6-flash" }) },
        responses: { "200": { description: "Updated selection", content: jsonExample({ current: { provider: "gemini", model: "gemini-3.6-flash" } }) }, "400": errRef() },
      },
    },
    "/api/github/connect": {
      get: { tags: ["GitHub"], summary: "Begin GitHub OAuth (redirects to GitHub)", responses: { "302": { description: "Redirect to GitHub authorize" } } },
    },
    "/api/github/repos": {
      get: {
        tags: ["GitHub"],
        summary: "List the connected account's repositories",
        parameters: [{ name: "connection", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Repositories", content: refArray("GitHubRepo") }, "401": errRef() },
      },
    },
    "/api/github/import": {
      post: {
        tags: ["GitHub"],
        summary: "Import a repository from the connected account",
        parameters: [{ name: "connection", in: "query", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: jsonExample({ owner: "Ntsinga", repo: "Codescape", branch: "main" }) },
        responses: { "201": { description: "Imported", content: jsonExample({ repoId: "abc123", fileCount: 42, symbolCount: 310 }) } },
      },
    },
  },
  components: {
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      Repo: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          createdAt: { type: "string" },
          status: { type: "string", enum: ["processing", "ready", "failed"] },
          error: { type: "string", nullable: true },
          origin: { type: "object", properties: { kind: { type: "string", nullable: true }, owner: { type: "string", nullable: true }, repo: { type: "string", nullable: true }, branch: { type: "string", nullable: true } } },
        },
      },
      Node: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          name: { type: "string" },
          filePath: { type: "string", nullable: true },
          startLine: { type: "integer", nullable: true },
          endLine: { type: "integer", nullable: true },
        },
      },
      GitHubRepo: {
        type: "object",
        properties: { id: { type: "integer" }, name: { type: "string" }, fullName: { type: "string" }, private: { type: "boolean" }, defaultBranch: { type: "string" } },
      },
    },
  },
} as const;

// ---- tiny helpers to keep the spec readable ----
function pathId() {
  return { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Repository id" };
}
function ref(name: string) {
  return { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } };
}
function refArray(name: string) {
  return { "application/json": { schema: { type: "array", items: { $ref: `#/components/schemas/${name}` } } } };
}
function errRef() {
  return { description: "Error", content: ref("Error") };
}
function jsonExample(example: unknown) {
  return { "application/json": { schema: { type: "object" }, example } };
}

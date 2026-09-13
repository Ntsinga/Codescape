# Interactive AI Codebase Model

## Product Vision

Build a platform that transforms any software codebase into a **living, explorable system model**.

A user uploads a ZIP file or connects a GitHub or GitLab repository. The platform analyses the codebase, identifies its structure and behaviour, and generates a multi-level interactive representation that can be explored from the highest product level down to individual functions and source lines.

The system combines:

- Deterministic code analysis
- AI-assisted architectural reasoning
- Interactive diagrams
- Three-dimensional navigation
- Source-linked explanations
- Search and impact analysis

The goal is not simply to display files in 3D. The goal is to help users understand how an unfamiliar software system works.

> **Upload a codebase and explore it as an AI-generated, multi-level system model—from product behaviour down to individual functions and source code.**

---

## Core Product Principle

The product should represent a codebase through multiple levels of abstraction.

A user should be able to move through the following path:

```text
Application
  → System architecture
    → Business domain
      → Feature or process
        → Service or component
          → Class or function
            → Source code
```

Each level should answer a different question:

| Level | Primary question |
|---|---|
| Product | What does this application do? |
| Architecture | What systems and technologies make it work? |
| Domain | What business capabilities does it contain? |
| Process | How does a specific workflow operate? |
| Component | Which technical parts implement the workflow? |
| Function | What does this specific unit of code do? |
| Source | Where is the behaviour implemented? |

The interface should progressively reveal detail instead of showing the entire codebase at once.

---

# User Experience

## 1. Upload or Connect a Codebase

The user starts by either:

- Uploading a ZIP file
- Connecting a GitHub repository
- Connecting a GitLab repository
- Selecting a branch or commit

The platform should then:

1. Securely extract or clone the repository.
2. Detect programming languages and frameworks.
3. Ignore binaries, generated files, dependencies and build output.
4. Parse source code into a common structural model.
5. Identify architectural boundaries and business domains.
6. Generate relevant diagrams and explanations.
7. Open the interactive system explorer.

---

## 2. Explore Through Semantic Zoom

The interface should use **controlled semantic zoom**, not unrestricted movement through empty 3D space.

Users should be able to:

- Scroll forward to enter a selected component
- Scroll backwards to return to its parent
- Click a node to focus on it
- Search for any file, class, function, endpoint or table
- Use breadcrumbs to understand the current level
- Use a minimap to see their position within the codebase
- Filter relationships by type
- Switch between 3D, 2D and source-code views

A typical navigation path might be:

```text
Application
  → Backend
    → Reconciliation domain
      → Reconciliation service
        → match_transactions()
          → Source lines 108–163
```

The experience should feel closer to Google Earth than a game. As the user zooms in, the representation changes to match the level of detail.

---

# Levels of Abstraction

## Level 1: Product View

The product view explains the application in terms of user-facing capabilities.

It may contain:

- Generated or reconstructed screen mock-ups
- Main user roles
- Product capabilities
- User journeys
- External systems
- A plain-language product summary

For a business operations platform, this level might show:

- Dashboard
- Transaction recording
- Reconciliation
- Commission calculation
- Expense management
- Reporting
- Third-party integrations

### Mock-up Confidence

Automatically generated mock-ups must clearly distinguish between:

- **Detected screens** — reconstructed from actual frontend code
- **Inferred screens** — generated from routes, APIs or business logic
- **Missing screens** — backend functionality with no detected frontend interface

This distinction is important because AI-generated interfaces can appear convincing even when they are not present in the actual product.

---

## Level 2: System Architecture

This level explains how the application is divided into major systems.

It may show:

- Web applications
- Mobile applications
- Backend services
- Databases
- Authentication providers
- Message queues
- Background workers
- File storage
- External APIs
- Deployment infrastructure

Example:

```text
Mobile Application
       ↓
FastAPI Backend
       ↓
PostgreSQL

FastAPI Backend → Clerk
FastAPI Backend → Firebase
FastAPI Backend → Background Worker
```

In the 3D environment, these systems can be represented as large regions, zones or islands rather than a collection of random floating nodes.

---

## Level 3: Domain and Module Map

This level reorganises the codebase around meaningful business capabilities.

Possible domains include:

- Authentication
- Users
- Transactions
- Accounts
- Reconciliation
- Commissions
- Expenses
- Reporting
- Notifications

This level is more useful than immediately displaying folders.

A codebase may be organised technically like this:

```text
controllers/
services/
repositories/
models/
```

That structure describes implementation layers but does not reveal where a business capability begins and ends.

The platform should therefore support two views:

1. **Repository structure** — the actual folder and file hierarchy
2. **Domain structure** — AI-assisted grouping by business responsibility

The domain view must not change the repository. It should be a separate interpretation layer built on top of the source code.

---

## Level 4: Process and Data Views

When a user opens a business domain or feature, the platform should generate only the diagrams justified by the codebase.

### Entity Relationship Diagram

Useful when the feature contains persistent data.

The ERD should show:

- Tables or entities
- Fields
- Primary keys
- Foreign keys
- Cardinality
- Relationships
- Source models and migrations
- Services that read or write each entity

### Process Flow

Useful for business workflows.

Example:

```text
Transaction entered
        ↓
Balance updated
        ↓
Transaction matched
        ↓
Commission calculated
        ↓
Daily reconciliation completed
```

### Sequence Diagram

Useful for runtime interactions.

Example:

```text
Mobile app → API → Service → Repository → Database
```

The sequence can also include external services:

```text
API → Authentication provider
API → Notification service
API → Payment provider
```

### State Machine

Useful when an entity moves through defined statuses.

Example:

```text
Draft → Submitted → Approved
                  ↘ Rejected
```

### API Map

Useful for systems with web or mobile clients.

The API map should include:

- Endpoint
- HTTP method
- Request schema
- Response schema
- Authentication requirements
- Frontend callers
- Services called
- Database entities affected

### Event Map

Useful for event-driven systems.

The event map should show:

- Event publishers
- Event subscribers
- Background jobs
- Webhooks
- Queues
- Notification handlers

The system should not generate every diagram for every repository. It should first determine which diagram types are supported by evidence in the code.

---

## Level 5: Component and Dependency View

This level shows how a specific module or feature is implemented.

It may contain:

- Controllers
- Services
- Repositories
- UI components
- Hooks
- Models
- Validators
- Tests
- Background jobs
- External dependencies

Example:

```text
TransactionController
        ↓
TransactionService
        ↓
TransactionRepository
        ↓
PostgreSQL
```

Selecting a connection should explain exactly why it exists.

Example:

> `TransactionController.create_transaction()` calls `TransactionService.record_transaction()` on line 86.

Users should be able to filter relationships by type:

- Calls
- Imports
- Reads
- Writes
- Publishes
- Subscribes
- Inherits
- Implements
- Renders
- Tests

Without filtering and hierarchical grouping, a real codebase would quickly become an unreadable network.

---

## Level 6: Class and Function View

At this level, the user selects a class, method or function.

The system should explain:

- Purpose
- Inputs
- Outputs
- Callers
- Functions called
- Exceptions
- Side effects
- Database access
- External requests
- Related tests
- Complexity
- Security concerns
- Performance concerns

Example function:

```text
calculate_commission(transaction)
```

Example explanation:

> Calculates commission for a transaction using the provider, transaction type and configured rate. It reads the relevant commission configuration and stores the calculated result. It is called after transaction creation and during bulk recalculation.

Every explanation should link back to the exact code that supports it.

---

## Level 7: Source Code

The deepest level opens the actual source file.

It should provide:

- Syntax highlighting
- Relevant lines selected
- Incoming references
- Outgoing references
- AI explanation
- Git history
- Related issues or pull requests
- Test coverage
- Suggested changes

At this level, the 3D environment should become secondary.

> **Use 3D for spatial understanding, not for reading code.**

Source code is generally easier to inspect in a conventional editor-style interface.

---

# Diagram Selection Strategy

The platform should select diagrams based on the evidence found in the codebase.

| Detected evidence | Recommended representation |
|---|---|
| Frontend routes and components | Screen map or UI flow |
| API routes and services | API map or sequence diagram |
| ORM models and migrations | ERD |
| Status fields and transitions | State machine |
| Events, queues or webhooks | Event map |
| Repeated multi-step business logic | Process flow |
| Service, repository and controller layers | Component diagram |
| Package and module dependencies | Dependency graph |
| Deployment and infrastructure configuration | Deployment diagram |

The system should display confidence and evidence for every generated diagram.

---

# Technical Foundation

## Deterministic Analysis First

The AI must not be the primary code parser.

The platform should use deterministic analysis tools to establish facts, then use AI to explain, classify and organise those facts.

### Possible Parsing Technologies

Depending on the language:

- Tree-sitter
- TypeScript Compiler API
- Roslyn for C#
- Python `ast`
- JavaParser or Spoon
- Go parser packages
- Language Server Protocol data
- Framework-specific route and schema extraction
- Git metadata

The deterministic layer should extract:

- Symbols
- Imports
- Function and method calls
- Types
- Routes
- Models
- Database relationships
- Configuration
- Tests
- Entry points
- Background jobs
- Events
- External integrations

---

## AI Reasoning Layer

The AI should perform higher-level tasks that static analysis alone cannot reliably solve.

These may include:

- Naming business domains
- Explaining components
- Grouping related files
- Inferring user journeys
- Identifying architectural patterns
- Describing process flows
- Generating diagram labels
- Answering questions about the codebase
- Summarising technical debt
- Explaining likely impact areas

Every AI-generated conclusion should preserve links to supporting evidence.

Example:

```json
{
  "claim": "This module performs transaction reconciliation",
  "confidence": 0.91,
  "evidence": [
    "services/reconciliation.py:42-130",
    "models/reconciliation.py:1-78",
    "routes/reconciliation.py:20-92"
  ]
}
```

---

# Common Intermediate Code Graph

The visualisation should not be generated directly from raw source files.

The repository should first be transformed into a common graph model.

## Node Types

- Repository
- Application
- Service
- Domain
- Folder
- File
- Class
- Interface
- Function
- API endpoint
- Database entity
- UI screen
- UI component
- External integration
- Background job
- Event
- Test
- Deployment resource

## Edge Types

- Contains
- Imports
- Calls
- Reads
- Writes
- Exposes
- Implements
- Inherits
- Publishes
- Subscribes
- Renders
- Tests
- Deploys
- Depends on
- Configures

This graph becomes the central product model.

Three.js should be only one renderer over the graph.

Other views can include:

- 3D system explorer
- 2D architecture diagrams
- ERD view
- Sequence diagram
- File explorer
- Search results
- AI chat
- Dependency table
- Impact analysis view

Separating the analysis graph from the visual layer prevents the product from becoming locked into a single 3D representation.

---

# Repository Processing Pipeline

```text
ZIP uploaded or repository connected
              ↓
Secure extraction or cloning
              ↓
Language and framework detection
              ↓
Ignore dependencies, binaries and generated files
              ↓
Parse source code and configuration
              ↓
Extract symbols and relationships
              ↓
Build common code graph
              ↓
Detect architecture and domain clusters
              ↓
Generate AI explanations and confidence scores
              ↓
Generate supported diagram models
              ↓
Render the interactive environment
```

---

# Security Requirements

Uploaded repositories must be treated as untrusted input.

The platform should:

- Never execute uploaded code by default
- Extract archives inside an isolated sandbox
- Prevent ZIP path traversal
- Enforce repository and file-size limits
- Ignore binaries and generated files
- Detect secrets and credentials
- Avoid sending `.env` files or secrets to an LLM
- Redact sensitive values before analysis
- Process files in batches rather than sending an entire repository in one prompt
- Allow users to delete all stored code and derived data
- Support private deployment or local analysis for sensitive repositories
- Encrypt code and derived graph data at rest
- Maintain clear data-retention policies

Optional future security modes could include:

1. Cloud analysis
2. Private cloud deployment
3. On-premises deployment
4. Local desktop analysis

---

# Main Technical Challenges

## 1. Accurate Call Graphs

Dynamic language features make call tracing difficult.

Examples include:

- Dependency injection
- Reflection
- Decorators
- Runtime imports
- Metaprogramming
- Dynamic dispatch
- Framework routing
- ORM-generated behaviour

The platform should label relationships as:

- **Statically confirmed**
- **Framework-derived**
- **AI-inferred**
- **Runtime-observed**

This prevents inferred behaviour from being presented as absolute fact.

---

## 2. Large Repositories

A medium or large repository may contain:

- Thousands of files
- Tens of thousands of functions
- Hundreds of thousands of relationships

Rendering every node and edge at once will not work.

The platform will need:

- Hierarchical clustering
- Progressive loading
- Level-of-detail rendering
- Edge aggregation
- Relationship filtering
- Search-driven navigation
- Server-side graph queries
- Caching of generated views

---

## 3. Diagram Accuracy

AI can generate plausible but incorrect workflows.

Every diagram element should indicate whether it was:

- Directly detected
- Derived from framework conventions
- Inferred from code structure
- Inferred from naming
- Confirmed through runtime observation

Diagrams should also expose their supporting files and code lines.

---

## 4. Mock-up Generation

Frontend reconstruction is possible when a real frontend exists.

Mock-ups generated from backend capabilities alone are speculative.

The system must avoid presenting an imagined interface as an existing product screen.

---

## 5. Keeping the Model Updated

The visual model becomes stale when the repository changes.

The long-term system should support incremental analysis.

```text
Commit pushed
    ↓
Changed files identified
    ↓
Affected graph nodes re-parsed
    ↓
Relationships updated
    ↓
Diagrams regenerated
    ↓
Architectural changes highlighted
```

This will eventually make the platform a living architecture model rather than a one-time documentation generator.

---

# Suggested System Architecture

## Frontend

Possible stack:

- React
- TypeScript
- Three.js
- React Three Fiber
- Zustand or Redux Toolkit
- Monaco Editor
- Cytoscape.js, D3.js or ELK for 2D graph layouts
- Mermaid or PlantUML-compatible diagram export

The frontend should support:

- 3D system navigation
- 2D diagram views
- Source browsing
- Search
- Filtering
- Breadcrumbs
- AI chat
- Evidence panels

## Backend

Possible stack:

- FastAPI or ASP.NET Core
- PostgreSQL
- Graph database or graph extension where justified
- Object storage for uploaded repositories
- Background job system
- Redis for job state and caching

Backend services may include:

- Upload service
- Repository ingestion service
- Language detection service
- Parser workers
- Graph construction service
- AI reasoning service
- Diagram generation service
- Search service
- Incremental update service

## Graph Storage

Initial versions can store the graph in PostgreSQL using:

- Relational node and edge tables
- JSONB metadata
- Recursive queries
- PostgreSQL full-text search
- `pgvector` for semantic search

A dedicated graph database should only be introduced when real query complexity justifies the operational cost.

---

# Realistic MVP

The first version should not attempt to support every language, diagram or architectural pattern.

## Recommended Initial Stack Support

Start with one or two common full-stack combinations, such as:

- React or React Native
- TypeScript
- Python FastAPI or C# ASP.NET Core
- PostgreSQL

## MVP Capabilities

1. ZIP upload
2. Repository structure detection
3. Language and framework detection
4. Symbol extraction
5. Import relationships
6. Basic function and method calls
7. API endpoint extraction
8. Database model extraction
9. AI-assisted module grouping
10. System architecture view
11. Domain or module view
12. File, class and function view
13. Architecture diagram
14. ERD
15. AI question answering with source references
16. Conventional source-code viewer
17. Search and relationship filtering

## Features to Delay

- Automatic UI mock-up generation
- Runtime code execution
- Support for every language
- Complex monorepos
- Full process-flow generation
- Real-time collaboration
- Automatic code modification
- Virtual reality support
- Advanced deployment reconstruction
- Continuous repository synchronisation

---

# Suggested Development Phases

## Phase 1: Repository Understanding Engine

Build the non-visual foundation.

Deliverables:

- Secure ZIP ingestion
- Language and framework detection
- File classification
- Symbol extraction
- Initial node and edge schema
- Repository search
- Source references

Success criterion:

> The system can accurately describe the structure of a supported repository without using 3D.

---

## Phase 2: Code Graph and Evidence Model

Deliverables:

- Common code graph
- Import and call relationships
- API route detection
- ORM model detection
- Confidence classifications
- Evidence links
- Graph query API

Success criterion:

> Every major explanation can be traced to files, symbols and lines of code.

---

## Phase 3: AI-Assisted Domain Modelling

Deliverables:

- Domain detection
- Business capability summaries
- Component explanations
- Architectural pattern detection
- AI question answering
- Evidence-backed responses

Success criterion:

> A new developer can understand the codebase’s main business areas without manually reading its entire folder structure.

---

## Phase 4: Two-Dimensional Visualisation

Build the useful diagrams before the 3D environment.

Deliverables:

- Architecture diagram
- Domain map
- ERD
- Component dependency view
- Search and filters
- Source panel

Success criterion:

> Users can navigate from a high-level system view to a source file through reliable 2D models.

---

## Phase 5: Three-Dimensional Semantic Explorer

Deliverables:

- Three.js or React Three Fiber scene
- Hierarchical regions
- Semantic zoom
- Level-of-detail rendering
- Breadcrumb navigation
- Minimap
- Focus and filtering controls
- Smooth transition to source view

Success criterion:

> The 3D interface makes large-system navigation easier than the 2D view rather than simply looking impressive.

---

## Phase 6: Impact Analysis

Deliverables:

- Upstream and downstream dependency tracing
- Change impact queries
- Affected endpoints, screens, tables and tests
- Visual impact isolation
- Risk scoring

Example query:

> Show me everything affected if I change how commissions are calculated.

The system should highlight:

- The target function
- Callers
- APIs
- Database tables
- UI screens
- Reports
- Background jobs
- Tests

Success criterion:

> The platform helps developers plan and review changes, not just understand static architecture.

---

## Phase 7: Continuous Repository Intelligence

Deliverables:

- GitHub and GitLab integration
- Branch and commit comparison
- Incremental graph updates
- Architecture change history
- Pull-request impact summaries
- Stale documentation detection

Success criterion:

> The model remains useful after the initial repository upload.

---

# Commercial Use Cases

## Developer Onboarding

Help new engineers understand an unfamiliar system faster.

## Architecture Review

Expose coupling, duplicated responsibilities and unclear boundaries.

## Change Planning

Show which parts of the system may be affected before a feature is modified.

## Incident Investigation

Trace an error from an endpoint through services, data stores and external integrations.

## Legacy-System Documentation

Generate an evidence-backed model for systems with little or outdated documentation.

## Technical Due Diligence

Help engineering leaders and investors understand the structure, risks and maturity of a software product.

## Cross-Team Communication

Give product managers, designers, engineers and executives different levels of the same system model.

## Security Review

Trace authentication, authorisation, data access and external network calls.

---

# Product Positioning

Weak positioning:

> View your codebase in 3D.

This is visually appealing but may be perceived as a novelty.

Stronger positioning:

> **A living, explorable model of a software system that stays connected to the source code.**

Alternative product statement:

> **Understand any codebase from product behaviour to source code through AI-generated, evidence-backed system models.**

The 3D interface should support the product’s value, not define it.

The durable value lies in:

- Faster onboarding
- Better architectural understanding
- Dependency discovery
- Change-impact analysis
- Living documentation
- Incident investigation
- Safer refactoring
- Communication across technical and non-technical teams

---

# Product Principles

1. **Evidence before inference**  
   Static analysis establishes facts. AI explains and organises them.

2. **Progressive disclosure**  
   Show only the level of detail the user currently needs.

3. **3D must improve understanding**  
   Do not use 3D where a list, table, diagram or editor is clearer.

4. **Every explanation must be traceable**  
   Users should be able to inspect the code supporting each claim.

5. **Do not present inference as fact**  
   Label confidence and evidence sources clearly.

6. **The graph is the product foundation**  
   Visualisations are different views of the same code model.

7. **Support questions, not just exploration**  
   Users should be able to ask practical questions about architecture and impact.

8. **Design for large systems from the beginning**  
   Clustering, filtering and progressive loading are essential.

9. **Never execute uploaded code by default**  
   Code analysis must remain isolated and secure.

10. **Keep the model alive**  
    Long-term value depends on remaining synchronised with the repository.

---

# Long-Term Vision

The long-term platform becomes an intelligent operating layer for software understanding.

A developer could ask:

- Where is authentication implemented?
- What happens after a transaction is submitted?
- Which services write to this table?
- Why does this endpoint exist?
- Which frontend screens depend on this API?
- What will break if this function changes?
- Which module has the highest coupling?
- Which workflows lack tests?
- Where is sensitive customer data accessed?
- How has the architecture changed over the last six months?

The platform would answer by combining:

- Graph traversal
- Static analysis
- Framework knowledge
- Git history
- AI reasoning
- Interactive visual isolation
- Direct source-code evidence

The final product is not just a visual code explorer.

It is a **living, evidence-backed model of a software system** that helps people understand, explain, review and safely change complex codebases.

// System-design knowledge base for the System City tutor. Concise, self-authored
// concept notes (common-knowledge definitions in our own words → license-clean;
// the primer/ByteByteGo etc. are cited as "learn more", never copied). One chunk
// per concept, ~2-3 sentences, so retrieval returns a self-contained fact the
// small on-device model can ground on. Embedded with the same MiniLM extractor
// as rag.ts (shared model, cached) → cosine top-k. Mirrors rag.ts exactly.
import { cosine, embedTexts } from "./rag";

export const SYS_CHUNKS: string[] = [
  // —— foundations ——
  "Fundamentals — client-server: a client sends a request, a server does work and sends a response. Most web systems add a middle tier (app servers) between the client and the database so logic and storage scale independently.",
  "Fundamentals — latency vs throughput: latency is how long one request takes (ms); throughput is how many requests you handle per second (QPS). You can improve one without the other; a design has a budget for both.",
  "Fundamentals — availability & the nines: 99.9% ('three nines') is ~8.7 hours of downtime a year; 99.99% is ~52 minutes. Each extra nine is far more expensive, so pick a target that matches the product, not the maximum.",
  "Fundamentals — vertical vs horizontal scaling: vertical means a bigger machine (simple, but a hard ceiling and a single point of failure); horizontal means more machines behind a load balancer (harder, but scales far and survives node loss). Large systems scale horizontally.",
  "Fundamentals — stateless services: keep no per-user state on the server between requests (put it in a database or cache instead). Stateless servers are interchangeable, so any replica can handle any request and you can add/remove them freely.",
  "Fundamentals — back-of-the-envelope estimation: before designing, estimate scale — daily active users × actions = QPS; bytes per record × records = storage; QPS × payload = bandwidth. Rough powers-of-ten math decides whether you even need a cache or shards.",
  // —— networking ——
  "Networking — DNS: the Domain Name System translates a human name like example.com into an IP address. It's cached at many layers (browser, OS, resolver) with a TTL, so most lookups are fast and don't hit the authoritative server.",
  "Networking — TCP vs UDP: TCP is reliable and ordered (a handshake, retransmits lost packets) — used for web, APIs, files. UDP is fire-and-forget (no handshake, may drop/reorder) — used for video calls, games, DNS, where speed beats perfect delivery.",
  "Networking — HTTP versions: HTTP/1.1 opens many connections; HTTP/2 multiplexes many requests over one connection; HTTP/3 runs over QUIC (UDP) to avoid head-of-line blocking and reconnect faster on flaky networks.",
  "Networking — WebSockets vs polling: for real-time (chat, live updates) a WebSocket keeps one persistent, two-way connection open so the server can push instantly. Long-polling repeatedly asks 'anything new?' — simpler but wasteful and higher latency.",
  // —— APIs ——
  "APIs — REST vs GraphQL vs gRPC: REST exposes resources over HTTP verbs (simple, cacheable). GraphQL lets clients ask for exactly the fields they need in one query (avoids over/under-fetching). gRPC uses binary protobuf over HTTP/2 — fast, typed, great for service-to-service calls.",
  "APIs — idempotency: an idempotent operation gives the same result no matter how many times it runs. Clients retry on timeouts, so writes like 'charge a card' must use an idempotency key so a retry doesn't double-charge.",
  // —— databases ——
  "Databases — SQL vs NoSQL: SQL (relational) gives structured tables, joins, and ACID transactions — great when data is relational and consistency matters. NoSQL (key-value, document, wide-column, graph) trades some of that for flexible schemas and easier horizontal scaling.",
  "Databases — ACID vs BASE: ACID (Atomic, Consistent, Isolated, Durable) guarantees correct transactions, typical of SQL. BASE (Basically Available, Soft state, Eventual consistency) relaxes guarantees for availability and scale, typical of large NoSQL systems.",
  "Databases — indexing: an index is a sorted lookup structure (usually a B-tree) that turns a full-table scan into a fast seek. Indexes speed reads but slow writes and use space, so you index the columns you actually query and filter on.",
  "Databases — replication: keep copies of the data on multiple machines. Leader-follower replication sends writes to a leader that streams them to read-only followers — this scales reads and survives a node failure, but followers can lag (stale reads).",
  "Databases — sharding / partitioning: split one big dataset across many machines so each holds a slice. Shard by a key (e.g. user_id): hash-based spreads load evenly, range-based keeps ranges together. The hard parts are hot shards ('celebrity' keys) and cross-shard queries.",
  "Databases — consistent hashing: a way to map keys to servers around a ring so that adding or removing a server only moves a small fraction of keys, not all of them. It's how distributed caches and key-value stores rebalance smoothly.",
  // —— caching ——
  "Caching — cache-aside (lazy loading): the app checks the cache first; on a miss it reads the database, then writes the result into the cache for next time. Simple and common, but the first request always pays the miss, and stale data needs a TTL or invalidation.",
  "Caching — write strategies: write-through updates cache and database together (consistent, slower writes); write-back updates the cache and flushes to the database later (fast, risks loss on crash); write-around writes only the database (avoids caching write-once data).",
  "Caching — eviction: caches are small, so they evict. LRU (Least Recently Used) drops the coldest entry; LFU drops the least frequently used; TTL expires entries after a time. The policy decides what stays hot in limited memory.",
  "Caching — invalidation & stampede: keeping caches fresh is famously hard. When a hot key expires, many requests miss at once and hammer the database (a 'stampede' or 'thundering herd'); fixes include locking, request coalescing, and staggered TTLs.",
  "Caching — CDN: a Content Delivery Network caches static assets (images, video, JS) at edge servers near users, so bytes travel a short distance. It cuts latency and offloads your origin; content is pushed or pulled and expired by TTL.",
  "Caching — Redis vs Memcached: both are in-memory key-value caches. Memcached is a simple, multithreaded string cache; Redis adds rich data types (lists, sets, sorted sets), persistence, pub/sub and Lua — so Redis doubles as a lightweight datastore and rate limiter.",
  // —— load balancing ——
  "Load balancing — L4 vs L7: a Layer-4 load balancer routes by IP/port (fast, protocol-agnostic); a Layer-7 balancer reads the HTTP request and can route by path, host, or cookies, terminate TLS, and do smart routing. L7 is more capable, L4 is cheaper per packet.",
  "Load balancing — algorithms: round-robin spreads requests evenly; least-connections favors the least-busy server; weighted variants account for machine size; hashing (by client IP or key) gives stickiness. Health checks pull unhealthy servers out of rotation.",
  "Load balancing — reverse proxy: a server (e.g. NGINX) that sits in front of your app servers and forwards client requests to them. It centralizes TLS termination, caching, compression, rate limiting, and routing, and hides the backend topology.",
  // —— async / messaging ——
  "Messaging — queue vs log: a message queue (SQS, RabbitMQ) delivers a task to one consumer and removes it — good for work distribution. A log (Kafka) keeps an ordered, replayable stream that many consumer groups read independently — good for event pipelines and analytics.",
  "Messaging — pub/sub: publishers send messages to a topic and any number of subscribers receive them, decoupled from each other. It's how one event (e.g. 'order placed') fans out to many services (email, inventory, analytics) without them knowing about each other.",
  "Messaging — delivery semantics: at-most-once may drop messages, at-least-once may deliver duplicates (so consumers must be idempotent), exactly-once is hardest and usually simulated with dedup + idempotency keys. Most systems choose at-least-once plus idempotent handlers.",
  "Messaging — why queues: putting a queue between producers and consumers absorbs traffic spikes (buffering), decouples services so a slow consumer can't block the producer, and lets you retry failed work. Failed messages land in a dead-letter queue for inspection.",
  // —— distributed systems ——
  "Distributed — CAP theorem: during a network partition you can keep either Consistency (every read sees the latest write) or Availability (every request gets a response), not both. So systems are effectively CP or AP; when there's no partition you can have both.",
  "Distributed — PACELC: extends CAP — if there's a Partition, trade Availability vs Consistency; Else (normal operation), trade Latency vs Consistency. It captures that even without failures, strong consistency costs latency.",
  "Distributed — consistency levels: strong consistency always returns the latest write (simple to reason about, slower). Eventual consistency lets replicas converge over time (fast, scalable, but a read can be stale). Causal and read-your-writes sit in between.",
  "Distributed — quorum: with N replicas, require W nodes to acknowledge a write and R nodes for a read. If R + W > N, reads and writes overlap on at least one node, guaranteeing you read the latest write — the tunable knob behind Dynamo-style stores.",
  "Distributed — consensus (Raft/Paxos): algorithms that let a cluster agree on one value or an ordered log despite failures. Raft elects a leader that appends entries and replicates them to a majority; it's how systems pick a leader and keep replicas in sync.",
  // —— resilience ——
  "Resilience — rate limiting: cap how many requests a client can make. Token bucket refills tokens at a steady rate and allows bursts up to the bucket size; leaky bucket smooths output to a fixed rate; sliding-window counters approximate a rolling limit. Usually enforced at the gateway with Redis.",
  "Resilience — circuit breaker: when a downstream service keeps failing, the breaker 'opens' and fails fast instead of piling on requests, then periodically tests if it has recovered. It stops one sick service from cascading into a full outage.",
  "Resilience — retries with backoff + jitter: on a transient failure, retry after an exponentially increasing delay, plus random jitter so many clients don't retry in sync and create a thundering herd. Always cap retries and make the operation idempotent first.",
  // —— architecture ——
  "Architecture — monolith vs microservices: a monolith is one deployable app (simple to build/deploy, but scales as one lump). Microservices split it into independent services that scale and deploy separately — powerful at large scale/team size, but add network, data-ownership, and operational complexity. Start monolith, split when it hurts.",
  "Architecture — API gateway: a single entry point in front of many services that handles auth, rate limiting, routing, and request aggregation, so clients talk to one endpoint instead of many. A BFF (backend-for-frontend) is a gateway tailored to one client type.",
  "Observability — metrics, logs, traces: the three pillars. Metrics are numbers over time (QPS, p99 latency, error rate) for dashboards/alerts; logs are discrete events for debugging; distributed traces follow one request across services to find where time went.",
  // —— scaling & real-world infrastructure ——
  "Infrastructure — containers & Docker: a container packages an app with its dependencies into one portable image that runs identically on any machine. Containers are lightweight (they share the host OS kernel), start in seconds, and are the unit most modern systems deploy and scale.",
  "Infrastructure — Kubernetes: the standard container orchestrator. You declare the desired state (e.g. 'run 10 replicas of this service') and Kubernetes schedules containers across a cluster, restarts crashed ones, rolls out new versions, and load-balances traffic to healthy pods — self-healing and declarative.",
  "Infrastructure — autoscaling: automatically add or remove instances based on load. A Horizontal Pod Autoscaler (or cloud autoscaling group) watches metrics like CPU or QPS and scales out under spikes and back in when quiet, so you pay for what you use and absorb traffic surges.",
  "Infrastructure — multi-region & geo-distribution: run the system in several geographic regions so users hit a nearby one (low latency) and one region's outage doesn't take you down. GeoDNS or anycast routes each user to the closest healthy region; the hard part is keeping data consistent across regions.",
  "Infrastructure — active-active vs active-passive regions: active-passive keeps a standby region that takes over on failover (simpler, some downtime, idle capacity). Active-active serves traffic from all regions at once (best latency and utilization) but needs cross-region replication and conflict resolution.",
  "Infrastructure — data locality across regions: a cross-region round-trip is tens to hundreds of ms, so replicating a strongly-consistent database across continents is slow. Systems keep data near its users (shard by region), replicate asynchronously, or accept eventual consistency between regions.",
  "Infrastructure — service mesh: a layer of sidecar proxies (e.g. Istio/Envoy) that handles service-to-service networking — mutual TLS, retries, timeouts, load balancing, traffic routing — without changing app code, and gives deep observability over internal ('east-west') traffic in a microservices cluster.",
  "Infrastructure — deployment strategies: rolling updates replace instances gradually; blue-green keeps two environments and flips traffic instantly (instant rollback); canary sends a small percentage of traffic to the new version and watches metrics before ramping up. Feature flags toggle features without a redeploy.",
  "Infrastructure — infrastructure as code: define servers, networks, and clusters in version-controlled files (e.g. Terraform) instead of clicking a console. It makes environments reproducible, reviewable in pull requests, and quick to recreate after a disaster.",
  "Resilience — load shedding & graceful degradation: under overload, deliberately reject low-priority work (load shedding) and serve a reduced experience (graceful degradation — cached or partial results) so the core stays alive instead of collapsing entirely.",
  "Architecture — CQRS & event sourcing: CQRS splits the write model from read-optimized views so each scales independently. Event sourcing stores every change as an immutable event and rebuilds state by replaying them — giving a full audit log and time-travel, at the cost of complexity.",
  // —— case studies ——
  "Case study — URL shortener: generate a short unique code (base62 of a counter or a hash) that maps to the long URL in a key-value store. It's extremely read-heavy, so cache hot links and use a 301/302 redirect; shard the store by code as it grows.",
  "Case study — news feed: to build a timeline, fan-out-on-write pushes each post into followers' feeds at post time (fast reads, expensive for celebrities); fan-out-on-read builds the feed at read time (cheap writes, slower reads). Big systems use a hybrid, reading celebrities live.",
  "Case study — chat app: use WebSockets for real-time delivery, a presence service for online status, and a message store with per-conversation ordering. Undelivered messages queue for offline users; group chat fans a message out to all members' connections.",
  "Case study — rate-limited API: put the limiter at the API gateway backed by Redis counters keyed per user/IP, using token-bucket for burst tolerance. Return HTTP 429 with a Retry-After header when the limit is exceeded so clients back off politely.",
];

// Free-choice topic map — the learner picks anything, in any order (no locked
// prerequisites). Each label becomes a seed question for the tutor.
export const TOPIC_GROUPS: { group: string; topics: string[] }[] = [
  { group: "Foundations", topics: ["Client-server & tiers", "Latency vs throughput", "Availability & the nines", "Vertical vs horizontal scaling", "Stateless services", "Back-of-envelope estimation"] },
  { group: "Networking & APIs", topics: ["DNS", "TCP vs UDP", "HTTP 1 · 2 · 3", "WebSockets vs polling", "REST vs GraphQL vs gRPC", "Idempotency"] },
  { group: "Databases", topics: ["SQL vs NoSQL", "ACID vs BASE", "Indexing", "Replication", "Sharding & partitioning", "Consistent hashing"] },
  { group: "Caching & CDN", topics: ["Cache-aside", "Write strategies", "Eviction (LRU/LFU)", "Cache invalidation & stampede", "CDN", "Redis vs Memcached"] },
  { group: "Load balancing & messaging", topics: ["L4 vs L7 balancing", "LB algorithms", "Reverse proxy", "Queues vs Kafka", "Pub/sub", "Delivery semantics"] },
  { group: "Distributed systems", topics: ["CAP theorem", "PACELC", "Consistency levels", "Quorum (R+W>N)", "Consensus (Raft/Paxos)"] },
  { group: "Scaling & infrastructure", topics: ["Containers & Docker", "Kubernetes", "Autoscaling", "Multi-region & geo-distribution", "Active-active vs active-passive", "Service mesh", "Deployment (blue-green, canary)", "Infrastructure as code"] },
  { group: "Resilience & ops", topics: ["Rate limiting", "Circuit breaker", "Retries & backoff", "Load shedding", "Observability (metrics/logs/traces)"] },
  { group: "Architecture", topics: ["Monolith vs microservices", "API gateway & BFF", "CQRS & event sourcing"] },
  { group: "Case studies", topics: ["URL shortener", "News feed", "Chat app", "Rate-limited API"] },
];

let idx: Float32Array[] | null = null;
let building: Promise<void> | null = null;

/** Embed the system-design corpus once (MiniLM, shared with rag.ts). */
export function buildSysIndex(): Promise<void> {
  if (!building) building = (async () => { idx = await embedTexts(SYS_CHUNKS); })().catch((e) => { building = null; throw e; });
  return building;
}

/** Top-k most relevant concept notes for a learner's question. Best-effort. */
export async function sysRetrieve(query: string, k = 4): Promise<string[]> {
  try {
    await buildSysIndex();
    if (!idx) return [];
    const [q] = await embedTexts([query]);
    return idx
      .map((v, i) => ({ i, s: cosine(q, v) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .filter((x) => x.s > 0.2)
      .map((x) => SYS_CHUNKS[x.i]);
  } catch {
    return [];
  }
}

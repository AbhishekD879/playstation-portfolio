// System City curriculum — a 2D, Brilliant-style course: bite-size steps, one
// idea at a time, animated request-flow diagrams (SVG), and instant-feedback
// quizzes. Five levels take a beginner to "can design real systems"; nothing
// is locked — jump anywhere. All content self-authored (license-clean).

export type DiagNode = { id: string; label: string; sub?: string; x: number; y: number };
export type DiagFlow = { path: string[]; label: string; color: string; dur?: number; delay?: number };
export type Diagram = { nodes: DiagNode[]; flows: DiagFlow[] };
export type StepImage = { src: string; alt: string; credit: string; href?: string };
export type Step =
  | { kind: "learn"; title: string; body: string; diagram?: Diagram; img?: StepImage }
  | { kind: "quiz"; q: string; options: string[]; answer: number; why: string };
export type Lesson = { id: string; title: string; sub: string; mins: number; steps: Step[] };
export type Level = { id: string; name: string; tag: string; lessons: Lesson[] };

// palette for flows
const BLUE = "#5aa2ff", GREEN = "#56d69a", AMBER = "#ffb648", RED = "#ff6257", CYAN = "#4fd6e6", VIOLET = "#b389ff";
const N = (id: string, label: string, sub: string, x: number, y: number): DiagNode => ({ id, label, sub, x, y });
const F = (path: string[], label: string, color: string, dur = 4, delay = 0): DiagFlow => ({ path, label, color, dur, delay });

export const LEVELS: Level[] = [
  // ————————————————————————— LEVEL 1 —————————————————————————
  {
    id: "foundations", name: "Foundations", tag: "START HERE",
    lessons: [
      {
        id: "how-web-works", title: "How the web works", sub: "Client, server, and the request loop", mins: 4,
        steps: [
          { kind: "learn", title: "Every app is a conversation", body: "When you open an app or website, your device (the client) sends a request across the internet to a server. The server does some work — reads data, runs logic — and sends back a response. Every system you'll ever design is built out of this one loop, repeated millions of times.", diagram: { nodes: [N("c", "Client", "your phone / browser", 90, 100), N("s", "Server", "runs the app logic", 360, 100), N("d", "Database", "stores the data", 630, 100)], flows: [F(["c", "s", "d", "s", "c"], "request → response", BLUE, 5)] } },
          { kind: "learn", title: "Three tiers, three jobs", body: "Most real systems split into three tiers: the client (what the user sees), application servers (the logic), and the database (the data). Separating them means each can grow, fail, and be fixed independently — the single most reused idea in system design." },
          { kind: "quiz", q: "Your app is slow ONLY when it reads data. Which tier is the likely bottleneck?", options: ["The client", "The application server", "The database"], answer: 2, why: "Reads hit the data tier. Because the tiers are separate, you can fix the database (indexes, caching, replicas) without touching the rest." },
          { kind: "learn", title: "Why this matters", body: "Interviews and real design both start here: draw the client, the servers, the database — then ask where the load goes. Everything you'll learn next (caching, load balancing, sharding) is just an upgrade bolted onto this picture." },
        ],
      },
      {
        id: "how-internet-works", title: "How the internet actually works", sub: "Cables under oceans, packets, routers & BGP", mins: 6,
        steps: [
          { kind: "learn", title: "Wires under the ocean", body: "The internet is not a cloud — it's physical. Over a million kilometers of fiber-optic submarine cables cross the oceans, carrying ~99% of intercontinental traffic as pulses of light. On land, fiber reaches your city; the “last mile” to your home is fiber, copper, or radio. When you visit a website hosted on another continent, light literally crosses an ocean and comes back.\n\nYour device doesn't touch that cable directly. It talks to your router, which talks to your ISP, which peers with other networks at internet exchange points (IXPs). The internet is just ~70,000 independent networks (autonomous systems) that agree to carry each other's traffic — there is no center, no owner, no main computer.", diagram: { nodes: [N("h", "Your device", "phone / laptop", 75, 100), N("r", "Home router", "", 240, 100), N("i", "Your ISP", "autonomous system", 405, 100), N("x", "IXP", "networks peer here", 555, 100), N("d", "Data center", "the site you visit", 675, 100)], flows: [F(["h", "r", "i", "x", "d"], "your request's real journey", BLUE, 5)] } },
          { kind: "learn", title: "Packets, not pipes", body: "Data doesn't flow as a stream — it's chopped into packets of ~1,500 bytes. Each packet carries its source and destination IP address and hops from router to router independently; two packets of the same photo may take different routes and get reassembled at the destination.\n\nThis is the internet's founding idea: if a router or cable dies mid-transfer, packets simply route around the failure. Nobody reboots the internet — it's designed so that failure is normal and survivable, which is exactly the mindset you'll apply to your own systems.", diagram: { nodes: [N("a", "Sender", "", 80, 100), N("r1", "Router", "", 265, 100), N("r2", "Router", "path A", 450, 45), N("r3", "Router", "path B", 450, 155), N("b", "Receiver", "reassembles", 640, 100)], flows: [F(["a", "r1", "r2", "b"], "packet 1", CYAN, 3.2), F(["a", "r1", "r3", "b"], "packet 2 — different route", VIOLET, 3.6, 0.8)] } },
          { kind: "learn", title: "BGP — the internet's postal system", body: "How does a router in Tokyo know where to send a packet addressed to a server in Berlin? BGP (Border Gateway Protocol): every network announces to its neighbors “I can reach these addresses”, announcements propagate, and each router builds a map of next hops.\n\nBGP runs on trust, and that's its weakness. When a network announces routes it shouldn't, traffic worldwide can vanish into a black hole — Facebook's 2021 six-hour global outage was its own BGP announcements being withdrawn: the servers were fine, the internet just forgot how to reach them." },
          { kind: "quiz", q: "A router on your download's path fails mid-transfer. What actually happens?", options: ["The download fails and must restart", "Packets route around the failure; TCP retransmits anything lost — the download continues", "Your ISP has to fix it first"], answer: 1, why: "Packet switching + BGP reconvergence route around the dead router, and TCP (next lessons) retransmits the few packets that were lost. Failure-is-normal is baked into the internet's design." },
        ],
      },
      {
        id: "protocol-stack", title: "The protocol stack", sub: "OSI layers, encapsulation, TCP vs UDP", mins: 6,
        steps: [
          { kind: "learn", title: "Layers — each solves ONE problem", body: "Networking is a stack of layers, each doing one job and handing the rest upward: the physical layer moves raw bits over wire or radio; Ethernet/WiFi delivers frames between directly-connected machines; IP addresses and routes packets across the whole internet; TCP/UDP (the transport layer) gets data to the right application, reliably or fast; TLS encrypts it; HTTP speaks the application's language.\n\nBecause the layers are independent, you can swap one without touching the rest — WiFi to fiber, HTTP/1 to HTTP/3 — and nothing else needs to know. This separation is why the 1970s internet design still runs TikTok.", diagram: { nodes: [N("l7", "HTTP", "L7 · application", 360, 12), N("l5", "TLS", "encryption", 360, 68), N("l4", "TCP / UDP", "L4 · transport — ports", 360, 124), N("l3", "IP", "L3 · routing — addresses", 360, 180), N("l1", "Ethernet / WiFi / fiber", "L1-2 · bits on a wire", 360, 236)], flows: [F(["l7", "l5", "l4", "l3", "l1"], "your request, wrapped layer by layer", BLUE, 4.5)] } },
          { kind: "learn", title: "Encapsulation — envelopes in envelopes", body: "When you send a request, each layer wraps the one above: TLS encrypts your HTTP request, TCP adds ports and sequence numbers, IP adds source/destination addresses, Ethernet adds local delivery — an envelope inside an envelope. The receiver peels them off in reverse order.\n\nThis is also your debugging map. “Connection refused” = transport layer (nothing listening on that port). “No route to host” = IP layer. Certificate warning = TLS. A 404 = the application itself. Knowing WHICH layer broke is half of every network investigation." },
          { kind: "quiz", q: "Users report certificate warnings on your site. Which layer is broken?", options: ["IP — routing is wrong", "TLS — the security layer", "HTTP — your app logic"], answer: 1, why: "Certificates live in the TLS layer (expired cert, wrong domain, broken chain). Routing and app code can be perfectly healthy while TLS screams — the layers fail independently." },
          { kind: "learn", title: "TCP vs UDP — the transport choice", body: "TCP gives you a reliable, ordered stream: a handshake to connect, acknowledgements, retransmission of anything lost. The web, APIs, and databases ride on it. UDP just throws packets — no handshake, no retries, no ordering — but with near-zero overhead.\n\nReal-time traffic (video calls, game state, live audio) prefers UDP: a lost packet is better skipped than waited for. And modern HTTP/3 runs on QUIC — reliability rebuilt ON TOP of UDP to escape TCP's head-of-line blocking. Protocol choice is a real design decision, not plumbing trivia." },
          { kind: "quiz", q: "In a video call, 50 ms of audio is lost in transit. What SHOULD the protocol do?", options: ["Pause everything until it's retransmitted (TCP behavior)", "Skip it — a tiny glitch now beats stale audio later (UDP behavior)", "Restart the call"], answer: 1, why: "Real-time media values freshness over completeness — retransmitted audio would arrive too late to be useful. That's why calls use UDP/RTP while your bank uses TCP." },
        ],
      },
      {
        id: "computer-os", title: "How a machine runs your code", sub: "CPU, memory, the OS, processes & threads", mins: 6,
        steps: [
          { kind: "learn", title: "The hardware pyramid", body: "A CPU core executes billions of simple instructions per second, but it can only work on data it can reach: registers and L1/L2/L3 caches are nanoseconds away, RAM is ~100 nanoseconds, an SSD is ~100 microseconds — a thousand times slower — and a network hop is a thousand times slower again.\n\nEvery performance decision in system design is this pyramid repeating at bigger scale: CPU cache vs RAM is the same trade as Redis vs database, which is the same trade as edge CDN vs origin. Keep hot data close; pay the trip down only when you must.", diagram: { nodes: [N("c", "CPU + caches", "ns — blazing", 120, 100), N("m", "RAM", "~100 ns", 340, 100), N("s", "SSD", "~100 µs · 1,000× slower", 550, 100), N("n", "Network", "ms — 1,000× slower again", 680, 100)], flows: [F(["c", "m", "s", "n"], "each step = ~1,000× slower", AMBER, 4.5)] } },
          { kind: "learn", title: "The OS — scheduler of everything", body: "Your machine runs hundreds of programs on a handful of cores. The operating system makes that work: each program runs as a process with its own isolated virtual memory; within a process, threads share memory and run work in parallel. The OS slices CPU time into milliseconds and context-switches between them so fast it feels simultaneous.\n\nWhy this matters at scale: every open connection costs memory and a file descriptor; every context switch and memory copy costs CPU. That's why high-performance servers (nginx, Node.js, Redis) use event loops — a few threads juggling thousands of connections that are mostly just waiting for the network." },
          { kind: "quiz", q: "A server with 8 cores handles 10,000 simultaneous connections. How is that possible?", options: ["It secretly has 10,000 cores", "Most connections are idle waiting on I/O — the OS and event loops interleave the actual work", "It isn't — the connections queue one by one"], answer: 1, why: "Concurrency ≠ parallelism. At any instant only 8 things RUN, but almost all connections are waiting on network I/O, which costs no CPU. Event-driven servers exploit exactly this." },
          { kind: "learn", title: "From your code to a running system", body: "Your code compiles (or is interpreted) into instructions; the OS loads it as a process with a stack and heap; when it needs the disk or network it asks the OS via system calls; sockets — OS-provided endpoints — are how processes talk across machines. A “server” is just a process in a loop: accept connection, read request, respond.\n\nHold onto this picture: containers (coming in Level 4) are NOT mini virtual machines — they're ordinary processes that the OS shows an isolated view of the filesystem, network, and resources. Understanding processes is understanding containers." },
        ],
      },
      {
        id: "speed", title: "Latency, throughput & the nines", sub: "The units every decision is measured in", mins: 4,
        steps: [
          { kind: "learn", title: "Latency vs throughput", body: "Latency is how long ONE request takes (say 120 ms). Throughput is how MANY requests you can handle per second (say 5,000 QPS). They're different dials: a system can be fast for one user but collapse under many, or handle huge volume while each request crawls." },
          { kind: "quiz", q: "Adding more servers usually improves…", options: ["Latency of a single request", "Throughput (requests per second)", "Both, always"], answer: 1, why: "More servers share the load → more throughput. One request still takes the same path, so its latency barely changes. To cut latency you shorten the path (caching, closer servers)." },
          { kind: "learn", title: "Availability — the nines", body: "“99.9% available” sounds great — it's ~8.7 hours of downtime a year. 99.99% is ~52 minutes. Each extra nine costs dramatically more (redundancy, failover, on-call), so real teams pick a target that matches the product instead of chasing the maximum." },
          { kind: "quiz", q: "A payment API and a meme generator: which deserves more nines?", options: ["The meme generator", "The payment API", "Both need 99.999%"], answer: 1, why: "Downtime on payments costs money and trust; a meme generator can shrug off an hour. Availability is a business decision, not a bragging right." },
        ],
      },
      {
        id: "scaling", title: "Scaling up vs scaling out", sub: "Bigger machine, or more machines?", mins: 4,
        steps: [
          { kind: "learn", title: "Two ways to grow", body: "Vertical scaling means a bigger machine — simple, no code changes, but there's a hard ceiling and it's still one machine that can die. Horizontal scaling means MORE machines behind a load balancer — it scales much further and survives failures, but your app has to cooperate.", diagram: { nodes: [N("c", "Clients", "many users", 90, 100), N("lb", "Load Balancer", "spreads the traffic", 340, 100), N("s1", "Server A", "", 610, 36), N("s2", "Server B", "", 610, 100), N("s3", "Server C", "", 610, 164)], flows: [F(["c", "lb", "s1"], "", BLUE, 3), F(["c", "lb", "s2"], "", CYAN, 3.6, 0.6), F(["c", "lb", "s3"], "requests fan out", VIOLET, 4.2, 1.2)] } },
          { kind: "learn", title: "The trick: stateless servers", body: "Horizontal scaling only works if any server can handle any request. So servers keep no per-user state between requests — sessions live in a shared store (a database or cache) instead. Stateless servers are interchangeable: add ten during a spike, kill one, nobody notices." },
          { kind: "quiz", q: "Your server keeps user sessions in its own memory. What breaks when you add a second server?", options: ["Nothing — traffic just splits", "Users randomly get logged out", "The database gets slower"], answer: 1, why: "A user's next request may land on the OTHER server, which has no memory of them. That's why session state moves to a shared store — making servers stateless." },
        ],
      },
      {
        id: "estimation", title: "Back-of-envelope estimation", sub: "The 60-second math before any design", mins: 3,
        steps: [
          { kind: "learn", title: "Estimate before you architect", body: "Before drawing anything, estimate the scale: users × actions per day → requests per second; records × bytes → storage. 10 million users doing 10 actions a day is ~100M requests/day ≈ 1,200 QPS average — maybe 3–5× that at peak. That number decides whether you even need the fancy stuff." },
          { kind: "quiz", q: "~86,400 seconds in a day. 8.6 million requests/day is roughly…", options: ["10 QPS", "100 QPS", "1,000 QPS"], answer: 1, why: "8.6M ÷ 86,400 ≈ 100 QPS. A single decent server handles that — no shards, no Kafka. Estimation stops you over-engineering." },
          { kind: "learn", title: "Latency numbers to feel", body: "Reading from memory: ~100 nanoseconds. Reading from an SSD: ~100 microseconds (1,000× slower). A round trip across an ocean: ~150 milliseconds (another 1,000×). This is the whole reason caches exist and why data centers sit near users." },
        ],
      },
    ],
  },
  // ————————————————————————— LEVEL 2 —————————————————————————
  {
    id: "blocks", name: "Building Blocks", tag: "THE COMPONENTS",
    lessons: [
      {
        id: "dns", title: "DNS — finding the server", sub: "The internet's phone book", mins: 3,
        steps: [
          { kind: "learn", title: "Names to addresses", body: "Computers route by IP address, but humans type names. DNS translates example.com into an IP, and the answer is cached at every layer — your browser, your OS, your ISP — each copy expiring after a TTL. That's why the first visit is the slow one.", diagram: { nodes: [N("c", "Browser", "wants example.com", 90, 100), N("r", "DNS Resolver", "cached? answer fast", 360, 100), N("a", "Authoritative DNS", "the source of truth", 630, 100)], flows: [F(["c", "r", "a", "r", "c"], "first lookup (uncached)", AMBER, 5), F(["c", "r", "c"], "cached lookup", GREEN, 2.5, 1)] } },
          { kind: "quiz", q: "You change your server's IP but users still hit the old one for an hour. Why?", options: ["The load balancer is broken", "DNS answers are cached until their TTL expires", "Browsers ignore DNS"], answer: 1, why: "Resolvers and devices keep the old answer until the TTL runs out. Teams lower the TTL before a migration for exactly this reason." },
        ],
      },
      {
        id: "tls-https", title: "TLS & HTTPS", sub: "The handshake, certificates, and why the padlock exists", mins: 5,
        steps: [
          { kind: "learn", title: "Plain HTTP is a postcard", body: "Every router, ISP, and coffee-shop WiFi between you and a server can read — and modify — plain HTTP traffic. TLS wraps the connection in three guarantees: encryption (nobody on the path can read it), integrity (nobody can tamper with it undetected), and authentication (you're really talking to your bank, not an imposter).\n\nHTTPS is just HTTP inside a TLS tunnel. It's why browsers mark plain HTTP as “not secure”, and it's non-negotiable in any design you'll ever draw: TLS terminates at your load balancer or CDN edge, and often again between your own services (mTLS)." },
          { kind: "learn", title: "The handshake", body: "Before any data flows, client and server negotiate: the client says “here are the ciphers I speak” plus a random value; the server replies with its certificate (a public key signed by a trusted authority); both run an ephemeral key exchange (ECDHE) so each side DERIVES the same secret — which never travels on the wire. From there, everything is symmetrically encrypted, which modern CPUs do nearly for free.\n\nCost: one extra round trip in TLS 1.3 (and zero on reconnect). Bonus: forward secrecy — because session keys are ephemeral, even a future leak of the server's private key can't decrypt recorded past traffic.", diagram: { nodes: [N("c", "Client", "browser", 110, 100), N("s", "Server", "has a certificate", 610, 100)], flows: [F(["c", "s"], "① hello — ciphers + random", BLUE, 2.6), F(["s", "c"], "② certificate + key share", CYAN, 2.6, 0.9), F(["c", "s"], "③ encrypted from here on", GREEN, 2.6, 1.8)] } },
          { kind: "learn", title: "Certificates — the chain of trust", body: "A certificate binds a domain name to a public key, signed by a Certificate Authority (CA) whose own key your OS and browser already trust. The browser walks that signature chain; any break — expired, wrong domain, unknown CA — and you get the scary warning. Let's Encrypt made certificates free and automated, which is why the whole web could move to HTTPS.\n\nInside clusters the same machinery runs both ways: mTLS, where client AND server present certificates, is how microservices prove their identity to each other — usually automated by a service mesh." },
          { kind: "quiz", q: "On hostile WiFi you browse an HTTPS site. What can the attacker actually see?", options: ["Everything — WiFi beats TLS", "Nothing whatsoever", "Roughly WHICH site you're visiting (metadata), but none of the content"], answer: 2, why: "TLS encrypts the content, but the server name (SNI) and IP are visible metadata. Encrypt the letters, and anyone can still read the envelope — a useful mental model for what TLS does and doesn't hide." },
        ],
      },
      {
        id: "load-balancing", title: "Load balancers", sub: "The traffic cop in front of your servers", mins: 4,
        steps: [
          { kind: "learn", title: "One door, many rooms", body: "A load balancer is the single entry point that spreads requests across your server fleet. It health-checks constantly and pulls a dead server out of rotation in seconds — this is where horizontal scaling and fault tolerance actually happen." },
          { kind: "learn", title: "How it picks a server", body: "Round-robin deals requests like cards. Least-connections favors the least-busy server. Hashing (by user or IP) sends the same client to the same server. And Layer 7 balancers can read the request itself — sending /video to the video fleet and /api to the API fleet." },
          { kind: "quiz", q: "One server in the pool dies at 3 AM. What should users notice?", options: ["Errors until an engineer wakes up", "Nothing — health checks route around it", "The whole site goes down"], answer: 1, why: "Failed health checks evict the dead server from rotation automatically. Surviving fleet absorbs its share. That's the availability win of scaling out." },
        ],
      },
      {
        id: "caching", title: "Caching", sub: "The biggest speed win in all of system design", mins: 5,
        steps: [
          { kind: "learn", title: "Memory is 1,000× faster than disk", body: "A cache (like Redis) keeps hot data in memory. The app checks the cache first: a HIT returns in ~1 ms and the database never wakes up; a MISS falls through to the database, then stores the answer for next time. This 'cache-aside' pattern is everywhere.", diagram: { nodes: [N("c", "Client", "", 80, 100), N("a", "App Server", "checks cache first", 300, 100), N("r", "Cache", "Redis · in memory", 545, 36), N("d", "Database", "on disk · slow", 545, 164)], flows: [F(["c", "a", "r", "a", "c"], "HIT — ~1 ms", GREEN, 3), F(["c", "a", "r", "a", "d", "a", "c"], "MISS — pays the DB", AMBER, 6, 1.2)] } },
          { kind: "quiz", q: "A tweet goes viral — 100,000 reads/sec of the SAME data. What saves your database?", options: ["More database servers", "A cache in front of it", "A bigger database machine"], answer: 1, why: "All those identical reads become cache hits; the database serves the data once. Read-heavy + repetitive = caching's home turf." },
          { kind: "learn", title: "The hard part: staleness", body: "Cached data can go stale when the source changes. You expire entries with a TTL, or invalidate them on writes. And beware the stampede: when a hot key expires, thousands of requests miss at once and hammer the database — fixed with locks or staggered TTLs. “There are only two hard things in computer science: cache invalidation and naming things.”" },
          { kind: "quiz", q: "Cache TTL is 60s. A user updates their profile and still sees the old name. Why?", options: ["The database lost the write", "The cache is serving the old entry until it expires or is invalidated", "DNS again"], answer: 1, why: "The write went to the database, but the cache still holds the old copy. Fix: invalidate/update the cache on write, or accept up-to-60s staleness." },
        ],
      },
      {
        id: "cdn", title: "CDNs", sub: "Serving from around the corner", mins: 3,
        steps: [
          { kind: "learn", title: "Move the bytes near the user", body: "A Content Delivery Network caches your images, video and scripts on edge servers in hundreds of cities. A user in Tokyo gets your files from Tokyo — not from your origin in Virginia — cutting latency and offloading most of your traffic. It's caching, applied geographically.", diagram: { nodes: [N("u", "User · Tokyo", "", 90, 100), N("e", "CDN Edge · Tokyo", "cached copy nearby", 360, 100), N("o", "Origin · Virginia", "only on a miss", 630, 100)], flows: [F(["u", "e", "u"], "edge hit — fast", GREEN, 2.6), F(["u", "e", "o", "e", "u"], "first request — fills the edge", AMBER, 6, 1)] } },
          { kind: "quiz", q: "What belongs on a CDN?", options: ["Your database tables", "Images, video, JS/CSS — static content", "User passwords"], answer: 1, why: "CDNs shine for static, shareable content that many users request. Dynamic per-user data stays on your servers (though CDNs can cache some API responses too)." },
        ],
      },
      {
        id: "databases", title: "SQL vs NoSQL & indexes", sub: "Choosing and tuning the data layer", mins: 5,
        steps: [
          { kind: "learn", title: "Two big families", body: "SQL databases (Postgres, MySQL) give you tables, joins, and ACID transactions — when the money must add up, you want them. NoSQL (key-value, document, wide-column) trades some of that for flexible schemas and easier horizontal scale. Not a war — a fit-per-job choice, and big systems use both." },
          { kind: "quiz", q: "Bank transfers: money must never be half-moved. Which property matters most?", options: ["Flexible schema", "ACID transactions", "Eventual consistency"], answer: 1, why: "Atomicity: debit and credit succeed or fail together. This is the classic case FOR a relational, transactional store." },
          { kind: "learn", title: "Indexes — the speed dial", body: "Without an index, finding one row means scanning the whole table. An index is a sorted structure (usually a B-tree) that jumps straight to it — turning a million-row scan into a few hops. The cost: every write must also update the index, so you index what you query, not everything." },
          { kind: "quiz", q: "Queries filter by email constantly and it's slow. First move?", options: ["Shard the database", "Add an index on email", "Buy a bigger server"], answer: 1, why: "An index on the queried column is the cheapest, highest-impact fix. Sharding and hardware come much later — after the easy wins." },
        ],
      },
      {
        id: "replication-sharding", title: "Replication & sharding", sub: "When one database isn't enough", mins: 5,
        steps: [
          { kind: "learn", title: "Replication — copies for safety and reads", body: "Leader-follower replication sends all writes to one leader, which streams them to read-only followers. You get read scaling (spread reads over followers) and failover (promote a follower if the leader dies). The catch: followers lag slightly — a read might be a beat stale.", diagram: { nodes: [N("a", "App", "", 90, 100), N("l", "Leader", "all writes", 340, 100), N("f1", "Follower 1", "reads", 610, 36), N("f2", "Follower 2", "reads", 610, 164)], flows: [F(["a", "l", "f1"], "write → replicates", BLUE, 4), F(["a", "l", "f2"], "", BLUE, 4, 0.8), F(["a", "f1", "a"], "reads hit followers", GREEN, 3, 1.6)] } },
          { kind: "learn", title: "Sharding — splitting the data itself", body: "When the data won't fit one machine, you split it: shard by a key (like user_id), each shard holding a slice. Hash-sharding spreads load evenly; range-sharding keeps neighbors together. New problems appear: cross-shard queries get hard, and one hot key (a celebrity) can overload its shard.", diagram: { nodes: [N("a", "App", "", 90, 100), N("r", "Shard Router", "hash(user_id)", 340, 100), N("s1", "Shard 1", "users A–H", 610, 36), N("s2", "Shard 2", "users I–Q", 610, 100), N("s3", "Shard 3", "users R–Z", 610, 164)], flows: [F(["a", "r", "s2"], "each key → one shard", VIOLET, 3.4)] } },
          { kind: "quiz", q: "Replication vs sharding — which problem does each solve?", options: ["Replication = too much data; sharding = safety", "Replication = read scale & failover; sharding = data too big for one machine", "They're the same thing"], answer: 1, why: "Replication copies the SAME data for reads/safety; sharding splits DIFFERENT data across machines for size/write scale. Real systems do both: shards, each replicated." },
        ],
      },
      {
        id: "queues", title: "Queues & async work", sub: "Don't make the user wait for slow things", mins: 4,
        steps: [
          { kind: "learn", title: "Do it later, reliably", body: "When someone signs up, they shouldn't wait while you send emails and resize avatars. The server drops a message on a queue and responds instantly; worker processes consume the queue at their own pace. Spikes get absorbed as backlog instead of crashes, and failed jobs retry.", diagram: { nodes: [N("a", "App Server", "responds instantly", 90, 100), N("q", "Queue", "buffer · Kafka / SQS", 360, 100), N("w1", "Worker", "sends emails", 630, 60), N("w2", "Worker", "resizes images", 630, 150)], flows: [F(["a", "q", "w1"], "async jobs", CYAN, 3.5), F(["a", "q", "w2"], "", CYAN, 4.2, 0.9)] } },
          { kind: "learn", title: "Delivery is messy — plan for duplicates", body: "Queues promise at-least-once delivery: a message is never lost, but might arrive twice (a worker crashed mid-job and it was retried). So workers must be idempotent — processing the same message twice has the same effect as once. Poisoned messages that keep failing go to a dead-letter queue for humans." },
          { kind: "quiz", q: "The email worker crashes after sending but before acknowledging. The queue redelivers. What prevents a double email?", options: ["Nothing — that's impossible", "Idempotency: record the message ID, skip if already processed", "Using a faster queue"], answer: 1, why: "At-least-once delivery makes duplicates a WHEN, not an IF. Dedup by message/idempotency key is the standard guard — same trick payments use." },
        ],
      },
    ],
  },
  // ————————————————————————— LEVEL 3 —————————————————————————
  {
    id: "distributed", name: "Distributed Systems", tag: "THE DEEP END",
    lessons: [
      {
        id: "cap", title: "CAP & consistency", sub: "The trade-off you can't escape", mins: 4,
        steps: [
          { kind: "learn", title: "Pick two — sort of", body: "When the network partitions (machines can't reach each other — and eventually it WILL happen), you must choose: Consistency (refuse answers that might be stale) or Availability (answer, possibly stale). Banks pick C; social feeds pick A. PACELC adds: even with no failure, strong consistency costs latency." },
          { kind: "quiz", q: "During a partition, your shopping-cart service keeps accepting items but two data centers briefly disagree. It chose…", options: ["Consistency", "Availability", "Neither"], answer: 1, why: "It stayed available and let replicas diverge, merging later (eventual consistency). Better a rare duplicate cart item than a checkout that's down." },
          { kind: "learn", title: "The consistency spectrum", body: "Strong consistency: every read sees the latest write — simple to reason about, slower. Eventual consistency: replicas converge in time — fast and scalable, but reads can be stale. In between live useful levels like read-your-own-writes: YOU always see your own update, even if others lag a moment." },
        ],
      },
      {
        id: "quorum", title: "Quorums & consensus", sub: "How machines agree", mins: 4,
        steps: [
          { kind: "learn", title: "Quorum math: R + W > N", body: "With N replicas, require W acknowledgements per write and R per read. If R + W > N, every read overlaps at least one node that has the newest write — so you never read purely stale data. N=3, W=2, R=2 is the classic balanced setup; tuning W and R trades speed against safety." },
          { kind: "quiz", q: "N=3 replicas, W=1, R=1. Fast — but what's the risk?", options: ["Writes get slower", "A read may hit a replica the write never reached → stale data", "The cluster can't lose any node"], answer: 1, why: "1 + 1 = 2, not > 3. The read and write sets may not overlap, so you can read old data. That's the availability-for-consistency dial in action." },
          { kind: "learn", title: "Consensus — electing a leader", body: "Algorithms like Raft let a cluster agree on one ordered log of events despite crashes: nodes elect a leader, the leader replicates entries, and a majority must confirm each one. It's the machinery behind leader failover, distributed locks, and configuration stores like etcd — the beating heart of Kubernetes." },
        ],
      },
      {
        id: "resilience", title: "Resilience patterns", sub: "Rate limits, circuit breakers, smart retries", mins: 5,
        steps: [
          { kind: "learn", title: "Rate limiting — the bouncer", body: "A rate limiter caps how many requests each client may make (say 100/minute). The token-bucket algorithm drips tokens into a bucket at a steady rate; each request spends one, and a full bucket allows short bursts. It lives at the gateway, usually counting in Redis, and answers abusers with HTTP 429." },
          { kind: "learn", title: "Circuit breakers — fail fast", body: "If the recommendations service is drowning, calling it again just makes it worse. A circuit breaker watches the failure rate, 'opens' to fail instantly for a while (show the page without recommendations), then half-opens to test recovery. It turns a cascading outage into a graceful degradation." },
          { kind: "quiz", q: "A downstream service times out. 10,000 clients all retry instantly, killing it again. What was missing?", options: ["More servers", "Exponential backoff with jitter", "A bigger timeout"], answer: 1, why: "Retries must back off exponentially (1s, 2s, 4s…) with random jitter so clients don't stampede in sync. Retry + backoff + jitter + idempotency = the safe formula." },
          { kind: "quiz", q: "Under extreme overload, the healthiest move is…", options: ["Accept everything and hope", "Shed low-priority load and serve a degraded core", "Restart everything"], answer: 1, why: "Load shedding + graceful degradation keep the heart beating: drop analytics, serve cached pages, keep checkout alive. Partial service beats total collapse." },
        ],
      },
      {
        id: "microservices", title: "Monolith vs microservices", sub: "One app, or many small ones?", mins: 4,
        steps: [
          { kind: "learn", title: "Start together, split when it hurts", body: "A monolith is one deployable app — fast to build, easy to debug, deploys as one unit. Microservices split it into independent services that scale and ship separately — powerful when teams and traffic are big, but every function call becomes a network call with failures, latency, and versioning. The honest advice: start monolith." },
          { kind: "learn", title: "The gateway out front", body: "With many services, clients shouldn't juggle dozens of endpoints. An API gateway is the single front door: it authenticates, rate-limits, and routes to the right service. It's also where cross-cutting concerns live once instead of in every service.", diagram: { nodes: [N("c", "Clients", "", 80, 100), N("g", "API Gateway", "auth · rate limit · route", 320, 100), N("u", "Users svc", "", 590, 36), N("o", "Orders svc", "", 590, 100), N("p", "Payments svc", "", 590, 164)], flows: [F(["c", "g", "u"], "", BLUE, 3), F(["c", "g", "o"], "one door, many services", CYAN, 3.6, 0.7), F(["c", "g", "p"], "", VIOLET, 4.2, 1.4)] } },
          { kind: "quiz", q: "A 5-person startup asks: monolith or 12 microservices?", options: ["Microservices — that's what Netflix does", "Monolith — split later, when scale and team size demand it", "Neither, serverless everything"], answer: 1, why: "Microservices solve BIG-organization problems and bring distributed-systems pain. Five people don't have the first and can't afford the second. Netflix started as a monolith too." },
        ],
      },
    ],
  },
  // ————————————————————————— LEVEL 4 —————————————————————————
  {
    id: "scale", name: "Real-World Scale", tag: "HOW BIG TECH RUNS",
    lessons: [
      {
        id: "kubernetes", title: "Containers & Kubernetes", sub: "How modern software actually ships", mins: 5,
        steps: [
          { kind: "learn", title: "Containers — the shipping box", body: "A container packages your app with everything it needs into one image that runs identically on a laptop or a thousand servers. Containers start in seconds and share the host OS, so they're cheap. “Works on my machine” stops being a bug report." },
          { kind: "learn", title: "Kubernetes — the fleet manager", body: "You don't place containers by hand. You tell Kubernetes the desired state — “run 10 replicas of this, give each 1 CPU” — and it schedules them across the cluster, restarts crashes, replaces dead nodes' work, and load-balances between healthy pods. Declarative and self-healing: you state WHAT, it maintains it.", diagram: { nodes: [N("y", "You", "kubectl apply · '10 replicas'", 95, 100), N("k", "Control Plane", "schedules & heals", 350, 100), N("p1", "Pod", "node 1", 615, 36), N("p2", "Pod", "node 2", 615, 100), N("p3", "Pod", "node 3", 615, 164)], flows: [F(["y", "k", "p1"], "desired state → reality", CYAN, 3.6), F(["k", "p2"], "", CYAN, 2.4, 0.9), F(["k", "p3"], "", CYAN, 2.4, 1.5)] } },
          { kind: "quiz", q: "A node dies at 2 AM, taking 3 pods with it. In Kubernetes, what happens?", options: ["Pager screams; a human redeploys", "The control plane reschedules those pods onto healthy nodes automatically", "The cluster shuts down safely"], answer: 1, why: "Actual state (7 pods) no longer matches desired state (10), so Kubernetes fixes the difference itself. That reconciliation loop IS Kubernetes." },
          { kind: "learn", title: "Autoscaling", body: "Traffic isn't flat, so neither is the fleet. A horizontal autoscaler watches metrics (CPU, QPS) and adds pods during spikes, removing them when quiet; cluster autoscaling grows the machines underneath the same way. You stop paying for idle capacity — this is the economics of the cloud." },
        ],
      },
      {
        id: "k8s-internals", title: "Inside Kubernetes", sub: "Control plane, etcd & Raft, services — how it really works", mins: 6,
        steps: [
          { kind: "learn", title: "The control plane — the cluster's brain", body: "Four pieces run the show. The API server is the front door — every command, every component, everything goes through it. etcd is the cluster's memory: a replicated key-value store holding the entire desired state. The scheduler decides which node each new pod fits on (resources, affinity). And controllers run reconciliation loops: observe actual state, compare with desired, fix the difference — forever.\n\n`kubectl apply` does nothing but write desired state into etcd. The loops do the rest. That's why Kubernetes feels declarative: you never say “start a container”, you say “the world should look like this”.", diagram: { nodes: [N("u", "kubectl", "you", 80, 100), N("api", "API server", "the only door", 285, 100), N("e", "etcd", "desired state · Raft", 505, 30), N("sch", "Scheduler", "places pods", 505, 100), N("c", "Controllers", "reconcile loops", 505, 170)], flows: [F(["u", "api", "e"], "desired state written", BLUE, 3.4), F(["api", "sch"], "", CYAN, 2.2, 1), F(["api", "c"], "watch + reconcile", VIOLET, 2.6, 1.6)] } },
          { kind: "learn", title: "On every node", body: "Each worker node runs a kubelet — the agent that actually starts and stops containers (via a runtime like containerd) and reports their health back — and kube-proxy, which wires up service networking. A pod is the schedulable unit: one or more containers sharing a network namespace and storage — usually one app container, sometimes a sidecar (that's where service meshes live).\n\nKill the control plane and running pods keep serving traffic — but nothing new can be scheduled and no failures get repaired. The data plane keeps flying; the brain is what heals it." },
          { kind: "learn", title: "Services — stable names for moving targets", body: "Pods die and respawn with new IPs constantly — you can never hardcode a pod address. A Service gives a stable virtual IP and DNS name that load-balances across whatever healthy pods currently match its label selector. Ingress does the same for external HTTP traffic, routing by host and path.\n\nThis is service discovery, built in: your checkout service calls `http://inventory` and Kubernetes finds the current pods. Compare that with the load-balancer lesson — a Service IS a little L4 load balancer, born automatically." },
          { kind: "quiz", q: "You delete one pod of a Deployment that declares replicas: 3. What happens?", options: ["The cluster runs 2 replicas from now on", "A controller sees actual (2) ≠ desired (3) and starts a replacement within seconds", "Kubernetes pages your on-call"], answer: 1, why: "The reconciliation loop IS Kubernetes: observe, diff, act. Nobody is notified because nothing is wrong — the system self-heals to the declared state." },
          { kind: "learn", title: "etcd runs on Raft — theory meets production", body: "Everything the cluster knows lives in etcd, replicated across control-plane nodes by the Raft consensus algorithm from Level 3: leader election, quorum writes, ordered log. Lose a minority of etcd nodes — nothing happens. Lose quorum — the cluster freezes: pods keep running, but no change can be recorded.\n\nSo the distributed-systems theory you learned isn't academic — you are running consensus in production the moment you run Kubernetes. This is the payoff of the whole course: every layer you've learned, stacked into one machine." },
        ],
      },
      {
        id: "deploys", title: "Shipping without breaking", sub: "Blue-green, canary & feature flags", mins: 4,
        steps: [
          { kind: "learn", title: "Deploys used to be scary", body: "Rolling updates replace servers a few at a time so capacity never dips. Blue-green runs old and new side by side and flips traffic in one move — rollback is flipping back. Canary sends 1–5% of real traffic to the new version and watches error rates before ramping to everyone." },
          { kind: "quiz", q: "The new release has a subtle bug hitting 1 in 1,000 requests. Which strategy catches it with the least damage?", options: ["Deploy to everyone Friday 6 PM", "Canary — a small slice of traffic, watched, then ramped", "Never deploy again"], answer: 1, why: "The canary exposes only a sliver of users while real-traffic metrics reveal the bug; rollback is instant. Feature flags go further: toggle a feature off without any redeploy." },
        ],
      },
      {
        id: "multi-region", title: "Multi-region systems", sub: "Serving the whole planet, surviving a region", mins: 5,
        steps: [
          { kind: "learn", title: "Why one region isn't enough", body: "A user in Sydney talking to a Virginia data center pays ~200 ms every round trip — physics, not code. And one region can fail entirely (it happens every year). So global systems run in several regions: users are routed to the nearest one by GeoDNS or anycast, cutting latency AND surviving a regional outage.", diagram: { nodes: [N("u1", "User · Berlin", "", 85, 55), N("u2", "User · Sydney", "", 85, 150), N("g", "GeoDNS", "routes to nearest", 330, 100), N("eu", "Region · EU", "full stack", 600, 45), N("ap", "Region · APAC", "full stack", 600, 160)], flows: [F(["u1", "g", "eu"], "each user → closest region", GREEN, 3.2), F(["u2", "g", "ap"], "", CYAN, 3.2, 0.8)] } },
          { kind: "learn", title: "The hard part is the data", body: "Cross-region round trips cost 100+ ms, so strongly-consistent writes across continents are slow. Real systems choose per dataset: keep data in the user's home region (shard by geography), replicate asynchronously and accept brief staleness, or pay the latency for the few things that truly need global consistency." },
          { kind: "quiz", q: "Active-active (all regions serve traffic) vs active-passive (one standby). The main cost of active-active?", options: ["Wasted idle servers", "Cross-region data conflicts to resolve", "Slower for every user"], answer: 1, why: "Two regions accepting writes to the same data must reconcile conflicts (last-write-wins, CRDTs, or region-ownership). Active-passive avoids that but idles a whole region and fails over slower." },
          { kind: "quiz", q: "Region A burns down. A well-built multi-region system…", options: ["Loses all data", "Routes A's users to other regions; they may see slightly stale data briefly", "Waits for A to be rebuilt"], answer: 1, why: "GeoDNS/anycast steers traffic to surviving regions, replicas there take over. This is disaster recovery measured in seconds, not days." },
        ],
      },
      {
        id: "observability", title: "Observability", sub: "Seeing inside the machine", mins: 3,
        steps: [
          { kind: "learn", title: "Metrics, logs, traces", body: "You can't run what you can't see. Metrics are numbers over time (QPS, error rate, p99 latency) — dashboards and alerts. Logs are the detailed diary for debugging. Traces follow ONE request across every service it touched, showing exactly where the milliseconds went — indispensable once you have microservices." },
          { kind: "quiz", q: "“Checkout is slow” — 8 services are involved. Fastest way to find the culprit?", options: ["Read every service's logs", "A distributed trace of one slow request", "Restart everything"], answer: 1, why: "A trace shows the request's whole journey with per-hop timings — the 900 ms hiding in the inventory service jumps right out. Logs then explain why." },
        ],
      },
    ],
  },
  // ————————————————————————— LEVEL 5 —————————————————————————
  {
    id: "casestudies", name: "Case Studies", tag: "BECOME THE ARCHITECT",
    lessons: [
      {
        id: "url-shortener", title: "Design a URL shortener", sub: "The classic interview warm-up, end to end", mins: 6,
        steps: [
          { kind: "learn", title: "Requirements first, always", body: "Shorten long URLs; redirect fast; handle 100M new links/month and 10 BILLION redirects/month. Estimate: writes ≈ 40/sec — tiny. Reads ≈ 4,000/sec — 100× more. Verdict before drawing anything: this is a READ-HEAVY system; design for the redirect path." },
          { kind: "quiz", q: "Given 100:1 reads to writes, the component that matters most is…", options: ["A powerful write database", "A cache in front of the lookups", "A message queue"], answer: 1, why: "Billions of redirects, and hot links get hit constantly — cache the code→URL mapping and most redirects never touch the database. Estimation told us this before any architecture." },
          { kind: "learn", title: "The short code", body: "Give each URL a unique ID and encode it in base62 (a–z, A–Z, 0–9): ID 125 becomes “cb”. Seven characters cover 3.5 trillion links. A counter (or ranges of IDs handed to each server) avoids collisions entirely — no hashing headaches, naturally unique.", diagram: { nodes: [N("c", "Client", "", 80, 100), N("a", "API", "create / redirect", 300, 100), N("r", "Cache", "code → URL", 545, 36), N("d", "KV Store", "sharded by code", 545, 164)], flows: [F(["c", "a", "r", "a", "c"], "redirect — cache hit", GREEN, 3), F(["c", "a", "d", "a", "c"], "create + rare miss", BLUE, 5, 1.2)] } },
          { kind: "quiz", q: "Storage: key-value (code → URL) or relational with joins?", options: ["Relational — always safest", "Key-value — the access pattern is exactly one key to one value", "Graph database"], answer: 1, why: "The ONLY query is 'given code, return URL'. That's the definition of a KV lookup — trivially cacheable and shardable by code. Let the access pattern pick the database." },
          { kind: "learn", title: "What you just did", body: "Requirements → estimate → spot read-heavy → cache the hot path → pick storage from the access pattern → shard for growth. That sequence is THE reusable method. Every design that follows is this loop with different numbers." },
        ],
      },
      {
        id: "news-feed", title: "Design a news feed", sub: "Twitter's timeline & the celebrity problem", mins: 5,
        steps: [
          { kind: "learn", title: "Two ways to build a timeline", body: "Fan-out-on-write: when someone posts, push it into every follower's precomputed feed — reads are instant, but a celebrity with 100M followers triggers 100M writes per post. Fan-out-on-read: build the feed on request — cheap writes, expensive reads. Neither wins alone." },
          { kind: "quiz", q: "So how do Twitter-scale systems actually do it?", options: ["Pure fan-out-on-write", "Pure fan-out-on-read", "Hybrid: precompute for normal users, merge celebrities in at read time"], answer: 2, why: "Regular posts fan out to followers' cached feeds; celebrity posts are fetched and merged at read time. Hot keys get special treatment — a pattern you'll reuse everywhere." },
          { kind: "learn", title: "The pipeline", body: "A post lands in the posts store, then a queue fans it out to followers' feed caches asynchronously — the poster never waits. Reading your feed = one cache read of precomputed post IDs, then fetch the posts. Ranking happens on that small candidate set, not the whole network.", diagram: { nodes: [N("p", "Poster", "", 80, 100), N("s", "Post service", "store + enqueue", 300, 100), N("q", "Fan-out queue", "async", 520, 100), N("f", "Feed caches", "per-follower lists", 665, 100)], flows: [F(["p", "s", "q", "f"], "post → millions of feeds", VIOLET, 4.5)] } },
        ],
      },
      {
        id: "chat", title: "Design a chat app", sub: "WhatsApp-style real-time messaging", mins: 5,
        steps: [
          { kind: "learn", title: "Push, don't poll", body: "Chat can't wait for the client to ask 'anything new?'. Each online device keeps a persistent WebSocket to a chat server, so the server pushes messages instantly. A presence service tracks who's connected where; a session map routes a message to the recipient's socket.", diagram: { nodes: [N("a", "Alice", "", 80, 55), N("s1", "Chat server 1", "Alice's socket", 330, 55), N("s2", "Chat server 2", "Bob's socket", 330, 155), N("b", "Bob", "", 80, 155), N("st", "Message store", "history + queue", 600, 100)], flows: [F(["a", "s1", "s2", "b"], "real-time push", GREEN, 3.6), F(["s1", "st"], "persist", BLUE, 2.4, 1)] } },
          { kind: "quiz", q: "Bob is offline when Alice messages. What must the design do?", options: ["Drop the message", "Store it; deliver when Bob reconnects, in order", "Make Alice wait until Bob returns"], answer: 1, why: "Messages persist per conversation with sequence ordering; on reconnect Bob's client syncs everything missed. Delivery receipts (sent/delivered/read) ride the same machinery." },
          { kind: "learn", title: "You're an architect now", body: "Look what you used: WebSockets (networking), a session map (state), message stores (databases), queues for offline delivery, sharding by conversation for scale, multi-region for global latency. Every level of this course, in one product. That's mastery: not memorizing designs — assembling them." },
        ],
      },
    ],
  },
];

// ————————————————————————— THE GOLD MINE —————————————————————————
// Hand-picked FREE material from across the internet, per lesson. Everything
// links out to its source (we embed nothing we don't have rights to); ⭐ = the
// one to start with. `paid` flags the rare classic worth knowing about.
export type Resource = { title: string; source: string; kind: "video" | "article" | "interactive" | "book" | "course" | "blog"; url: string; star?: boolean; paid?: boolean };
const R = (kind: Resource["kind"], title: string, source: string, url: string, star?: boolean, paid?: boolean): Resource => ({ kind, title, source, url, star, paid });

export const RESOURCES: Record<string, Resource[]> = {
  "how-web-works": [
    R("article", "How the Web works", "MDN Web Docs", "https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/How_the_Web_works", true),
    R("article", "What happens when you type a URL", "Cloudflare Learning", "https://www.cloudflare.com/learning/dns/what-happens-when-you-type-a-url/"),
    R("course", "The System Design Primer", "GitHub · CC BY", "https://github.com/donnemartin/system-design-primer"),
  ],
  "how-internet-works": [
    R("interactive", "Live map of every submarine internet cable", "submarinecablemap.com", "https://www.submarinecablemap.com/", true),
    R("article", "How does the Internet work?", "Cloudflare Learning", "https://www.cloudflare.com/learning/network-layer/how-does-the-internet-work/"),
    R("article", "What is BGP? (and how it breaks the internet)", "Cloudflare Learning", "https://www.cloudflare.com/learning/security/glossary/what-is-bgp/"),
    R("video", "Computer Science crash course — networks & the internet", "Crash Course (YouTube)", "https://www.youtube.com/playlist?list=PL8dPuuaLjXtNlUrzyH5r6jN9ulIgZBpdo"),
  ],
  "protocol-stack": [
    R("book", "High Performance Browser Networking — free online", "hpbn.co · O'Reilly", "https://hpbn.co/", true),
    R("article", "OSI model, plain-English series", "Practical Networking", "https://www.practicalnetworking.net/series/packet-traveling/packet-traveling/"),
    R("book", "Beej's Guide to Network Programming (free)", "beej.us", "https://beej.us/guide/bgnet/"),
  ],
  "computer-os": [
    R("book", "Putting the “You” in CPU — how code really runs", "cpu.land · free", "https://cpu.land/", true),
    R("book", "Operating Systems: Three Easy Pieces (free book)", "OSTEP", "https://pages.cs.wisc.edu/~remzi/OSTEP/"),
    R("video", "Crash Course Computer Science — from transistors to OS", "YouTube", "https://www.youtube.com/playlist?list=PL8dPuuaLjXtNlUrzyH5r6jN9ulIgZBpdo"),
    R("course", "Nand2Tetris — build a computer from logic gates", "nand2tetris.org", "https://www.nand2tetris.org/"),
  ],
  speed: [
    R("interactive", "Latency numbers every programmer should know — interactive", "colin-scott.github.io", "https://colin-scott.github.io/personal_website/research/interactive_latency.html", true),
    R("article", "Latency vs throughput", "System Design Primer", "https://github.com/donnemartin/system-design-primer#latency-vs-throughput"),
  ],
  scaling: [
    R("video", "Horizontal vs vertical scaling", "Gaurav Sen (YouTube)", "https://www.youtube.com/playlist?list=PLMCXHnjXnTnvo6alSjVkgxV-VH6EPyvoX", true),
    R("article", "Scalability for Dummies-style walkthrough", "System Design Primer", "https://github.com/donnemartin/system-design-primer#scalability-video-lecture"),
  ],
  estimation: [
    R("article", "Back-of-the-envelope calculations", "System Design Primer", "https://github.com/donnemartin/system-design-primer#back-of-the-envelope-calculations", true),
    R("interactive", "Interactive latency table (updated yearly)", "colin-scott.github.io", "https://colin-scott.github.io/personal_website/research/interactive_latency.html"),
  ],
  dns: [
    R("interactive", "How DNS works — a fun comic", "howdns.works", "https://howdns.works/", true),
    R("article", "What is DNS?", "Cloudflare Learning", "https://www.cloudflare.com/learning/dns/what-is-dns/"),
    R("course", "Implement DNS in a weekend", "Julia Evans", "https://implement-dns.wizardzines.com/"),
  ],
  "tls-https": [
    R("interactive", "How HTTPS works — the comic sequel", "howhttps.works", "https://howhttps.works/", true),
    R("article", "What happens in a TLS handshake?", "Cloudflare Learning", "https://www.cloudflare.com/learning/ssl/what-happens-in-a-tls-handshake/"),
    R("book", "TLS chapter — High Performance Browser Networking", "hpbn.co", "https://hpbn.co/transport-layer-security-tls/"),
  ],
  "load-balancing": [
    R("interactive", "Load Balancing — animated, playable essay", "samwho.dev", "https://samwho.dev/load-balancing/", true),
    R("article", "What is load balancing?", "Cloudflare Learning", "https://www.cloudflare.com/learning/performance/what-is-load-balancing/"),
    R("article", "Load balancer vs reverse proxy", "System Design Primer", "https://github.com/donnemartin/system-design-primer#load-balancer"),
  ],
  caching: [
    R("article", "Caching strategies & how to choose", "AWS caching guide", "https://aws.amazon.com/caching/", true),
    R("article", "Cache patterns (aside, through, back)", "System Design Primer", "https://github.com/donnemartin/system-design-primer#cache"),
    R("article", "Thundering-herd / cache stampede war story", "Instagram Engineering", "https://instagram-engineering.com/thundering-herds-promises-82191c8af57d"),
  ],
  cdn: [
    R("article", "What is a CDN?", "Cloudflare Learning", "https://www.cloudflare.com/learning/cdn/what-is-a-cdn/", true),
    R("video", "How CDNs work, visually", "ByteByteGo (YouTube)", "https://www.youtube.com/@ByteByteGo"),
  ],
  databases: [
    R("video", "7 database paradigms in 10 minutes", "Fireship (YouTube)", "https://www.youtube.com/watch?v=W2Z7fbCLSTw", true),
    R("book", "Use The Index, Luke — free book on DB indexes", "use-the-index-luke.com", "https://use-the-index-luke.com/"),
    R("article", "SQL vs NoSQL trade-offs", "System Design Primer", "https://github.com/donnemartin/system-design-primer#sql-or-nosql"),
  ],
  "replication-sharding": [
    R("blog", "Sharding Postgres at Notion — real migration story", "Notion Engineering", "https://www.notion.so/blog/sharding-postgres-at-notion", true),
    R("video", "Replication & partitioning lectures", "Martin Kleppmann (YouTube)", "https://www.youtube.com/playlist?list=PLeKd45zvjcDFUEv_ohr_HdUFe97RItdiB"),
    R("article", "Consistent hashing explained", "System Design Primer", "https://github.com/donnemartin/system-design-primer#consistent-hashing"),
  ],
  queues: [
    R("article", "Kafka in a nutshell — official intro", "kafka.apache.org", "https://kafka.apache.org/intro", true),
    R("article", "When to use RabbitMQ vs Kafka", "CloudAMQP", "https://www.cloudamqp.com/blog/when-to-use-rabbitmq-or-apache-kafka.html"),
    R("video", "Message queues explained", "Gaurav Sen (YouTube)", "https://www.youtube.com/playlist?list=PLMCXHnjXnTnvo6alSjVkgxV-VH6EPyvoX"),
  ],
  cap: [
    R("article", "Please stop calling databases CP or AP", "Martin Kleppmann", "https://martin.kleppmann.com/2015/05/11/please-stop-calling-databases-cp-or-ap.html", true),
    R("book", "Distributed systems for fun and profit — free book", "book.mixu.net", "https://book.mixu.net/distsys/"),
    R("blog", "Jepsen — real databases, tested for consistency", "jepsen.io", "https://jepsen.io/analyses"),
  ],
  quorum: [
    R("interactive", "Raft — the animated, step-by-step visualization", "thesecretlivesofdata.com", "https://thesecretlivesofdata.com/raft/", true),
    R("article", "The Raft consensus site + paper", "raft.github.io", "https://raft.github.io/"),
    R("video", "MIT 6.824 Distributed Systems — full course, free", "MIT (YouTube)", "https://www.youtube.com/playlist?list=PLrw6a1wE39_tb2fErI4-WkMbsvGQk9_UB"),
  ],
  resilience: [
    R("article", "Timeouts, retries and backoff with jitter", "AWS Builders' Library", "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/", true),
    R("book", "Google SRE book — free online", "sre.google", "https://sre.google/sre-book/table-of-contents/"),
    R("article", "Rate-limiter algorithms compared", "System Design Primer", "https://github.com/donnemartin/system-design-primer"),
  ],
  microservices: [
    R("article", "Microservices — the article that named them", "martinfowler.com", "https://martinfowler.com/articles/microservices.html", true),
    R("article", "Monolith First", "martinfowler.com", "https://martinfowler.com/bliki/MonolithFirst.html"),
    R("video", "Mastering Chaos — Netflix's microservice architecture", "InfoQ / Netflix (YouTube)", "https://www.youtube.com/watch?v=CZ3wIuvmHeM"),
  ],
  kubernetes: [
    R("video", "Kubernetes explained for beginners — full course", "TechWorld with Nana (YouTube)", "https://www.youtube.com/watch?v=X48VuDVv0do", true),
    R("video", "The Illustrated Children's Guide to Kubernetes", "CNCF (YouTube)", "https://www.youtube.com/watch?v=4ht22ReBjno"),
    R("article", "Kubernetes concepts — official docs", "kubernetes.io", "https://kubernetes.io/docs/concepts/"),
  ],
  "k8s-internals": [
    R("article", "Cluster architecture — official deep dive", "kubernetes.io", "https://kubernetes.io/docs/concepts/architecture/", true),
    R("course", "Kubernetes the Hard Way — build it from scratch", "Kelsey Hightower · GitHub", "https://github.com/kelseyhightower/kubernetes-the-hard-way"),
    R("article", "etcd & Raft — official docs", "etcd.io", "https://etcd.io/docs/latest/learning/why/"),
  ],
  deploys: [
    R("article", "Blue-green deployment", "martinfowler.com", "https://martinfowler.com/bliki/BlueGreenDeployment.html", true),
    R("article", "Canary release", "martinfowler.com", "https://martinfowler.com/bliki/CanaryRelease.html"),
    R("book", "Release engineering — Google SRE book", "sre.google", "https://sre.google/sre-book/release-engineering/"),
  ],
  "multi-region": [
    R("blog", "Active-active for multi-regional resiliency", "Netflix TechBlog", "https://netflixtechblog.com/active-active-for-multi-regional-resiliency-c47719f6685b", true),
    R("article", "What is anycast?", "Cloudflare Learning", "https://www.cloudflare.com/learning/cdn/glossary/anycast-network/"),
    R("blog", "How Discord/Stripe/Uber run globally — engineering blogs", "highscalability.com", "https://highscalability.com/"),
  ],
  observability: [
    R("book", "Monitoring distributed systems — Google SRE book", "sre.google", "https://sre.google/sre-book/monitoring-distributed-systems/", true),
    R("article", "Observability primer — traces, metrics, logs", "OpenTelemetry", "https://opentelemetry.io/docs/concepts/observability-primer/"),
  ],
  "url-shortener": [
    R("article", "URL shortener system design, step by step", "systemdesign.one", "https://systemdesign.one/url-shortening-system-design/", true),
    R("article", "Design Pastebin (nearly the same system) — worked solution", "System Design Primer", "https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md"),
  ],
  "news-feed": [
    R("article", "Design the Twitter timeline — worked solution", "System Design Primer", "https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/twitter/README.md", true),
    R("video", "News feed system design", "ByteByteGo (YouTube)", "https://www.youtube.com/@ByteByteGo"),
  ],
  chat: [
    R("blog", "How Discord stores billions of messages", "Discord Engineering", "https://discord.com/blog/how-discord-stores-billions-of-messages", true),
    R("video", "WhatsApp system design", "Gaurav Sen (YouTube)", "https://www.youtube.com/watch?v=vvhC64hQZMk"),
  ],
};

// The library: everything above, plus the channels/books/courses worth knowing
// as a whole — the standing "gold mine" shelf.
export const LIBRARY: { group: string; blurb: string; items: Resource[] }[] = [
  {
    group: "Complete free courses", blurb: "Start-to-finish curricula, all free.",
    items: [
      R("course", "The System Design Primer — the canonical free course", "GitHub · 300k★ · CC BY", "https://github.com/donnemartin/system-design-primer", true),
      R("course", "System Design — full free course", "karanpratapsingh.com", "https://github.com/karanpratapsingh/system-design"),
      R("course", "System design roadmap", "roadmap.sh", "https://roadmap.sh/system-design"),
      R("video", "System Design for Beginners — full course", "freeCodeCamp (YouTube)", "https://www.youtube.com/c/Freecodecamp"),
      R("video", "MIT 6.824 Distributed Systems — graduate course, free", "MIT (YouTube)", "https://www.youtube.com/playlist?list=PLrw6a1wE39_tb2fErI4-WkMbsvGQk9_UB"),
    ],
  },
  {
    group: "YouTube channels that teach this best", blurb: "Subscribe to two of these and you have a curriculum.",
    items: [
      R("video", "ByteByteGo — animated system-design shorts", "Alex Xu", "https://www.youtube.com/@ByteByteGo", true),
      R("video", "Gaurav Sen — system design interviews", "YouTube", "https://www.youtube.com/playlist?list=PLMCXHnjXnTnvo6alSjVkgxV-VH6EPyvoX"),
      R("video", "Hussein Nasser — backend engineering deep dives", "YouTube", "https://www.youtube.com/@hnasr"),
      R("video", "TechWorld with Nana — Kubernetes, Docker, DevOps", "YouTube", "https://www.youtube.com/@TechWorldwithNana"),
      R("video", "Fireship — every concept in 100 seconds", "YouTube", "https://www.youtube.com/@Fireship"),
      R("video", "Martin Kleppmann — distributed systems lectures", "Cambridge", "https://www.youtube.com/playlist?list=PLeKd45zvjcDFUEv_ohr_HdUFe97RItdiB"),
    ],
  },
  {
    group: "Interactive playgrounds", blurb: "Learn by poking at moving diagrams.",
    items: [
      R("interactive", "samwho.dev — load balancing, memory, bloom filters, animated & playable", "samwho.dev", "https://samwho.dev/", true),
      R("interactive", "Raft consensus, visualized step by step", "thesecretlivesofdata.com", "https://thesecretlivesofdata.com/raft/"),
      R("interactive", "How DNS works — comic", "howdns.works", "https://howdns.works/"),
      R("interactive", "How HTTPS works — comic", "howhttps.works", "https://howhttps.works/"),
      R("interactive", "Interactive latency numbers, year by year", "colin-scott.github.io", "https://colin-scott.github.io/personal_website/research/interactive_latency.html"),
      R("interactive", "Live submarine cable map", "TeleGeography", "https://www.submarinecablemap.com/"),
    ],
  },
  {
    group: "Free books (yes, actually free)", blurb: "Full-length books, free online, written by the people who know.",
    items: [
      R("book", "Google SRE Book — how Google runs production", "sre.google", "https://sre.google/sre-book/table-of-contents/", true),
      R("book", "High Performance Browser Networking", "hpbn.co", "https://hpbn.co/"),
      R("book", "Operating Systems: Three Easy Pieces", "OSTEP", "https://pages.cs.wisc.edu/~remzi/OSTEP/"),
      R("book", "Putting the “You” in CPU", "cpu.land", "https://cpu.land/"),
      R("book", "Distributed systems for fun and profit", "book.mixu.net", "https://book.mixu.net/distsys/"),
      R("book", "Use The Index, Luke — database indexing", "use-the-index-luke.com", "https://use-the-index-luke.com/"),
    ],
  },
  {
    group: "Real engineering blogs", blurb: "How the actual systems you use are built — straight from the teams.",
    items: [
      R("blog", "AWS Builders' Library — how Amazon builds reliability", "aws.amazon.com", "https://aws.amazon.com/builders-library/", true),
      R("blog", "Netflix TechBlog", "netflixtechblog.com", "https://netflixtechblog.com/"),
      R("blog", "Discord Engineering", "discord.com/blog", "https://discord.com/category/engineering"),
      R("blog", "Uber Engineering", "uber.com", "https://www.uber.com/blog/engineering/"),
      R("blog", "High Scalability — architecture case studies since 2007", "highscalability.com", "https://highscalability.com/"),
      R("blog", "systemdesign.one — case studies of real products", "systemdesign.one", "https://systemdesign.one/"),
    ],
  },
  {
    group: "The classics (paid, but worth knowing)", blurb: "Flagged honestly: not free, universally recommended.",
    items: [
      R("book", "Designing Data-Intensive Applications — “the book”", "Martin Kleppmann", "https://dataintensive.net/", false, true),
      R("book", "System Design Interview vol 1 & 2", "Alex Xu / ByteByteGo", "https://bytebytego.com/", false, true),
      R("course", "Grokking the System Design Interview", "DesignGurus", "https://www.designgurus.io/course/grokking-the-system-design-interview", false, true),
    ],
  },
];

// Real teaching images — hotlinked from their license-clean sources (verified:
// primer repo = CC BY 4.0, kubernetes.io docs = CC BY 4.0, Wikimedia files
// below = public domain or CC BY-SA as credited). Keyed lesson id → step title.
const PRIMER = "https://raw.githubusercontent.com/donnemartin/system-design-primer/master/images";
const PRIMER_CREDIT = "Donne Martin · The System Design Primer · CC BY 4.0";
const PRIMER_URL = "https://github.com/donnemartin/system-design-primer";
export const IMAGES: Record<string, Record<string, StepImage>> = {
  "how-web-works": {
    "Why this matters": { src: `${PRIMER}/jj3A5N8.png`, alt: "Full system design overview map — DNS, CDN, load balancers, web and app tiers, caches, SQL and NoSQL stores, queues", credit: `Where this course is headed — the whole map. ${PRIMER_CREDIT}`, href: PRIMER_URL },
  },
  "how-internet-works": {
    "Wires under the ocean": { src: "https://upload.wikimedia.org/wikipedia/commons/8/89/Submarine_cable_map_umap.png", alt: "World map of submarine internet cables", credit: "Submarine cables — data © Greg Mahlknecht, map © OpenStreetMap contributors · CC BY-SA 2.0", href: "https://www.submarinecablemap.com/" },
  },
  "protocol-stack": {
    "Layers — each solves ONE problem": { src: "https://upload.wikimedia.org/wikipedia/commons/8/8d/OSI_Model_v1.svg", alt: "The 7-layer OSI model with each layer's function", credit: "The OSI reference model · Wikimedia Commons · public domain", href: "https://commons.wikimedia.org/wiki/File:OSI_Model_v1.svg" },
    "TCP vs UDP — the transport choice": { src: "https://upload.wikimedia.org/wikipedia/commons/7/71/TCP_Three-Way_Handshake.svg", alt: "TCP three-way handshake: SYN, SYN-ACK, ACK", credit: "TCP's three-way handshake · Wikimedia Commons · public domain", href: "https://commons.wikimedia.org/wiki/File:TCP_Three-Way_Handshake.svg" },
  },
  dns: {
    "Names to addresses": { src: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Example_of_an_iterative_DNS_resolver.svg", alt: "Iterative DNS resolution: resolver asks root, TLD, then authoritative servers", credit: "Iterative DNS resolution · Wikimedia Commons · public domain", href: "https://commons.wikimedia.org/wiki/File:Example_of_an_iterative_DNS_resolver.svg" },
  },
  "tls-https": {
    "The handshake": { src: "https://upload.wikimedia.org/wikipedia/commons/d/d3/Full_TLS_1.2_Handshake.svg", alt: "Full TLS handshake message sequence between client and server", credit: "The full TLS handshake · Wikimedia Commons · public domain", href: "https://commons.wikimedia.org/wiki/File:Full_TLS_1.2_Handshake.svg" },
  },
  "load-balancing": {
    "One door, many rooms": { src: `${PRIMER}/h81n9iK.png`, alt: "A load balancer distributing client requests across identical workers", credit: PRIMER_CREDIT, href: PRIMER_URL },
  },
  caching: {
    "Memory is 1,000× faster than disk": { src: `${PRIMER}/Q6z24La.png`, alt: "Application servers reading through a shared cache in front of the database", credit: PRIMER_CREDIT, href: PRIMER_URL },
  },
  cdn: {
    "Move the bytes near the user": { src: `${PRIMER}/h9TAuGI.jpg`, alt: "CDN edge servers serving static assets close to users instead of the origin", credit: PRIMER_CREDIT, href: PRIMER_URL },
  },
  "replication-sharding": {
    "Replication — copies for safety and reads": { src: `${PRIMER}/C9ioGtn.png`, alt: "Master-slave replication: writes to the master, replicated reads from slaves", credit: PRIMER_CREDIT, href: PRIMER_URL },
    "Sharding — splitting the data itself": { src: `${PRIMER}/wU8x5Id.png`, alt: "Sharding: one dataset horizontally partitioned across multiple databases", credit: PRIMER_CREDIT, href: PRIMER_URL },
  },
  kubernetes: {
    "Kubernetes — the fleet manager": { src: "https://kubernetes.io/images/docs/components-of-kubernetes.svg", alt: "The components of a Kubernetes cluster", credit: "The Kubernetes Authors · kubernetes.io · CC BY 4.0", href: "https://kubernetes.io/docs/concepts/overview/components/" },
  },
  "k8s-internals": {
    "The control plane — the cluster's brain": { src: "https://kubernetes.io/images/docs/kubernetes-cluster-architecture.svg", alt: "Official Kubernetes cluster architecture: control plane and worker nodes", credit: "The Kubernetes Authors · kubernetes.io · CC BY 4.0", href: "https://kubernetes.io/docs/concepts/architecture/" },
  },
  "url-shortener": {
    "What you just did": { src: `${PRIMER}/4edXG0T.png`, alt: "The primer's worked Pastebin architecture — nearly the same system as a URL shortener", credit: `A real worked solution (Pastebin ≈ URL shortener). ${PRIMER_CREDIT}`, href: `${PRIMER_URL}/blob/master/solutions/system_design/pastebin/README.md` },
  },
  "news-feed": {
    "The pipeline": { src: `${PRIMER}/jrUBAF7.png`, alt: "Twitter timeline architecture: fan-out service, feed caches, search API", credit: `The primer's worked Twitter timeline design. ${PRIMER_CREDIT}`, href: `${PRIMER_URL}/blob/master/solutions/system_design/twitter/README.md` },
  },
};

export const ALL_LESSONS: Lesson[] = LEVELS.flatMap((l) => l.lessons);
export const lessonAfter = (id: string): Lesson | null => {
  const i = ALL_LESSONS.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < ALL_LESSONS.length ? ALL_LESSONS[i + 1] : null;
};

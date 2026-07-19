// Privacy Toolkit — a curated, hand-picked shelf of FREE, non-tracking privacy
// & security tools. Sourced from the LEGITIMATE part of FMHY's privacy list
// (fmhy.net/privacy) — open-source software, privacy-respecting services and
// educational guides ONLY. No streaming/download/ROM/crack/piracy sections.
// Each entry just opens the tool's official site in a new tab; the console
// stores and proxies nothing. Hidden by default — opt in via Labs.
import { For, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";

type Tool = { name: string; url: string; note: string };
type Cat = { title: string; tools: Tool[] };

const CATS: Cat[] = [
  {
    title: "Browsers & anti-tracking",
    tools: [
      { name: "Tor Browser", url: "https://www.torproject.org/", note: "Onion-routed, anti-fingerprint" },
      { name: "Mullvad Browser", url: "https://mullvad.net/en/browser", note: "Tor's browser, without the Tor network" },
      { name: "LibreWolf", url: "https://librewolf.net/", note: "Hardened, telemetry-free Firefox" },
      { name: "arkenfox user.js", url: "https://github.com/arkenfox/user.js", note: "Firefox privacy tuning" },
      { name: "uBlock Origin", url: "https://github.com/gorhill/uBlock", note: "The ad / tracker blocker" },
      { name: "SponsorBlock", url: "https://sponsor.ajay.app/", note: "Skip in-video YouTube sponsors" },
    ],
  },
  {
    title: "Private search",
    tools: [
      { name: "Brave Search", url: "https://search.brave.com/", note: "Independent index" },
      { name: "DuckDuckGo", url: "https://duckduckgo.com/", note: "No tracking, bang shortcuts" },
      { name: "Startpage", url: "https://www.startpage.com/", note: "Google results, privately" },
      { name: "4get", url: "https://4get.ca/", note: "Open-source metasearch" },
    ],
  },
  {
    title: "VPN & tunnels",
    tools: [
      { name: "Proton VPN", url: "https://protonvpn.com/", note: "Free tier, unlimited data" },
      { name: "Mullvad VPN", url: "https://mullvad.net/", note: "No-log, anonymous account numbers" },
      { name: "Windscribe", url: "https://windscribe.com/", note: "10 GB/month free" },
      { name: "IVPN", url: "https://www.ivpn.net/", note: "Audited, no-log" },
      { name: "WireGuard", url: "https://www.wireguard.com/", note: "Modern VPN protocol" },
      { name: "Tailscale", url: "https://tailscale.com/", note: "WireGuard mesh between your devices" },
    ],
  },
  {
    title: "Network / DNS adblock",
    tools: [
      { name: "Pi-hole", url: "https://pi-hole.net/", note: "Network-wide DNS adblock" },
      { name: "AdGuard Home", url: "https://adguard.com/en/adguard-home/overview.html", note: "Self-hosted DNS filtering" },
      { name: "Cloudflare WARP", url: "https://one.one.one.one/", note: "Free encrypted DNS / tunnel" },
      { name: "Hagezi Blocklists", url: "https://github.com/hagezi/dns-blocklists", note: "Maintained DNS blocklists" },
      { name: "Safing Portmaster", url: "https://safing.io/", note: "Per-app firewall + DNS" },
    ],
  },
  {
    title: "Encrypted messengers",
    tools: [
      { name: "Signal", url: "https://signal.org/", note: "The standard; needs a phone #" },
      { name: "SimpleX", url: "https://simplex.chat/", note: "No user identifiers at all" },
      { name: "Molly", url: "https://github.com/mollyim/mollyim-android", note: "Hardened Signal fork (Android)" },
      { name: "Briar", url: "https://briarproject.org/", note: "P2P, works without internet" },
    ],
  },
  {
    title: "Private email",
    tools: [
      { name: "Proton Mail", url: "https://proton.me/mail", note: "Encrypted, free tier" },
      { name: "Tuta", url: "https://tuta.com/", note: "Encrypted, free tier" },
    ],
  },
  {
    title: "Passwords & 2FA",
    tools: [
      { name: "Bitwarden", url: "https://bitwarden.com/", note: "Open-source password manager" },
      { name: "KeePassXC", url: "https://keepassxc.org/", note: "Offline, local vault" },
      { name: "Ente Auth", url: "https://ente.io/auth/", note: "2FA, cross-platform" },
      { name: "Aegis", url: "https://getaegis.app/", note: "2FA (Android)" },
    ],
  },
  {
    title: "Scanners & breach checks",
    tools: [
      { name: "VirusTotal", url: "https://www.virustotal.com/", note: "Scan a file / URL with 70+ engines" },
      { name: "URLScan", url: "https://urlscan.io/", note: "Safely inspect what a site does" },
      { name: "Have I Been Pwned", url: "https://haveibeenpwned.com/", note: "Is your email in a breach?" },
      { name: "Cover Your Tracks", url: "https://coveryourtracks.eff.org/", note: "Test your browser fingerprint (EFF)" },
    ],
  },
  {
    title: "Anti-censorship",
    tools: [
      { name: "GoodbyeDPI", url: "https://github.com/ValdikSS/GoodbyeDPI/", note: "DPI bypass (Windows)" },
      { name: "ByeDPI (Android)", url: "https://github.com/dovecoteescapee/ByeDPIAndroid", note: "DPI bypass (Android)" },
      { name: "Snowflake", url: "https://snowflake.torproject.org/", note: "Lend bandwidth to bypass censorship" },
    ],
  },
  {
    title: "Privacy-first OS",
    tools: [
      { name: "Tails", url: "https://tails.net/", note: "Amnesic live USB, routes via Tor" },
      { name: "Whonix", url: "https://www.whonix.org/", note: "Tor-gated VMs" },
      { name: "Qubes OS", url: "https://www.qubes-os.org/", note: "Security by compartmentalization" },
    ],
  },
  {
    title: "Guides & references",
    tools: [
      { name: "Privacy Guides", url: "https://www.privacyguides.org/", note: "The go-to reference" },
      { name: "EFF Surveillance Self-Defense", url: "https://ssd.eff.org/", note: "Practical, plain-language" },
      { name: "The New Oil", url: "https://thenewoil.org/", note: "Beginner-friendly" },
      { name: "Awesome Privacy", url: "https://awesome-privacy.xyz/", note: "Big curated index" },
      { name: "JustDeleteMe", url: "https://justdeleteme.xyz/", note: "Find how to delete old accounts" },
      { name: "ToS;DR", url: "https://tosdr.org/", note: "Terms of service, rated & summarized" },
    ],
  },
];

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default function Privacy(props: { onClose: () => void }) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", onKey);
    onCleanup(() => removeEventListener("keydown", onKey));
  });
  const open = (u: string) => { sfx.confirm(); window.open(u, "_blank", "noopener,noreferrer"); };

  return (
    <div class="pvk pad-focus-scope">
      <div class="pvk-head">
        <div class="panel-tag">PRIVACY TOOLKIT · FREE &amp; OPEN</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <div class="pvk-intro">
        Hand-picked <b>free, non-tracking</b> privacy &amp; security tools — the legitimate slice of
        {" "}<a href="https://fmhy.net/privacy" target="_blank" rel="noopener noreferrer">FMHY's privacy list</a>.
        Each opens the tool's official site in a new tab; the console stores and proxies nothing.
      </div>
      <div class="pvk-grid">
        <For each={CATS}>{(c) => (
          <section class="pvk-cat">
            <h3 class="pvk-cat-title">{c.title}</h3>
            <For each={c.tools}>{(t) => (
              <button class="pvk-tool" onClick={() => open(t.url)} title={`Open ${hostOf(t.url)} in a new tab`}>
                <span class="pvk-tool-top"><span class="pvk-tool-name">{t.name}</span><span class="pvk-tool-host">{hostOf(t.url)} ↗</span></span>
                <span class="pvk-tool-note">{t.note}</span>
              </button>
            )}</For>
          </section>
        )}</For>
      </div>
    </div>
  );
}

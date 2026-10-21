import tls from "node:tls";

let applied: boolean | null = null;

/**
 * Trust the operating system's certificate store in addition to Node's bundled
 * CA list, so outbound HTTPS (OpenAI) works behind TLS-inspecting corporate
 * proxies such as Zscaler, whose root certificate is installed in the OS but
 * not known to Node. This is the same trust a browser on this machine uses;
 * certificate verification stays ON. Opt out with OPENAI_TRUST_SYSTEM_CA=false.
 *
 * Idempotent and cheap; call before creating an outbound HTTPS client.
 */
export function trustSystemCertificates(): boolean {
  if (applied !== null) return applied;
  applied = false;
  if (process.env.OPENAI_TRUST_SYSTEM_CA === "false") return applied;
  const t = tls as typeof tls & {
    getCACertificates?: (type?: "default" | "system" | "bundled" | "extra") => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (typeof t.getCACertificates !== "function" || typeof t.setDefaultCACertificates !== "function") return applied; // Node < 22.19 / 24.5
  try {
    const system = t.getCACertificates("system");
    if (system.length) {
      t.setDefaultCACertificates([...new Set([...t.getCACertificates("default"), ...system])]);
      applied = true;
    }
  } catch {
    applied = false;
  }
  return applied;
}

export function systemCertificatesTrusted(): boolean | null {
  return applied;
}

import { describe, it, expect } from "vitest";

describe("SOCKS5 Proxy Configuration", () => {
  it("should have SOCKS5_PROXY_URL set", () => {
    const proxyUrl = process.env.SOCKS5_PROXY_URL;
    expect(proxyUrl).toBeDefined();
    expect(proxyUrl!.length).toBeGreaterThan(10);
    expect(proxyUrl).toContain("socks5://");
  });

  it("should contain the Frankfurt proxy IP", () => {
    const proxyUrl = process.env.SOCKS5_PROXY_URL || "";
    expect(proxyUrl).toContain("165.227.132.17");
  });
});

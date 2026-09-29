export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withJitter(ms: number, ratio = 0.1): number {
  const spread = Math.max(1, Math.floor(ms * ratio));
  const offset = Math.floor(Math.random() * spread * 2) - spread;
  return ms + offset;
}

/** Shared, mutable effect state: the gavel strike writes it, the camera, bloom and shockwave read it. */
export const COLORS = {
  accept: "#4fb59a",
  reject: "#d4443b",
  brass: "#c8a25a",
  walnut: "#1a120e",
  parchment: "#eee3cb",
} as const;

export const fx = {
  shake: 0,
  flash: 0,
  ringT: -1,
  ringColor: "#ffffff" as string,
};

export function triggerStrike(color: string) {
  fx.shake = 1;
  fx.flash = 1;
  fx.ringT = 0;
  fx.ringColor = color;
}

export const verdictColor = (v: "ACCEPT" | "REJECT" | null): string =>
  v === "ACCEPT" ? COLORS.accept : v === "REJECT" ? COLORS.reject : COLORS.brass;

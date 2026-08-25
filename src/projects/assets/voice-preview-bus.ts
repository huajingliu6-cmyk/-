"use client";

type ActivePreview = {
  id: string;
  stop: () => void;
};

let active: ActivePreview | null = null;

/** Ensure only one voice preview plays at a time across panels. */
export function claimVoicePreview(id: string, stop: () => void) {
  if (active && active.id !== id) {
    active.stop();
  }
  active = { id, stop };
}

export function releaseVoicePreview(id: string) {
  if (active?.id === id) {
    active = null;
  }
}

export function stopActiveVoicePreview() {
  active?.stop();
  active = null;
}

"use client";

import type { ReactNode } from "react";

export type StoryboardWorkspaceShellProps = {
  assets: ReactNode;
  prompt: ReactNode;
  video: ReactNode;
  timeline: ReactNode;
  note?: ReactNode;
  className?: string;
};

/**
 * Single desktop shot-workspace grid shell.
 * Business logic stays in ProductionPanel / ShotAccordion.
 */
export function StoryboardWorkspaceShell({
  assets,
  prompt,
  video,
  timeline,
  note,
  className,
}: StoryboardWorkspaceShellProps) {
  return (
    <div
      className={
        className
          ? `sbw-shot-workspace ${className}`
          : "sbw-shot-workspace"
      }
      data-testid="storyboard-shot-workspace"
    >
      <section className="sbw-shot-section sbw-shot-workspace__assets">
        {assets}
      </section>
      <section className="sbw-shot-section sbw-shot-workspace__prompt">
        {prompt}
      </section>
      <div className="sbw-shot-workspace__video">{video}</div>
      {note ? <div className="sbw-shot-workspace__note">{note}</div> : null}
      <div className="sbw-shot-workspace__timeline">{timeline}</div>
    </div>
  );
}
